// app/api/token/[id]/status/route.ts
// Check whether a token's 0G Storage metadata is accessible.
//
// Strategy:
//   1. DB hit → if metadataReady, return cached data instantly.
//   2. DB miss or not ready → try 0G indexer, back-fill DB on success.
//   3. Neither → return { available: false }.

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { zgTestnet } from "@/lib/chain";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";
import { prisma } from "@/lib/db";

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

  // 1. Check DB cache first (fast path)
  const cached = await prisma.agentToken.findUnique({ where: { tokenId: id } });
  if (cached?.metadataReady) {
    return NextResponse.json({
      available: true,
      name: cached.name,
      description: cached.description,
      image: cached.image,
    });
  }

  // 2. Get metadataHash — from DB if registered, else from chain
  let metadataHash: string | null = cached?.metadataHash ?? null;
  if (!metadataHash) {
    try {
      metadataHash = (await publicClient.readContract({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "metadataHashOf",
        args: [BigInt(id)],
      })) as string;
    } catch {
      return NextResponse.json({ available: false, error: "token_not_found" }, { status: 404 });
    }
  }

  // 3. Try 0G indexer
  try {
    const res = await fetch(`${ZG_INDEXER}/file/${metadataHash}`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ available: false });

    const meta = (await res.json()) as {
      name?: string;
      description?: string;
      image?: string;
      imageHash?: string;
      systemPrompt?: string;
    };

    // Back-fill DB
    await prisma.agentToken.upsert({
      where: { tokenId: id },
      create: {
        tokenId: id,
        metadataHash,
        name: meta.name ?? null,
        description: meta.description ?? null,
        image: meta.image ?? null,
        imageHash: meta.imageHash ?? null,
        systemPrompt: meta.systemPrompt ?? null,
        metadataReady: true,
      },
      update: {
        name: meta.name ?? null,
        description: meta.description ?? null,
        image: meta.image ?? null,
        imageHash: meta.imageHash ?? null,
        systemPrompt: meta.systemPrompt ?? null,
        metadataReady: true,
      },
    });

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
