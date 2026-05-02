// app/api/intelligence/encrypt/route.ts
// Temporary server-key encryption endpoint for agent intelligence.

import { NextRequest, NextResponse } from "next/server";
import { encryptAgentIntelligence } from "@/lib/encryption";

interface EncryptBody {
  name: string;
  systemPrompt: string;
  knowledgeBaseFiles?: Array<{ name: string; content: string }>;
  /** @deprecated */
  knowledgeBase?: string;
  /** @deprecated */
  knowledgeBaseName?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as EncryptBody;

  if (!body.systemPrompt?.trim()) {
    return NextResponse.json(
      { error: "systemPrompt required" },
      { status: 400 }
    );
  }

  const envelope = encryptAgentIntelligence({
    name: body.name,
    systemPrompt: body.systemPrompt,
    knowledgeBaseFiles: body.knowledgeBaseFiles,
    knowledgeBase: body.knowledgeBase ?? null,
    knowledgeBaseName: body.knowledgeBaseName ?? null,
    version: 1,
  });

  return NextResponse.json({ envelope });
}
