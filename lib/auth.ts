// lib/auth.ts
// Server-side helpers for verifying wallet-signed auth tokens and checking
// on-chain ownership / authorization for an iNFT token.

import { recoverMessageAddress, createPublicClient, http } from "viem";
import { zgTestnet } from "@/lib/chain";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";

const publicClient = createPublicClient({ chain: zgTestnet, transport: http() });

const AUTH_WINDOW_MS = 30 * 60 * 1000; // 30-minute signature window

export interface AuthPayload {
  address: string;
  timestamp: number;
  signature: string;
}

/** Canonical message the client signs to authenticate. */
export function buildAuthMessage(tokenId: string, timestamp: number): string {
  return `OpenDock access request\nToken: ${tokenId}\nTimestamp: ${timestamp}`;
}

/**
 * Decode and verify a Bearer auth header.
 * Header value: `Bearer <base64(JSON(AuthPayload))>`
 * Returns the verified Ethereum address, or null if invalid / expired.
 */
export async function verifyAuthHeader(
  tokenId: string,
  authHeader: string | null
): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const raw = Buffer.from(authHeader.slice(7), "base64").toString("utf8");
    const { address, timestamp, signature } = JSON.parse(raw) as AuthPayload;
    if (Math.abs(Date.now() - timestamp) > AUTH_WINDOW_MS) return null;
    const recovered = await recoverMessageAddress({
      message: buildAuthMessage(tokenId, timestamp),
      signature: signature as `0x${string}`,
    });
    if (recovered.toLowerCase() !== address.toLowerCase()) return null;
    return address;
  } catch {
    return null;
  }
}

/** Check on-chain whether `address` is the owner or an authorized user of `tokenId`. */
export async function checkOnChainAuth(
  tokenId: string,
  address: string
): Promise<{ isOwner: boolean; isAuthorized: boolean }> {
  try {
    const [owner, authorizedUsers] = await Promise.all([
      publicClient.readContract({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      }) as Promise<string>,
      publicClient.readContract({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "authorizedUsersOf",
        args: [BigInt(tokenId)],
      }) as Promise<string[]>,
    ]);
    const addr = address.toLowerCase();
    const isOwner = owner.toLowerCase() === addr;
    const isAuthorized =
      isOwner || authorizedUsers.some((u) => u.toLowerCase() === addr);
    return { isOwner, isAuthorized };
  } catch {
    return { isOwner: false, isAuthorized: false };
  }
}
