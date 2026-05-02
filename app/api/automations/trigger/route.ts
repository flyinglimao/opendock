import { NextRequest, NextResponse } from "next/server";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
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
import { getKBFiles } from "@/lib/kb-tools";
import { getServiceMetadata, runAgentLoop } from "@/lib/agent-loop";

export const dynamic = "force-dynamic";

const DEFAULT_PROVIDER_ADDRESS = COMPUTE_PROVIDERS[0].address;
const TRIGGER_SECRET = process.env.CRON_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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

  const { endpoint, model } = await getServiceMetadata(DEFAULT_PROVIDER_ADDRESS);
  const { signer } = getAgentComputeWalletSigner(run.tokenId, run.userAddress);
  const hostedBroker = await createZGComputeNetworkBroker(signer);
  const hostedHeaders = await hostedBroker.inference.getRequestHeaders(
    DEFAULT_PROVIDER_ADDRESS
  );

  const result = await runAgentLoop(
    endpoint,
    model,
    hostedHeaders.Authorization,
    payload.systemPrompt,
    [{ role: "user", content: run.instruction }],
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
          content: run.instruction,
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
      `OpenDock Automation: ${run.agentName}\n\n${result.content || summary}`
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

async function processSingleRun(run: ClaimedRun): Promise<{
  automationId: string;
  runId: string;
  scheduledFor: string;
  status: string;
  conversationId?: string | null;
  error?: string;
}> {
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
    return {
      automationId: run.automationId,
      runId: run.id,
      scheduledFor: run.scheduledFor.toISOString(),
      status: result.status,
      conversationId: result.conversationId,
    };
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
    return {
      automationId: run.automationId,
      runId: run.id,
      scheduledFor: run.scheduledFor.toISOString(),
      status: "failed",
      error: message,
    };
  }
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

  // Claim all due runs in parallel; each uses its own DB transaction and the
  // unique constraint on (automationId, scheduledFor) prevents double-claiming.
  const claimResults = await Promise.all(
    automations.map((automation) => claimDueRun(automation, now))
  );
  const claimed = claimResults.filter((run): run is ClaimedRun => run !== null);

  // Execute all claimed runs in parallel to minimize total wall-clock time.
  const results = await Promise.all(claimed.map(processSingleRun));

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
