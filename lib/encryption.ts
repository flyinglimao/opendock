// lib/encryption.ts
// Server-side AES-256-GCM encryption for system prompts.
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
