// app/api/token/[id]/image/route.ts
// Convenience route: resolves the image for a given token ID.
//
// Flow:
//   1. Read the metadataHash for token `id` from the on-chain contract.
//   2. Download the metadata JSON from 0G Storage.
//   3. Redirect to /api/image/<imageHash> (the canonical image route).
//
// This allows NFT marketplaces to use /api/token/{id}/image as the image URL,
// while the actual bytes come from /api/image/<hash> (immutable, cacheable).

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { zgTestnet } from "@/lib/chain";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";

const ZG_INDEXER =
  process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

const publicClient = createPublicClient({
  chain: zgTestnet,
  transport: http(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tokenId = BigInt(id);

  // 1. Read metadataHash from contract
  let metadataHash: `0x${string}`;
  try {
    metadataHash = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: INFT_ABI,
      functionName: "metadataHashOf",
      args: [tokenId],
    })) as `0x${string}`;
  } catch {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  // 2. Download metadata JSON from 0G
  let imageHash: string | undefined;
  try {
    const res = await fetch(`${ZG_INDEXER}/file/${metadataHash}`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const meta = (await res.json()) as { imageHash?: string };
      imageHash = meta.imageHash;
    }
  } catch { /* ignore, fall through */ }

  if (!imageHash) {
    return NextResponse.json({ error: "Image not found in metadata" }, { status: 404 });
  }

  // 3. Redirect to the canonical hash-based image route
  return NextResponse.redirect(new URL(`/api/image/${imageHash}`, _req.url), {
    status: 302,
    headers: {
      // Short cache on redirect so it stays in sync if metadata changes
      "Cache-Control": "public, max-age=3600",
    },
  });
}
