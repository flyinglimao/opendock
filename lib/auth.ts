// lib/auth.ts
// Server-side helpers for verifying wallet-signed auth tokens and checking
// on-chain ownership / authorization for an iNFT token.

import {
  recoverMessageAddress,
  createPublicClient,
  getAddress,
  http,
  parseAbiItem,
} from "viem";
import { zgTestnet } from "@/lib/chain";
import {
  INFT_ADDRESS,
  INFT_ABI,
  MARKETPLACE_ABI,
  MARKETPLACE_ADDRESS,
} from "@/lib/contracts";

const publicClient = createPublicClient({
  chain: zgTestnet,
  transport: http(
    process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
      process.env.ZG_EVM_RPC ??
      zgTestnet.rpcUrls.default.http[0]
  ),
});

const AUTH_WINDOW_MS = 30 * 60 * 1000; // 30-minute signature window
const RENTAL_LOG_FROM_BLOCK = BigInt(
  process.env.MARKETPLACE_RENTAL_FROM_BLOCK ??
    process.env.NEXT_PUBLIC_MARKETPLACE_RENTAL_FROM_BLOCK ??
    "0"
);
const RENTAL_STARTED_EVENT = parseAbiItem(
  "event RentalStarted(uint256 indexed rentalId,uint256 indexed rentOrderId,address indexed renter,uint256 tokenId,uint256 duration)"
);

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

function hasMarketplace(): boolean {
  return Boolean(MARKETPLACE_ADDRESS && MARKETPLACE_ADDRESS !== "0x");
}

export async function hasActiveRentalAccess(
  tokenId: string,
  address: string
): Promise<boolean> {
  if (!hasMarketplace()) return false;

  try {
    const normalizedAddress = getAddress(address);
    const logs = await publicClient.getLogs({
      address: MARKETPLACE_ADDRESS,
      event: RENTAL_STARTED_EVENT,
      args: { renter: normalizedAddress },
      fromBlock: RENTAL_LOG_FROM_BLOCK,
      toBlock: "latest",
    });

    const tokenIdBigInt = BigInt(tokenId);
    const matchingLogs = [...logs]
      .filter((log) => log.args.tokenId === tokenIdBigInt)
      .reverse();

    for (const log of matchingLogs) {
      const rentalId = log.args.rentalId;
      if (rentalId === undefined) continue;
      const rental = await publicClient.readContract({
        address: MARKETPLACE_ADDRESS,
        abi: MARKETPLACE_ABI,
        functionName: "getActiveRental",
        args: [rentalId],
      });

      const isSameToken =
        rental.nftContract.toLowerCase() === INFT_ADDRESS.toLowerCase() &&
        rental.tokenId === tokenIdBigInt;
      const isSameRenter =
        rental.renter.toLowerCase() === normalizedAddress.toLowerCase();
      const expiresAt = rental.startTime + rental.duration;
      const isActive =
        !rental.revoked && BigInt(Math.floor(Date.now() / 1000)) < expiresAt;

      if (isSameToken && isSameRenter && isActive) return true;
    }
  } catch {
    return false;
  }

  return false;
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
