// app/api/token/[id]/chat/route.ts
// Auth-gated backend proxy for 0G Compute.
//
// The browser generates the 0G serving Authorization header with the user's
// wallet, but the server decrypts the agent intelligence and calls the model.
// This keeps the system prompt out of browser responses.
//
// When the agent has a knowledge base, tool calling is used so the LLM can
// search and read files on demand rather than receiving the entire KB upfront.

import { NextRequest, NextResponse } from "next/server";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { prisma } from "@/lib/db";
import { verifyAuthHeader, checkOnChainAuth } from "@/lib/auth";
import { downloadZGJson } from "@/lib/0g-download";
import {
  getAgentComputeWalletSigner,
  hasAgentComputeRootSecret,
} from "@/lib/agent-compute-wallet";
import {
  decryptAgentIntelligence,
  type EncryptedAgentPayload,
} from "@/lib/encryption";
import { getKBFiles } from "@/lib/tools";
import {
  getServiceMetadata,
  runAgentLoop,
  type ChatMessage,
} from "@/lib/agent-loop";

// ---- helpers ----

function buildConversationTitle(message: string): string {
  const title = message.replace(/\s+/g, " ").trim();
  if (!title) return "New conversation";
  return title.length > 64 ? `${title.slice(0, 61)}...` : title;
}

// ---- types ----

interface ChatBody {
  providerAddress: string;
  conversationId?: string | null;
  walletMode?: "hosted" | "user";
  servingHeaders?: {
    Authorization?: string;
  } | null;
  messages: ChatMessage[];
}

// ---- route handler ----

export async function POST(
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

  const body = (await req.json()) as ChatBody;
  const walletMode = body.walletMode ?? "user";
  if (walletMode !== "hosted" && walletMode !== "user") {
    return NextResponse.json(
      { error: "walletMode must be hosted or user" },
      { status: 400 }
    );
  }
  if (!body.providerAddress) {
    return NextResponse.json(
      { error: "providerAddress required" },
      { status: 400 }
    );
  }
  if (walletMode === "user" && !body.servingHeaders?.Authorization) {
    return NextResponse.json(
      { error: "serving Authorization header required for user wallet mode" },
      { status: 400 }
    );
  }
  if (walletMode === "hosted" && !hasAgentComputeRootSecret()) {
    return NextResponse.json(
      { error: "Hosted compute wallet root is not configured" },
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
  const existingConversation = body.conversationId
    ? await prisma.agentConversation.findFirst({
        where: {
          id: body.conversationId,
          tokenId: id,
          userAddress: address.toLowerCase(),
        },
        select: { id: true },
      })
    : null;
  if (body.conversationId && !existingConversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
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

  let agentPrompt: string | undefined;
  let kbFiles: ReturnType<typeof getKBFiles>;
  let braveApiKey: string | null = null;
  try {
    const payload = decryptAgentIntelligence(envelope);
    agentPrompt = payload.systemPrompt;
    kbFiles = getKBFiles(payload);

    try {
      const userSetting = await prisma.userSetting.findUnique({
        where: { userAddress: address.toLowerCase() },
        select: { braveApiKey: true },
      });
      braveApiKey = userSetting?.braveApiKey ?? null;
    } catch {
      // Non-fatal: proceed without web search
    }
  } catch {
    return NextResponse.json(
      { error: "Encrypted intelligence could not be decrypted with this server key" },
      { status: 503 }
    );
  }

  try {
    const { endpoint, model } = await getServiceMetadata(body.providerAddress);
    let authorization = body.servingHeaders?.Authorization ?? "";
    let hostedBroker:
      | Awaited<ReturnType<typeof createZGComputeNetworkBroker>>
      | null = null;

    if (walletMode === "hosted") {
      const { signer } = getAgentComputeWalletSigner(id, address);
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
      agentPrompt,
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

    const assistantMessage = result.content;
    const now = new Date();
    const conversation = await prisma.$transaction(async (tx) => {
      const activeConversation =
        existingConversation ??
        (await tx.agentConversation.create({
          data: {
            tokenId: id,
            userAddress: address.toLowerCase(),
            providerAddress: body.providerAddress,
            title: buildConversationTitle(latestUserMessage.content),
            lastMessageAt: now,
          },
          select: { id: true },
        }));

      const messageCount = await tx.agentConversationMessage.count({
        where: { conversationId: activeConversation.id },
      });

      await tx.agentConversationMessage.createMany({
        data: [
          {
            conversationId: activeConversation.id,
            sequence: messageCount + 1,
            role: "user",
            content: latestUserMessage.content,
            createdAt: now,
          },
          {
            conversationId: activeConversation.id,
            sequence: messageCount + 2,
            role: "assistant",
            content: assistantMessage,
            createdAt: now,
          },
        ],
      });

      return tx.agentConversation.update({
        where: { id: activeConversation.id },
        data: {
          providerAddress: body.providerAddress,
          lastMessageAt: now,
        },
        select: {
          id: true,
          title: true,
          providerAddress: true,
          createdAt: true,
          updatedAt: true,
          lastMessageAt: true,
          _count: { select: { messages: true } },
        },
      });
    });

    return NextResponse.json({
      content: assistantMessage,
      chatID: walletMode === "hosted" ? null : result.chatID,
      usage: result.usage ?? null,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        providerAddress: conversation.providerAddress,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        messageCount: conversation._count.messages,
        preview: assistantMessage,
        previewRole: "assistant",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
