// app/api/agent/upload/route.ts
// Server-side upload of agent assets (image, metadata, encrypted intelligence) to 0G Storage.
// The server platform wallet pays all upload fees, so the browser never needs a signer.

import { NextRequest, NextResponse } from "next/server";
import { encryptAgentIntelligence } from "@/lib/encryption";
import { getServerUploadSigner } from "@/lib/agent-compute-wallet";
import type { Wallet } from "ethers";

const ZG_INDEXER_URL =
  process.env.ZG_INDEXER_URL ??
  process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

const ZG_EVM_RPC =
  process.env.ZG_EVM_RPC ??
  process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
  "https://rpc.ankr.com/0g_galileo_testnet_evm";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://opendock.vercel.app";

async function uploadBuffer(
  data: Uint8Array,
  signer: Wallet,
  label: string
): Promise<{ rootHash: `0x${string}`; txHash: string | null }> {
  const { MemData, Indexer } = await import("@0gfoundation/0g-ts-sdk");
  const memData = new MemData(data);
  const [tree, treeErr] = await memData.merkleTree();
  if (treeErr !== null || !tree) {
    throw new Error(`[${label}] 0G Merkle tree error: ${treeErr}`);
  }
  const rootHash = tree.rootHash();
  if (!rootHash) throw new Error(`[${label}] 0G Merkle tree returned empty root hash`);

  console.log(`[${label}] uploading ${data.byteLength} bytes, rootHash=${rootHash}`);
  const indexer = new Indexer(ZG_INDEXER_URL);
  const [tx, uploadErr] = await indexer.upload(
    memData,
    ZG_EVM_RPC,
    signer,
    {
      skipIfFinalized: true,
      onProgress: (msg) => console.log(`[${label}] ${msg}`),
    },
    undefined,
    { gasPrice: BigInt(20_000_000_000) }
  );
  if (uploadErr !== null) {
    throw new Error(`[${label}] 0G upload error: ${uploadErr}`);
  }

  console.log(`[${label}] done, txHash=${(tx as { txHash?: string } | null)?.txHash ?? "n/a"}`);
  return {
    rootHash: rootHash as `0x${string}`,
    txHash: (tx as { txHash?: string } | null)?.txHash ?? null,
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
