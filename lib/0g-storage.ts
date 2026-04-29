// lib/0g-storage.ts
// Helpers for uploading data to 0G Storage and getting Merkle root hashes.
//
// Two separate uploads happen during agent creation:
//   1. metadataUpload — ERC-721 metadata JSON (name, description, image, systemPrompt)
//   2. intelligenceUpload — the actual agent intelligence data (system prompt + knowledge base)
//
// The metadataHash is stored on-chain as the ERC-721 tokenURI source.
// The intelligenceHash is stored as the IntelligentData dataHash.

export const ZG_INDEXER_URL =
  process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

export const ZG_EVM_RPC =
  process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
  "https://rpc.ankr.com/0g_galileo_testnet_evm";

// ---- ERC-721 Metadata ----

export interface AgentMetadata {
  name: string;
  description: string;
  /** URL or data-URI for the agent avatar */
  image: string;
  /** Stored as an extra attribute, not part of core ERC-721 but useful for display */
  systemPrompt: string;
}

// ---- Intelligence payload ----

export interface AgentPayload {
  name: string;
  systemPrompt: string;
  /** Raw bytes of an optional knowledge-base file */
  knowledgeBase?: Uint8Array;
  knowledgeBaseName?: string;
}

function encodeJSON(obj: unknown): File {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new File([bytes.buffer as ArrayBuffer], "data.json", {
    type: "application/json",
  });
}

export interface UploadResult {
  /** 0x-prefixed hex string, 32 bytes — use directly as bytes32 on-chain */
  rootHash: `0x${string}`;
  /** The 0G Storage transaction hash */
  txHash: string | null;
}

async function uploadFile(
  file: File,
  signer: import("ethers").Signer
): Promise<UploadResult> {
  const { Blob, Indexer } = await import("@0gfoundation/0g-ts-sdk/browser");

  const blob = new Blob(file);
  const [tree, treeErr] = await blob.merkleTree();
  if (treeErr !== null || !tree) {
    throw new Error(`0G Merkle tree error: ${treeErr}`);
  }
  const rawHash = tree.rootHash();
  if (!rawHash) throw new Error("0G Merkle tree returned empty root hash");

  const indexer = new Indexer(ZG_INDEXER_URL);
  const [tx, uploadErr] = await indexer.upload(blob, ZG_EVM_RPC, signer);
  if (uploadErr !== null) {
    throw new Error(`0G upload error: ${uploadErr}`);
  }

  return {
    rootHash: rawHash as `0x${string}`,
    txHash: (tx as { txHash?: string } | null)?.txHash ?? null,
  };
}

/**
 * Upload the ERC-721 metadata JSON to 0G Storage.
 * Returns the root hash to be stored on-chain as metadataHash.
 */
export async function uploadMetadata(
  metadata: AgentMetadata,
  signer: import("ethers").Signer
): Promise<UploadResult> {
  const file = encodeJSON(metadata);
  return uploadFile(file, signer);
}

/**
 * Upload the agent intelligence payload (system prompt + optional knowledge base) to 0G Storage.
 * Returns the root hash to be stored on-chain as IntelligentData.dataHash.
 */
export async function uploadAgentData(
  payload: AgentPayload,
  signer: import("ethers").Signer
): Promise<UploadResult> {
  const obj = {
    name: payload.name,
    systemPrompt: payload.systemPrompt,
    knowledgeBase: payload.knowledgeBase
      ? Buffer.from(payload.knowledgeBase).toString("base64")
      : null,
    knowledgeBaseName: payload.knowledgeBaseName ?? null,
  };
  const file = encodeJSON(obj);
  return uploadFile(file, signer);
}
