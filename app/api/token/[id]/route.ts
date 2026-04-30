// app/api/token/[id]/route.ts
// ERC-721 metadata endpoint.
//
// Strategy:
//   1. DB hit (metadataReady) → serve cached JSON instantly.
//   2. DB miss or not ready → read chain hash, fetch from 0G, back-fill DB.
//   3. 0G unavailable → minimal fallback so marketplaces don't break.

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { zgTestnet } from "@/lib/chain";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";
import { prisma } from "@/lib/db";
import { downloadZGJson } from "@/lib/0g-download";

const publicClient = createPublicClient({
  chain: zgTestnet,
  transport: http(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. DB fast path
  const cached = await prisma.agentToken.findUnique({ where: { tokenId: id } });
  if (cached?.metadataReady) {
    return NextResponse.json(
      {
        name: cached.name ?? `OpenDock Agent #${id}`,
        description: cached.description ?? "",
        image: cached.image ?? "",
        imageHash: cached.imageHash ?? "",
        systemPrompt: cached.systemPrompt ?? "",
      },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }
    );
  }

  // 2. Read metadataHash from DB or chain
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
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
  }

  // 3. Download from 0G
  const meta = await downloadZGJson<{
    name?: string;
    description?: string;
    image?: string;
    imageHash?: string;
    systemPrompt?: string;
  }>(metadataHash);

  if (meta) {
    // Back-fill DB (best-effort)
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
    }).catch(() => {});

    return NextResponse.json(meta, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  }

  // Minimal fallback
  return NextResponse.json(
    { name: `OpenDock Agent #${id}`, description: "", image: "" },
    { status: 200 }
  );
}
