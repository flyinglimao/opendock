// lib/auth.ts
// Server-side helpers for verifying wallet-signed auth tokens and checking
// on-chain ownership / authorization for an iNFT token.

import {
  recoverMessageAddress,
  createPublicClient,
  getAddress,
  http,
} from "viem";
import { zgTestnet } from "@/lib/chain";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";

const publicClient = createPublicClient({
  chain: zgTestnet,
  transport: http(
    process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
      process.env.ZG_EVM_RPC ??
      zgTestnet.rpcUrls.default.http[0]
  ),
});

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

/** Canonical session message for one signature across token-scoped requests. */
export function buildSessionAuthMessage(timestamp: number): string {
  return `OpenDock session request\nTimestamp: ${timestamp}`;
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
    const tokenMessage = buildAuthMessage(tokenId, timestamp);
    const sessionMessage = buildSessionAuthMessage(timestamp);
    const recoveredAddresses = await Promise.all([
      recoverMessageAddress({
        message: tokenMessage,
        signature: signature as `0x${string}`,
      }).catch(() => null),
      recoverMessageAddress({
        message: sessionMessage,
        signature: signature as `0x${string}`,
      }).catch(() => null),
    ]);
    if (
      !recoveredAddresses.some(
        (recovered) => recovered?.toLowerCase() === address.toLowerCase()
      )
    ) {
      return null;
    }
    return address;
  } catch {
    return null;
  }
}


export async function hasActiveRentalAccess(
  tokenId: string,
  address: string
): Promise<boolean> {
  try {
    const authorizedUsers = await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: INFT_ABI,
      functionName: "authorizedUsersOf",
      args: [BigInt(tokenId)],
    });
    const normalized = getAddress(address).toLowerCase();
    return (authorizedUsers as string[]).some(
      (u) => u.toLowerCase() === normalized
    );
  } catch {
    return false;
  }
}

/** Check on-chain whether `address` owns `tokenId` or has an active rental. */
export async function checkOnChainAuth(
  tokenId: string,
  address: string
): Promise<{ isOwner: boolean; isAuthorized: boolean }> {
  try {
    const owner = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: INFT_ABI,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    })) as string;
    const addr = address.toLowerCase();
    const isOwner = owner.toLowerCase() === addr;
    const isAuthorized = isOwner || (await hasActiveRentalAccess(tokenId, address));
    return { isOwner, isAuthorized };
  } catch {
    return { isOwner: false, isAuthorized: false };
  }
}
