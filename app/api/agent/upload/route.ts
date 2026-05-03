// app/api/agent/upload/route.ts
// Server-side upload of agent assets (image, metadata, encrypted intelligence) to 0G Storage.
// The server platform wallet pays all upload fees, so the browser never needs a signer.

import { NextRequest, NextResponse } from "next/server";
import { encryptAgentIntelligence } from "@/lib/encryption";
import { getServerUploadSigner } from "@/lib/agent-compute-wallet";
import {
  getZGStorageExpectedReplica,
  getZGStorageSelectAttempts,
  getZGStorageSelectMethod,
  type ZGStorageSelectMethod,
} from "@/lib/0g-storage-config";
import { JsonRpcProvider } from "ethers";
import type { Wallet } from "ethers";

const ZG_INDEXER_URL =
  process.env.ZG_INDEXER_URL ??
  process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

const ZG_EVM_RPC =
  process.env.ZG_EVM_RPC ??
  process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
  "https://evmrpc-testnet.0g.ai";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://opendock.vercel.app";

type StorageNodeClient = {
  url?: string;
  getStatus: () => Promise<{
    networkIdentity?: { flowAddress?: string };
    logSyncHeight?: number;
  } | null>;
};

// SDK 的 submitLogEntryNoReceipt 送出 TX 後不等 receipt，
// 若 TX revert 則 waitForLogEntry 會永遠 polling。
// 這裡透過 onProgress 捕捉 txHash，確認 receipt 後若 revert 立即中止。
async function uploadBuffer(
  data: Uint8Array,
  signer: Wallet,
  label: string
): Promise<{ rootHash: `0x${string}`; txHash: string | null }> {
  const { MemData, Indexer, Uploader, getFlowContract } = await import(
    "@0gfoundation/0g-storage-ts-sdk"
  );
  const memData = new MemData(data);
  const [tree, treeErr] = await memData.merkleTree();
  if (treeErr !== null || !tree) {
    throw new Error(`[${label}] 0G Merkle tree error: ${treeErr}`);
  }
  const rootHash = tree.rootHash();
  if (!rootHash) throw new Error(`[${label}] 0G Merkle tree returned empty root hash`);

  console.log(`[${label}] uploading ${data.byteLength} bytes, rootHash=${rootHash}`);
  const indexer = new Indexer(ZG_INDEXER_URL);
  const desiredReplica = getZGStorageExpectedReplica();
  const selectMethod = getZGStorageSelectMethod();
  const selectAttempts = getZGStorageSelectAttempts();

  async function createUploader(): Promise<{
    uploader: InstanceType<typeof Uploader>;
    expectedReplica: number;
  }> {
    for (let expectedReplica = desiredReplica; expectedReplica >= 1; expectedReplica -= 1) {
      for (let attempt = 1; attempt <= selectAttempts; attempt += 1) {
        const method: ZGStorageSelectMethod =
          attempt === 1 ? selectMethod : "random";
        const [nodes, selectErr] = await indexer.selectNodes(expectedReplica, method);
        if (selectErr !== null || nodes.length === 0) {
          console.warn(
            `[${label}] selectNodes(expectedReplica=${expectedReplica}, method=${method}) failed:`,
            selectErr
          );
          continue;
        }

        const storageNodes = nodes as StorageNodeClient[];
        const statuses = await Promise.all(storageNodes.map((node) => node.getStatus()));
        const missingStatusIndex = statuses.findIndex((status) => status === null);
        if (missingStatusIndex !== -1) {
          console.warn(
            `[${label}] selected storage node has no status, retrying selection:`,
            storageNodes[missingStatusIndex]?.url ?? `index ${missingStatusIndex}`
          );
          continue;
        }

        const flowAddress = statuses[0]?.networkIdentity?.flowAddress;
        if (!flowAddress) {
          console.warn(`[${label}] selected storage node did not report a flow address`);
          continue;
        }

        console.log(
          `[${label}] selected ${nodes.length} storage nodes with expectedReplica=${expectedReplica}, method=${method}`
        );
        const flow = getFlowContract(flowAddress, signer);
        return {
          uploader: new Uploader(nodes, ZG_EVM_RPC, flow),
          expectedReplica,
        };
      }
    }

    throw new Error(
      `[${label}] cannot select available 0G storage nodes for expectedReplica<=${desiredReplica}`
    );
  }

  const { uploader, expectedReplica } = await createUploader();

  let rejectFn: ((e: Error) => void) | null = null;
  const revertGuard = new Promise<never>((_, reject) => { rejectFn = reject; });

  function monitorTx(txHash: string) {
    const provider = new JsonRpcProvider(ZG_EVM_RPC);
    provider.waitForTransaction(txHash, 1, 90_000)
      .then((receipt) => {
        if (!receipt) {
          rejectFn!(new Error(`[${label}] TX ${txHash} not mined within 90s — possible gas/nonce issue`));
        } else if (receipt.status === 0) {
          rejectFn!(new Error(`[${label}] TX ${txHash} reverted on chain`));
        }
        // status === 1: success, waitForLogEntry will resolve naturally
      })
      .catch(() => {
        rejectFn!(new Error(`[${label}] TX ${txHash} not mined within 90s — possible gas/nonce issue`));
      });
  }

  const [tx, uploadErr] = await Promise.race([
    uploader.splitableUpload(
      memData,
      {
        expectedReplica,
        onProgress: (msg) => {
          console.log(`[${label}] ${msg}`);
          const match = msg.match(/Transaction submitted: (0x[0-9a-fA-F]{64})/);
          if (match) monitorTx(match[1]);
        },
      },
      undefined
    ),
    revertGuard,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[${label}] upload timed out after 5 minutes`)), 5 * 60 * 1000)
    ),
  ]);

  if (uploadErr !== null) {
    throw new Error(`[${label}] 0G upload error: ${uploadErr}`);
  }

  const txHash = tx.txHashes[0] ?? null;
  console.log(`[${label}] done, txHash=${txHash ?? "n/a"}`);
  return {
    rootHash: rootHash as `0x${string}`,
    txHash,
  };
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null) ?? "";
  const systemPrompt = (formData.get("systemPrompt") as string | null)?.trim();
  const kbFilesJson = formData.get("knowledgeBaseFiles") as string | null;
  const imageFile = formData.get("image") as File | null;

  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  let signer: Wallet;
  try {
    signer = getServerUploadSigner();
  } catch (err) {
    console.error("[upload] server upload wallet not configured:", err);
    return NextResponse.json(
      { error: "Server upload wallet not configured" },
      { status: 503 }
    );
  }

  // 1. Upload image (if provided)
  let imageHash = "";
  let imageMimeType = "image/webp";
  if (imageFile && imageFile.size > 0) {
    const imageBuffer = new Uint8Array(await imageFile.arrayBuffer());
    imageMimeType = imageFile.type || "image/webp";
    const result = await uploadBuffer(imageBuffer, signer, "image");
    imageHash = result.rootHash;
  }

  // 2. Build and upload ERC-721 metadata
  const imageUrl = imageHash
    ? `${BASE_URL}/api/image/${imageHash}?type=${encodeURIComponent(imageMimeType)}`
    : "";
  const metadataBytes = new TextEncoder().encode(
    JSON.stringify({ name, description, image: imageUrl, imageHash })
  );
  const { rootHash: metadataHash } = await uploadBuffer(metadataBytes, signer, "metadata");

  // 3. Encrypt intelligence and upload
  const knowledgeBaseFiles = kbFilesJson
    ? (JSON.parse(kbFilesJson) as Array<{ name: string; content: string }>)
    : undefined;
  const envelope = encryptAgentIntelligence({
    name,
    systemPrompt: systemPrompt ?? "",
    knowledgeBaseFiles,
    knowledgeBase: null,
    knowledgeBaseName: null,
    version: 1,
  });
  const dataBytes = new TextEncoder().encode(JSON.stringify(envelope));
  const { rootHash: dataHash } = await uploadBuffer(dataBytes, signer, "intelligence");

  return NextResponse.json({ imageHash, imageMimeType, metadataHash, dataHash });
}
