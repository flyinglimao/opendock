// app/api/token/[id]/system-prompt/route.ts
// Auth-gated endpoint for preparing system prompt access from encrypted 0G intelligence.
//
// GET  /api/token/<id>/system-prompt
//   Authorization: Bearer <base64(JSON({address, timestamp, signature}))>
//   Requires: caller is owner or authorized user on-chain.
//   Returns: { systemPrompt: string } once TEE decryption is available.
//
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAuthHeader, checkOnChainAuth } from "@/lib/auth";
import { downloadZGJson } from "@/lib/0g-download";
import type { EncryptedAgentPayload } from "@/lib/encryption";

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

  if (!token.dataHash) {
    return NextResponse.json(
      { error: "Encrypted intelligence is not registered yet" },
      { status: 503 }
    );
  }

  const envelope = await downloadZGJson<EncryptedAgentPayload>(token.dataHash);
  if (!envelope) {
    return NextResponse.json(
      { error: "Encrypted intelligence not available" },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { error: "TEE decryption is not available yet" },
    { status: 503 }
  );
}
