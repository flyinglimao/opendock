// lib/0g-storage.ts
// Helpers for uploading data to 0G Storage and getting Merkle root hashes.
//
// Two separate uploads happen during agent creation:
//   1. metadataUpload — ERC-721 metadata JSON (name, description, image)
//      NOTE: systemPrompt is intentionally excluded from public metadata;
//            it is stored encrypted server-side and served only to authorized users.
//   2. intelligenceUpload — encrypted agent intelligence data
//      NOTE: systemPrompt and knowledge base are encrypted before 0G upload.
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
  // systemPrompt intentionally excluded — stored encrypted server-side only
}

// ---- Intelligence payload ----

export interface AgentPayload {
  name: string;
  systemPrompt: string;
  /** Raw text content of an optional knowledge-base file */
  knowledgeBase?: string;
  knowledgeBaseName?: string;
}

interface EncryptedAgentPayload {
  version: 1;
  algorithm: "AES-256-GCM";
  iv: string;
  ciphertext: string;
}

function encodeJSON(obj: unknown): File {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new File([bytes.buffer as ArrayBuffer], "data.json", {
    type: "application/json",
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encryptAgentPayload(payload: AgentPayload): Promise<{
  file: File;
  key: string;
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({
    name: payload.name,
    systemPrompt: payload.systemPrompt,
    knowledgeBase: payload.knowledgeBase ?? null,
    knowledgeBaseName: payload.knowledgeBaseName ?? null,
    version: 1,
  }));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plain
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const envelope: EncryptedAgentPayload = {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };

  return {
    file: encodeJSON(envelope),
    key: bytesToBase64(rawKey),
  };
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
 * The local symmetric key is intentionally not returned or persisted here;
 * production decryption should happen through the TEE/reencryption flow.
 */
export async function uploadAgentData(
  payload: AgentPayload,
  signer: import("ethers").Signer
): Promise<UploadResult> {
  const { file } = await encryptAgentPayload(payload);
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
