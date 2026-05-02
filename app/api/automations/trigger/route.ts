import { NextRequest, NextResponse } from "next/server";
import {
  createZGComputeNetworkBroker,
  createZGComputeNetworkReadOnlyBroker,
} from "@0glabs/0g-serving-broker";
import { prisma } from "@/lib/db";
import { checkOnChainAuth } from "@/lib/auth";
import { downloadZGJson } from "@/lib/0g-download";
import { COMPUTE_PROVIDERS } from "@/lib/compute-providers";
import {
  getAgentComputeWalletSigner,
  hasAgentComputeRootSecret,
} from "@/lib/agent-compute-wallet";
import {
  decryptAgentIntelligence,
  type EncryptedAgentPayload,
} from "@/lib/encryption";
import { findNextCronOccurrence } from "@/lib/cron";
import { KB_TOOLS, executeKBTool, getKBFiles, type KBFile } from "@/lib/kb-tools";
import { WEB_SEARCH_TOOL, executeBraveSearch } from "@/lib/web-search";

export const dynamic = "force-dynamic";

const ZG_RPC =
  process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
  process.env.ZG_EVM_RPC ??
  "https://rpc.ankr.com/0g_galileo_testnet_evm";
const DEFAULT_PROVIDER_ADDRESS = COMPUTE_PROVIDERS[0].address;
const MAX_AUTOMATIONS_PER_TRIGGER = 25;
const MAX_TOOL_ITERATIONS = 8;
const TRIGGER_SECRET = process.env.CRON_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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

interface LoopResult {
  content: string;
  usage: unknown;
  ok: boolean;
  errorData?: unknown;
  errorStatus?: number;
}

interface ClaimedRun {
  id: string;
  automationId: string;
  tokenId: string;
  userAddress: string;
  instruction: string;
  scheduledFor: Date;
  agentName: string;
  dataHash: string | null;
}

function isAuthorizedTrigger(req: NextRequest): boolean {
  if (!TRIGGER_SECRET) return true;
  const auth = req.headers.get("Authorization");
  const secret = req.headers.get("x-automation-secret");
  return auth === `Bearer ${TRIGGER_SECRET}` || secret === TRIGGER_SECRET;
}

function buildSystemPrompt(
  systemPrompt: string | undefined,
  hasKB: boolean
): string {
  const base = systemPrompt?.trim() ?? "";
  let extra = "";
  if (hasKB) {
    extra +=
      "\n\nYou have access to a knowledge base. Use the provided tools" +
      " (kb_list_files, kb_search, kb_read_file) to find and read relevant" +
      " information before answering questions that require specific knowledge.";
  }
  extra +=
    "\n\nYou have access to a web_search tool. Use it to look up current" +
    " information, recent events, or anything that may not be in your training data." +
    " If the tool returns an error asking the user to configure an API key, relay" +
    " that message to the user as-is.";
  return base + extra;
}

function buildConversationTitle(instruction: string): string {
  const title = instruction.replace(/\s+/g, " ").trim();
  if (!title) return "Automation run";
  return title.length > 64 ? `${title.slice(0, 61)}...` : title;
}

function buildRunSummary(content: string): string {
  const summary = content.replace(/\s+/g, " ").trim();
  if (!summary) return "Automation completed";
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
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

async function runAgentLoop(
  endpoint: string,
  model: string,
  authorization: string,
  systemPrompt: string,
  messages: ChatMessage[],
  kbFiles: KBFile[],
  hostedBroker: Awaited<ReturnType<typeof createZGComputeNetworkBroker>>,
  providerAddress: string,
  braveApiKey: string | null
): Promise<LoopResult> {
  const tools = [
    ...(kbFiles.length > 0 ? [...KB_TOOLS] : []),
    WEB_SEARCH_TOOL,
  ];
  const internalMessages: LLMMessage[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  let lastUsage: unknown = null;
  let assistantContent = "";

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter += 1) {
    const reqBody: Record<string, unknown> = {
      model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        ...internalMessages,
      ],
      tools,
    };

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
    lastUsage = llmData.usage;
    if (chatID) {
      await hostedBroker.inference.processResponse(
        providerAddress,
        chatID,
        llmData.usage ? JSON.stringify(llmData.usage) : undefined
      );
    }

    const message = llmData.choices?.[0]?.message;
    if (message?.content) assistantContent = message.content;
    if (!message?.tool_calls?.length) {
      return { content: assistantContent, usage: lastUsage, ok: true };
    }

    internalMessages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });

    for (const toolCall of message.tool_calls) {
      let toolArgs: Record<string, string> = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, string>;
      } catch {}

      const result =
        toolCall.function.name === "web_search"
          ? braveApiKey
            ? await executeBraveSearch(toolArgs.query ?? "", braveApiKey)
            : JSON.stringify({
                error:
                  "Web search is not configured. Please ask the user to add their" +
                  " Brave Search API key in the OpenDock Dashboard (Settings section)" +
                  " to enable this feature.",
              })
          : executeKBTool(toolCall.function.name, toolArgs, kbFiles);
      internalMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return { content: assistantContent, usage: lastUsage, ok: true };
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

async function claimDueRun(automation: {
  id: string;
  tokenId: string;
  userAddress: string;
  cronExpression: string;
  instruction: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  agentToken: { name: string | null; dataHash: string | null };
}, now: Date): Promise<ClaimedRun | null> {
  let scheduledFor: Date | null = null;
  if (automation.nextRunAt) {
    if (automation.nextRunAt.getTime() <= now.getTime()) {
      scheduledFor = automation.nextRunAt;
    }
  } else {
    const next = findNextCronOccurrence(
      automation.cronExpression,
      automation.lastRunAt ?? automation.createdAt
    );
    if (next && next.getTime() <= now.getTime()) {
      scheduledFor = next;
    } else if (next) {
      await prisma.agentAutomation.update({
        where: { id: automation.id },
        data: { nextRunAt: next },
      });
    }
  }
  if (!scheduledFor) return null;

  const nextRunAt = findNextCronOccurrence(automation.cronExpression, scheduledFor);
  if (!nextRunAt) return null;

  try {
    return await prisma.$transaction(async (tx) => {
      const run = await tx.agentAutomationRun.create({
        data: {
          automationId: automation.id,
          scheduledFor,
          status: "running",
          startedAt: now,
        },
        select: { id: true },
      });

      await tx.agentAutomation.update({
        where: { id: automation.id },
        data: {
          lastRunAt: scheduledFor,
          nextRunAt,
        },
      });

      return {
        id: run.id,
        automationId: automation.id,
        tokenId: automation.tokenId,
        userAddress: automation.userAddress,
        instruction: automation.instruction,
        scheduledFor,
        agentName: automation.agentToken.name ?? `Agent #${automation.tokenId}`,
        dataHash: automation.agentToken.dataHash,
      };
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) return null;
    throw err;
  }
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  }).catch(() => null);
}

async function executeClaimedRun(run: ClaimedRun): Promise<{
  status: "success" | "failed";
  conversationId: string | null;
  summary: string | null;
  output: string | null;
  error: string | null;
}> {
  const { isAuthorized } = await checkOnChainAuth(run.tokenId, run.userAddress);
  if (!isAuthorized) {
    throw new Error("Automation owner no longer has access to this agent");
  }
  if (!run.dataHash) {
    throw new Error("Encrypted intelligence is not registered yet");
  }
  if (!hasAgentComputeRootSecret()) {
    throw new Error("Hosted compute wallet root is not configured");
  }

  const envelope = await downloadZGJson<EncryptedAgentPayload>(run.dataHash);
  if (!envelope) {
    throw new Error("Encrypted intelligence not available");
  }

  const payload = decryptAgentIntelligence(envelope);
  const kbFiles = getKBFiles(payload);
  const userSetting = await prisma.userSetting.findUnique({
    where: { userAddress: run.userAddress.toLowerCase() },
    select: { braveApiKey: true, telegramUserId: true },
  });
  const systemPrompt = buildSystemPrompt(payload.systemPrompt, kbFiles.length > 0);
  const { endpoint, model } = await getServiceMetadata(DEFAULT_PROVIDER_ADDRESS);
  const { signer } = getAgentComputeWalletSigner(run.tokenId, run.userAddress);
  const hostedBroker = await createZGComputeNetworkBroker(signer);
  const hostedHeaders = await hostedBroker.inference.getRequestHeaders(
    DEFAULT_PROVIDER_ADDRESS
  );
  const instruction = [
    `Automation scheduled for ${run.scheduledFor.toISOString()}.`,
    run.instruction,
  ].join("\n\n");
  const result = await runAgentLoop(
    endpoint,
    model,
    hostedHeaders.Authorization,
    systemPrompt,
    [{ role: "user", content: instruction }],
    kbFiles,
    hostedBroker,
    DEFAULT_PROVIDER_ADDRESS,
    userSetting?.braveApiKey ?? null
  );

  if (!result.ok) {
    throw new Error(String(result.errorData ?? "0G provider request failed"));
  }

  const now = new Date();
  const conversation = await prisma.$transaction(async (tx) => {
    const created = await tx.agentConversation.create({
      data: {
        tokenId: run.tokenId,
        userAddress: run.userAddress.toLowerCase(),
        providerAddress: DEFAULT_PROVIDER_ADDRESS,
        title: buildConversationTitle(run.instruction),
        lastMessageAt: now,
      },
      select: { id: true },
    });

    await tx.agentConversationMessage.createMany({
      data: [
        {
          conversationId: created.id,
          sequence: 1,
          role: "user",
          content: instruction,
          createdAt: now,
        },
        {
          conversationId: created.id,
          sequence: 2,
          role: "assistant",
          content: result.content,
          createdAt: now,
        },
      ],
    });

    return created;
  });

  const summary = buildRunSummary(result.content);
  if (userSetting?.telegramUserId) {
    await sendTelegramMessage(
      userSetting.telegramUserId,
      `OpenDock Automation: ${run.agentName}\n${summary}\n\n${result.content}`
    );
  }

  return {
    status: "success",
    conversationId: conversation.id,
    summary,
    output: result.content,
    error: null,
  };
}

async function triggerAutomations(req: NextRequest) {
  if (!isAuthorizedTrigger(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const automations = await prisma.agentAutomation.findMany({
    where: {
      status: "active",
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    take: MAX_AUTOMATIONS_PER_TRIGGER,
    select: {
      id: true,
      tokenId: true,
      userAddress: true,
      cronExpression: true,
      instruction: true,
      lastRunAt: true,
      nextRunAt: true,
      createdAt: true,
      agentToken: {
        select: {
          name: true,
          dataHash: true,
        },
      },
    },
  });

  const claimed: ClaimedRun[] = [];
  for (const automation of automations) {
    const run = await claimDueRun(automation, now);
    if (run) claimed.push(run);
  }

  const results = [];
  for (const run of claimed) {
    try {
      const result = await executeClaimedRun(run);
      await prisma.agentAutomationRun.update({
        where: { id: run.id },
        data: {
          status: result.status,
          conversationId: result.conversationId,
          summary: result.summary,
          output: result.output,
          error: result.error,
          completedAt: new Date(),
        },
      });
      results.push({
        automationId: run.automationId,
        runId: run.id,
        scheduledFor: run.scheduledFor.toISOString(),
        status: result.status,
        conversationId: result.conversationId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.agentAutomationRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          summary: message,
          error: message,
          completedAt: new Date(),
        },
      });
      const setting = await prisma.userSetting.findUnique({
        where: { userAddress: run.userAddress.toLowerCase() },
        select: { telegramUserId: true },
      });
      if (setting?.telegramUserId) {
        await sendTelegramMessage(
          setting.telegramUserId,
          `OpenDock Automation failed: ${run.agentName}\n${message}`
        );
      }
      results.push({
        automationId: run.automationId,
        runId: run.id,
        scheduledFor: run.scheduledFor.toISOString(),
        status: "failed",
        error: message,
      });
    }
  }

  return NextResponse.json({
    processed: claimed.length,
    results,
  });
}

export async function GET(req: NextRequest) {
  return triggerAutomations(req);
}

export async function POST(req: NextRequest) {
  return triggerAutomations(req);
}
