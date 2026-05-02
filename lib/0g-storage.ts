// lib/0g-storage.ts
// Helpers for uploading data to 0G Storage and getting Merkle root hashes.
//
// Two separate uploads happen during agent creation:
//   1. metadataUpload — ERC-721 metadata JSON (name, description, image)
//      NOTE: systemPrompt is intentionally excluded from public metadata;
//            it is never uploaded as public ERC-721 metadata.
//   2. intelligenceUpload — encrypted agent intelligence data
//      NOTE: systemPrompt and knowledge base are encrypted by the app server
//            before the encrypted envelope is uploaded to 0G.
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
  /**
   * URL served by /api/image/<hash> (computed from imageHash).
   */
  image: string;
  /**
   * 0G Storage root hash of the raw image file.
   */
  imageHash: string;
  // systemPrompt intentionally excluded from public metadata
}

// ---- Intelligence payload ----

export interface AgentPayload {
  name: string;
  systemPrompt: string;
  /** Knowledge base as multiple named files (preferred over the legacy single-file fields). */
  knowledgeBaseFiles?: Array<{ name: string; content: string }>;
}

interface EncryptedAgentPayload {
  version: 1;
  mode: "opendock-server-key";
  algorithm: "AES-256-GCM";
  iv: string;
  tag: string;
  ciphertext: string;
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
  /** MIME type of the uploaded file */
  contentType: string;
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
  const [tx, uploadErr] = await indexer.upload(blob, ZG_EVM_RPC, signer, undefined, undefined, {
    gasPrice: BigInt(20_000_000_000), // 20 GWEI
  });
  if (uploadErr !== null) {
    throw new Error(`0G upload error: ${uploadErr}`);
  }

  return {
    rootHash: rawHash as `0x${string}`,
    txHash: (tx as { txHash?: string } | null)?.txHash ?? null,
    // content-type is not available from the SDK; caller must supply it
    contentType: file.type || "application/octet-stream",
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
 * Encrypt and upload the private agent intelligence payload to 0G Storage.
 * Returns the root hash to be stored on-chain as IntelligentData.dataHash.
 * The server key is never returned to the browser or stored in DB.
 */
export async function uploadAgentData(
  payload: AgentPayload,
  signer: import("ethers").Signer
): Promise<UploadResult> {
  const res = await fetch("/api/intelligence/encrypt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      systemPrompt: payload.systemPrompt,
      knowledgeBaseFiles: payload.knowledgeBaseFiles,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error ?? "Failed to encrypt agent intelligence");
  }
  const data = (await res.json()) as { envelope: EncryptedAgentPayload };
  const file = encodeJSON(data.envelope);
  return uploadFile(file, signer);
}

/**
 * Upload a raw image file to 0G Storage.
 * Returns the root hash used as imageHash in AgentMetadata,
 * and the contentType for serving via /api/token/[id]/image.
 */
export async function uploadImage(
  imageFile: File,
  signer: import("ethers").Signer
): Promise<UploadResult> {
  return uploadFile(imageFile, signer);
}
