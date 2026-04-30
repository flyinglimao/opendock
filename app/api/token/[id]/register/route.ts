// app/api/token/[id]/register/route.ts
// Called by the frontend immediately after a successful mint.
// Saves the token record to DB and triggers a background sync from 0G Storage.
//
// POST /api/token/<tokenId>/register
//   Body: { metadataHash, dataHash?, owner? }
//
// The endpoint returns quickly; 0G download happens asynchronously.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const ZG_INDEXER =
  process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

interface RegisterBody {
  metadataHash: string;
  dataHash?: string;
  owner?: string;
}

/** Try to fetch metadata from 0G and update the DB record. Fire-and-forget. */
async function syncMetadataFromZG(tokenId: string, metadataHash: string) {
  try {
    const res = await fetch(`${ZG_INDEXER}/file/${metadataHash}`, {
      cache: "no-store",
    });
    if (!res.ok) return; // Not ready yet — client will poll /status
    const meta = (await res.json()) as {
      name?: string;
      description?: string;
      image?: string;
      imageHash?: string;
      systemPrompt?: string;
    };
    await prisma.agentToken.update({
      where: { tokenId },
      data: {
        name: meta.name ?? null,
        description: meta.description ?? null,
        image: meta.image ?? null,
        imageHash: meta.imageHash ?? null,
        systemPrompt: meta.systemPrompt ?? null,
        metadataReady: true,
      },
    });
  } catch {
    // Silently ignore — /status will retry later
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as RegisterBody;

  if (!body.metadataHash) {
    return NextResponse.json({ error: "metadataHash required" }, { status: 400 });
  }

  // Upsert the token record (idempotent — safe to call multiple times)
  await prisma.agentToken.upsert({
    where: { tokenId: id },
    create: {
      tokenId: id,
      metadataHash: body.metadataHash,
      dataHash: body.dataHash ?? null,
      owner: body.owner ?? null,
      metadataReady: false,
    },
    update: {
      metadataHash: body.metadataHash,
      dataHash: body.dataHash ?? null,
      owner: body.owner ?? null,
    },
  });

  // Kick off 0G sync without blocking the response
  syncMetadataFromZG(id, body.metadataHash);

  return NextResponse.json({ registered: true });
}
