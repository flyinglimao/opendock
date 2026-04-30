// lib/encryption.ts
// Server-side AES-256-GCM helpers for private agent intelligence secrets.
// Wire up the key via SYSTEM_PROMPT_KEY env var (64 hex chars = 32 bytes).
// If the env var is missing a zero-padded placeholder is used — set a real key in production.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_HEX = process.env.SYSTEM_PROMPT_KEY ?? "";
const KEY = Buffer.from(KEY_HEX.padEnd(64, "0").slice(0, 64), "hex");

// Format: base64( iv[12] | authTag[16] | ciphertext )
export function encryptSystemPrompt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSystemPrompt(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export interface EncryptedAgentPayload {
  version: 1;
  algorithm: "AES-256-GCM";
  iv: string;
  ciphertext: string;
}

export interface AgentIntelligencePayload {
  name?: string;
  systemPrompt?: string;
  knowledgeBase?: string | null;
  knowledgeBaseName?: string | null;
  version?: number;
}

export function decryptAgentIntelligence(
  envelope: EncryptedAgentPayload,
  rawKeyBase64: string
): AgentIntelligencePayload {
  if (envelope.algorithm !== "AES-256-GCM") {
    throw new Error("Unsupported intelligence encryption algorithm");
  }

  const key = Buffer.from(rawKeyBase64, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const encrypted = Buffer.from(envelope.ciphertext, "base64");
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plain) as AgentIntelligencePayload;
}
