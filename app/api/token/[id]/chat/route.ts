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
import {
  createZGComputeNetworkBroker,
  createZGComputeNetworkReadOnlyBroker,
} from "@0glabs/0g-serving-broker";
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
import { KB_TOOLS, executeKBTool, getKBFiles, type KBFile } from "@/lib/kb-tools";

const ZG_RPC =
  process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
  process.env.ZG_EVM_RPC ??
  "https://rpc.ankr.com/0g_galileo_testnet_evm";

// ---- types ----

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatBody {
  providerAddress: string;
  conversationId?: string | null;
  walletMode?: "hosted" | "user";
  servingHeaders?: {
    Authorization?: string;
  } | null;
  messages: ChatMessage[];
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// ---- helpers ----

function buildSystemPrompt(
  systemPrompt: string | undefined,
  hasKB: boolean
): string {
  const base = systemPrompt?.trim() ?? "";
  if (!hasKB) return base;
  return (
    base +
    "\n\nYou have access to a knowledge base. Use the provided tools" +
    " (kb_list_files, kb_search, kb_read_file) to find and read relevant" +
    " information before answering questions that require specific knowledge."
  );
}

function buildConversationTitle(message: string): string {
  const title = message.replace(/\s+/g, " ").trim();
  if (!title) return "New conversation";
  return title.length > 64 ? `${title.slice(0, 61)}...` : title;
}

async function getServiceMetadata(providerAddress: string) {
  const broker = await createZGComputeNetworkReadOnlyBroker(ZG_RPC);
  const services = await broker.inference.listService();
  const service = services.find(
    (item) => item.provider.toLowerCase() === providerAddress.toLowerCase()
  );
  if (!service) throw new Error("Provider not found");
  return {
    endpoint: `${service.url}/v1/proxy`,
    model: service.model,
  };
}

// ---- agent loop ----

const MAX_TOOL_ITERATIONS = 8;

interface LoopResult {
  content: string;
  usage: unknown;
  chatID: string | null;
  ok: boolean;
  errorData?: unknown;
  errorStatus?: number;
}

async function runAgentLoop(
  endpoint: string,
  model: string,
  authorization: string,
  systemPrompt: string,
  messages: ChatMessage[],
  kbFiles: KBFile[],
  hostedBroker: Awaited<ReturnType<typeof createZGComputeNetworkBroker>> | null,
  providerAddress: string,
  walletMode: "hosted" | "user"
): Promise<LoopResult> {
  const tools = kbFiles.length > 0 ? KB_TOOLS : undefined;
  const internalMessages: LLMMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let lastChatID: string | null = null;
  let lastUsage: unknown = null;
  let assistantContent = "";

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const reqBody: Record<string, unknown> = {
      model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        ...internalMessages,
      ],
    };
    if (tools) reqBody.tools = tools;

    const llmResponse = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(reqBody),
    });

    const llmData = (await llmResponse.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: ToolCall[];
        };
      }>;
      id?: string;
      chatID?: string;
      usage?: unknown;
      error?: unknown;
    };

    if (!llmResponse.ok) {
      return {
        content: "",
        usage: null,
        chatID: null,
        ok: false,
        errorData: llmData.error ?? "0G provider request failed",
        errorStatus: llmResponse.status,
      };
    }

    const chatID =
      llmResponse.headers.get("ZG-Res-Key") ??
      llmResponse.headers.get("zg-res-key") ??
      llmData.id ??
      llmData.chatID ??
      null;
    lastChatID = chatID;
    lastUsage = llmData.usage;

    if (walletMode === "hosted" && hostedBroker && chatID) {
      await hostedBroker.inference.processResponse(
        providerAddress,
        chatID,
        llmData.usage ? JSON.stringify(llmData.usage) : undefined
      );
    }

    const message = llmData.choices?.[0]?.message;
    if (message?.content) assistantContent = message.content;

    // No tool calls → final answer
    if (!message?.tool_calls?.length) {
      return {
        content: assistantContent,
        usage: lastUsage,
        chatID: walletMode === "hosted" ? null : lastChatID,
        ok: true,
      };
    }

    // Add assistant turn with tool_calls to the running context
    internalMessages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });

    // Execute each tool call and append results
    for (const toolCall of message.tool_calls) {
      let toolArgs: Record<string, string> = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, string>;
      } catch {
        // ignore parse errors; executeKBTool handles missing args gracefully
      }
      const result = executeKBTool(toolCall.function.name, toolArgs, kbFiles);
      internalMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  // Hit max iterations — return whatever content we accumulated
  return {
    content: assistantContent,
    usage: lastUsage,
    chatID: walletMode === "hosted" ? null : lastChatID,
    ok: true,
  };
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

  let systemPrompt: string;
  let kbFiles: KBFile[];
  try {
    const payload = decryptAgentIntelligence(envelope);
    kbFiles = getKBFiles(payload);
    systemPrompt = buildSystemPrompt(payload.systemPrompt, kbFiles.length > 0);
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
      systemPrompt,
      body.messages,
      kbFiles,
      hostedBroker,
      body.providerAddress,
      walletMode
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
      chatID: result.chatID,
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
