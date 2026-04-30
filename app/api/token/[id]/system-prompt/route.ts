// app/api/token/[id]/system-prompt/route.ts
// Auth-gated endpoint for reading (and owner-only updating) the encrypted system prompt.
//
// GET  /api/token/<id>/system-prompt
//   Authorization: Bearer <base64(JSON({address, timestamp, signature}))>
//   Requires: caller is owner or authorized user on-chain.
//   Returns: { systemPrompt: string }
//
// POST /api/token/<id>/system-prompt
//   Authorization: Bearer <...> (owner only)
//   Body: { systemPrompt: string }
//   Returns: { ok: true }

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAuthHeader, checkOnChainAuth } from "@/lib/auth";
import { encryptSystemPrompt, decryptSystemPrompt } from "@/lib/encryption";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const address = await verifyAuthHeader(id, req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { isAuthorized } = await checkOnChainAuth(id, address);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const token = await prisma.agentToken.findUnique({ where: { tokenId: id } });
  if (!token) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  const systemPrompt = token.systemPrompt
    ? decryptSystemPrompt(token.systemPrompt)
    : "";

  return NextResponse.json({ systemPrompt });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const address = await verifyAuthHeader(id, req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { isOwner } = await checkOnChainAuth(id, address);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden: owner only" }, { status: 403 });
  }

  const body = (await req.json()) as { systemPrompt?: string };
  const plain = body.systemPrompt ?? "";

  await prisma.agentToken.upsert({
    where: { tokenId: id },
    create: {
      tokenId: id,
      metadataHash: "0x",
      systemPrompt: encryptSystemPrompt(plain),
    },
    update: {
      systemPrompt: encryptSystemPrompt(plain),
    },
  });

  return NextResponse.json({ ok: true });
}
