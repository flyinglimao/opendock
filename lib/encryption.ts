// lib/encryption.ts
// Temporary server-key encryption for private agent intelligence.
//
// This simulates the future iNFT/TEE flow: 0G stores encrypted data, and the
// app server gates access by wallet ownership/authorization before decrypting.
// It is not equivalent to TEE because the server can decrypt plaintext.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { KBFile } from "@/lib/tools";

export interface EncryptedAgentPayload {
  version: 1;
  mode: "opendock-server-key";
  algorithm: "AES-256-GCM";
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface AgentIntelligencePayload {
  name?: string;
  systemPrompt?: string;
  /** @deprecated Use knowledgeBaseFiles instead */
  knowledgeBase?: string | null;
  /** @deprecated Use knowledgeBaseFiles instead */
  knowledgeBaseName?: string | null;
  knowledgeBaseFiles?: KBFile[];
  version?: number;
}

function getServerKey(): Buffer {
  const configured = process.env.SYSTEM_PROMPT_KEY;
  if (configured && /^[0-9a-fA-F]{64}$/.test(configured)) {
    return Buffer.from(configured, "hex");
  }

  // Development fallback keeps local flows usable. Production should set a
  // random 32-byte key encoded as 64 hex chars.
  return createHash("sha256")
    .update(configured || "opendock-development-system-prompt-key")
    .digest();
}

export function encryptAgentIntelligence(
  payload: AgentIntelligencePayload
): EncryptedAgentPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getServerKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    mode: "opendock-server-key",
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptAgentIntelligence(
  envelope: EncryptedAgentPayload
): AgentIntelligencePayload {
  if (
    envelope.version !== 1 ||
    envelope.mode !== "opendock-server-key" ||
    envelope.algorithm !== "AES-256-GCM"
  ) {
    throw new Error("Unsupported intelligence encryption envelope");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getServerKey(),
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext) as AgentIntelligencePayload;
}
