// lib/0g-storage.ts
// Helpers for uploading agent data to 0G Storage and getting the Merkle root hash.
//
// The Merkle root hash is what we store on-chain as `dataHash` inside IntelligentData.
// Flow:
//   1. Build a Blob from the agent payload (system prompt + optional file)
//   2. Compute its Merkle tree → rootHash (bytes32, used as dataHash on-chain)
//   3. Upload the Blob to 0G Storage via the Indexer
//   4. Return the rootHash so the caller can use it in the mint() call

export const ZG_INDEXER_URL =
  process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

export const ZG_EVM_RPC =
  process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
  "https://rpc.ankr.com/0g_galileo_testnet_evm";

export interface AgentPayload {
  name: string;
  systemPrompt: string;
  /** Raw bytes of an optional knowledge-base file */
  knowledgeBase?: Uint8Array;
  /** Original filename, used only for logging */
  knowledgeBaseName?: string;
}

/**
 * Encode the agent payload as a UTF-8 JSON blob.
 * In a production setup the payload would be encrypted before upload.
 */
function encodePayload(payload: AgentPayload): Uint8Array {
  const obj = {
    name: payload.name,
    systemPrompt: payload.systemPrompt,
    // Knowledge-base bytes are base64-encoded to keep everything in JSON.
    knowledgeBase: payload.knowledgeBase
      ? Buffer.from(payload.knowledgeBase).toString("base64")
      : null,
    knowledgeBaseName: payload.knowledgeBaseName ?? null,
  };
  return new TextEncoder().encode(JSON.stringify(obj));
}

export interface UploadResult {
  /** 0x-prefixed hex string, 32 bytes — use directly as bytes32 in mint() */
  rootHash: `0x${string}`;
  /** The 0G Storage transaction hash (for the user to track) */
  txHash: string | null;
}

/**
 * Upload agent payload to 0G Storage and return the Merkle root hash.
 *
 * @param payload  Agent data to upload
 * @param signer   An ethers Signer (from wagmi's `useWalletClient` → ethers adapter)
 */
export async function uploadAgentData(
  payload: AgentPayload,
  signer: import("ethers").Signer
): Promise<UploadResult> {
  // Dynamic import to avoid SSR issues — 0G SDK is browser/Node only
  const { Blob, Indexer } = await import("@0gfoundation/0g-ts-sdk/browser");

  const bytes = encodePayload(payload);
  // 0G SDK's Blob class requires a browser File (not globalThis.Blob)
  const file = new File([bytes.buffer as ArrayBuffer], "agent.json", {
    type: "application/json",
  });
  const blob = new Blob(file);

  // Compute Merkle tree & root hash
  const [tree, treeErr] = await blob.merkleTree();
  if (treeErr !== null || !tree) {
    throw new Error(`0G Merkle tree error: ${treeErr}`);
  }

  const rawHash = tree.rootHash();
  if (!rawHash) throw new Error("0G Merkle tree returned empty root hash");
  const rootHash = rawHash as `0x${string}`;

  // Upload
  const indexer = new Indexer(ZG_INDEXER_URL);
  const [tx, uploadErr] = await indexer.upload(blob, ZG_EVM_RPC, signer);
  if (uploadErr !== null) {
    throw new Error(`0G upload error: ${uploadErr}`);
  }

  return {
    rootHash,
    txHash: (tx as { txHash?: string } | null)?.txHash ?? null,
  };
}
