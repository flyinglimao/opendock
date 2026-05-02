// Preview chat endpoint.
// Runs the agent loop using the creator's system prompt and KB files uploaded
// to Vercel Blob. Does NOT store conversations in the database — the session
// is ephemeral and lives only in the browser.

import { NextRequest, NextResponse } from "next/server";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { verifySessionAuthHeader } from "@/lib/auth";
import {
  getUserComputeWalletSigner,
  hasAgentComputeRootSecret,
} from "@/lib/agent-compute-wallet";
import {
  getServiceMetadata,
  runAgentLoop,
  type ChatMessage,
} from "@/lib/agent-loop";
import { prisma } from "@/lib/db";
import type { KBFile } from "@/lib/tools";

interface PreviewChatBody {
  systemPrompt?: string;
  kbFiles?: { name: string; url: string }[];
  providerAddress: string;
  walletMode?: "hosted" | "user";
  servingHeaders?: { Authorization?: string } | null;
  messages: ChatMessage[];
}

export async function POST(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as PreviewChatBody;
  const walletMode = body.walletMode ?? "user";

  if (walletMode !== "hosted" && walletMode !== "user") {
    return NextResponse.json(
      { error: "walletMode must be hosted or user" },
      { status: 400 }
    );
  }
  if (!body.providerAddress) {
    return NextResponse.json({ error: "providerAddress required" }, { status: 400 });
  }
  if (walletMode === "user" && !body.servingHeaders?.Authorization) {
    return NextResponse.json(
      { error: "serving Authorization header required for user wallet mode" },
      { status: 400 }
    );
  }
  if (walletMode === "hosted" && !hasAgentComputeRootSecret()) {
    return NextResponse.json(
      { error: "Platform wallet root is not configured" },
      { status: 503 }
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }
  const latestUserMessage = body.messages[body.messages.length - 1];
  if (
    latestUserMessage?.role !== "user" ||
    typeof latestUserMessage.content !== "string" ||
    !latestUserMessage.content.trim()
  ) {
    return NextResponse.json(
      { error: "latest message must be a non-empty user message" },
      { status: 400 }
    );
  }

  // Fetch KB file contents from Vercel Blob URLs.
  let kbFiles: KBFile[] = [];
  if (body.kbFiles?.length) {
    kbFiles = await Promise.all(
      body.kbFiles.map(async ({ name, url }) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch KB file "${name}"`);
        const content = await res.text();
        return { name, content };
      })
    );
  }

  let braveApiKey: string | null = null;
  try {
    const userSetting = await prisma.userSetting.findUnique({
      where: { userAddress: address.toLowerCase() },
      select: { braveApiKey: true },
    });
    braveApiKey = userSetting?.braveApiKey ?? null;
  } catch {
    // Non-fatal: proceed without web search
  }

  try {
    const { endpoint, model } = await getServiceMetadata(body.providerAddress);
    let authorization = body.servingHeaders?.Authorization ?? "";
    let hostedBroker: Awaited<ReturnType<typeof createZGComputeNetworkBroker>> | null = null;

    if (walletMode === "hosted") {
      const { signer } = getUserComputeWalletSigner(address);
      hostedBroker = await createZGComputeNetworkBroker(signer);
      const hostedHeaders = await hostedBroker.inference.getRequestHeaders(
        body.providerAddress
      );
      authorization = hostedHeaders.Authorization;
    }

    const result = await runAgentLoop(
      endpoint,
      model,
      authorization,
      body.systemPrompt,
      body.messages,
      kbFiles,
      hostedBroker,
      body.providerAddress,
      braveApiKey
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.errorData ?? "0G provider request failed" },
        { status: result.errorStatus ?? 500 }
      );
    }

    return NextResponse.json({
      content: result.content,
      chatID: walletMode === "hosted" ? null : result.chatID,
      usage: result.usage ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
