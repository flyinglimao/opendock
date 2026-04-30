// app/api/token/[id]/system-prompt/route.ts
// Temporary auth-gated decryption endpoint for server-key encrypted intelligence.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAuthHeader, checkOnChainAuth } from "@/lib/auth";
import { downloadZGJson } from "@/lib/0g-download";
import {
  decryptAgentIntelligence,
  type EncryptedAgentPayload,
} from "@/lib/encryption";

function buildSystemPrompt(
  systemPrompt: string | undefined,
  knowledgeBase: string | null | undefined,
  knowledgeBaseName: string | null | undefined
): string {
  const base = systemPrompt?.trim() ?? "";
  const kb = knowledgeBase?.trim();
  if (!kb) return base;
  const label = knowledgeBaseName ? `Knowledge base (${knowledgeBaseName})` : "Knowledge base";
  return `${base}\n\n${label}:\n${kb}`;
}

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

  const token = await prisma.agentToken.findUnique({
    where: { tokenId: id },
    select: { dataHash: true },
  });
  if (!token?.dataHash) {
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

  let payload;
  try {
    payload = decryptAgentIntelligence(envelope);
  } catch {
    return NextResponse.json(
      { error: "Encrypted intelligence could not be decrypted with this server key" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    systemPrompt: buildSystemPrompt(
      payload.systemPrompt,
      payload.knowledgeBase,
      payload.knowledgeBaseName
    ),
  });
}
