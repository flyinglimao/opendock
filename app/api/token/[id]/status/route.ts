// app/api/token/[id]/status/route.ts
// Lightweight endpoint: check whether a token's 0G Storage data is available.
//
// Returns:
//   { available: true, name?, description?, image? }   — data is accessible
//   { available: false }                               — still syncing

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

  // 1. Get metadataHash from chain
  let metadataHash: `0x${string}`;
  try {
    metadataHash = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: INFT_ABI,
      functionName: "metadataHashOf",
      args: [BigInt(id)],
    })) as `0x${string}`;
  } catch {
    return NextResponse.json({ available: false, error: "token_not_found" }, { status: 404 });
  }

  // 2. Try to fetch metadata from 0G indexer — no cache so we always get fresh status
  try {
    const res = await fetch(`${ZG_INDEXER}/file/${metadataHash}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ available: false });
    }
    const meta = (await res.json()) as {
      name?: string;
      description?: string;
      image?: string;
    };
    return NextResponse.json({
      available: true,
      name: meta.name,
      description: meta.description,
      image: meta.image,
    });
  } catch {
    return NextResponse.json({ available: false });
  }
}
