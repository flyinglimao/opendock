// app/api/token/[id]/register/route.ts
// Called by the frontend immediately after a successful mint.
// Saves the token record to DB and triggers a background sync from 0G Storage.
//
// POST /api/token/<tokenId>/register
//   Body: { metadataHash, dataHash?, owner?, rentPricePerSecond? }
//
// No intelligence keys or plaintext prompts are stored in DB.
// The endpoint returns quickly; 0G download happens asynchronously.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { downloadZGJson } from "@/lib/0g-download";

interface RegisterBody {
  metadataHash: string;
  dataHash?: string;
  owner?: string;
  rentPricePerSecond?: string;
}

/** Try to fetch metadata from 0G and update the DB record. Fire-and-forget. */
async function syncMetadataFromZG(tokenId: string, metadataHash: string) {
  const meta = await downloadZGJson<{
    name?: string;
    description?: string;
    image?: string;
    imageHash?: string;
  }>(metadataHash);
  if (!meta) return;
  await prisma.agentToken.update({
    where: { tokenId },
    data: {
      name: meta.name ?? null,
      description: meta.description ?? null,
      image: meta.image ?? null,
      imageHash: meta.imageHash ?? null,
      metadataReady: true,
    },
  }).catch(() => {});
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
      rentPricePerSecond: body.rentPricePerSecond ?? null,
      metadataReady: false,
    },
    update: {
      metadataHash: body.metadataHash,
      dataHash: body.dataHash ?? null,
      owner: body.owner ?? null,
      ...(body.rentPricePerSecond !== undefined && {
        rentPricePerSecond: body.rentPricePerSecond,
      }),
    },
  });

  // Kick off 0G sync without blocking the response
  syncMetadataFromZG(id, body.metadataHash);

  return NextResponse.json({ registered: true });
}
