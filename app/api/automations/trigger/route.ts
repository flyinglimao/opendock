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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Converts standard markdown (as produced by LLMs) to Telegram HTML.
// Code spans are extracted first so their content is not transformed.
// Telegram supports: <b>, <i>, <s>, <code>, <pre>, <a href="...">.
function markdownToTelegramHtml(md: string): string {
  // Protect fenced code blocks
  const blocks: string[] = [];
  let s = md.replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_, code) => {
    const i = blocks.push(`<pre>${escapeHtml(code.trim())}</pre>`) - 1;
    return `\x00BLK${i}\x00`;
  });

  // Protect inline code
  const inlines: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    const i = inlines.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return `\x00INL${i}\x00`;
  });

  // Escape HTML special chars in the remaining prose
  s = escapeHtml(s);

  s = s
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/__(.+?)__/gs, "<b>$1</b>")
    // Italic: *text* (not **) or _text_ (not __)
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<i>$1</i>")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<i>$1</i>")
    // Strikethrough: ~~text~~
    .replace(/~~(.+?)~~/gs, "<s>$1</s>")
    // Links: [text](url) — URL was HTML-escaped above, which is correct for href
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Strip heading markers (Telegram has no heading element)
    .replace(/^#{1,6}\s+/gm, "")
    // Bullet list items
    .replace(/^[-*]\s+/gm, "• ");

  // Restore protected spans
  s = s
    .replace(/\x00BLK(\d+)\x00/g, (_, i) => blocks[Number(i)])
    .replace(/\x00INL(\d+)\x00/g, (_, i) => inlines[Number(i)]);

  return s;
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

const TELEGRAM_REPLY_NOTICE =
  "\n\n<i>Replies to this message are not yet supported. Visit OpenDock to continue the conversation.</i>";

async function sendTelegramMessage(chatId: string, html: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  // Truncate the body first, then append the notice so it always appears.
  const body = html.length > 4000 ? `${html.slice(0, 3997)}…` : html;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: body + TELEGRAM_REPLY_NOTICE,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
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
    const body = markdownToTelegramHtml(result.content || summary);
    await sendTelegramMessage(
      userSetting.telegramUserId,
      `<b>OpenDock Automation: ${escapeHtml(run.agentName)}</b>\n\n${body}`
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
        `<b>OpenDock Automation failed: ${escapeHtml(run.agentName)}</b>\n${escapeHtml(message)}`
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
