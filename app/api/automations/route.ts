import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySessionAuthHeader, checkOnChainAuth } from "@/lib/auth";
import { findNextCronOccurrence, isCronExpression } from "@/lib/cron";

interface AutomationBody {
  tokenId?: string;
  cronExpression?: string;
  instruction?: string;
  enabled?: boolean;
}

function serializeAutomation(automation: {
  id: string;
  tokenId: string;
  cronExpression: string;
  instruction: string;
  status: "active" | "paused";
  updatedAt: Date;
  agentToken: {
    name: string | null;
    image: string | null;
  };
  runs: Array<{
    id: string;
    status: "running" | "success" | "failed";
    startedAt: Date;
    completedAt: Date | null;
    summary: string | null;
  }>;
}) {
  return {
    id: automation.id,
    tokenId: automation.tokenId,
    agentName: automation.agentToken.name ?? `Agent #${automation.tokenId}`,
    agentImage: automation.agentToken.image,
    cronExpression: automation.cronExpression,
    instruction: automation.instruction,
    enabled: automation.status === "active",
    updatedAt: automation.updatedAt.toISOString(),
    history: automation.runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      summary: run.summary,
    })),
  };
}

const automationSelect = {
  id: true,
  tokenId: true,
  cronExpression: true,
  instruction: true,
  status: true,
  updatedAt: true,
  agentToken: {
    select: {
      name: true,
      image: true,
    },
  },
  runs: {
    orderBy: { startedAt: "desc" as const },
    take: 20,
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      summary: true,
    },
  },
};

export async function GET(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const automations = await prisma.agentAutomation.findMany({
    where: { userAddress: address.toLowerCase() },
    orderBy: { updatedAt: "desc" },
    select: automationSelect,
  });

  return NextResponse.json({
    automations: automations.map(serializeAutomation),
  });
}

export async function POST(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as AutomationBody | null;
  const tokenId = body?.tokenId?.trim();
  const cronExpression = body?.cronExpression?.trim();
  const instruction = body?.instruction?.trim();
  if (!tokenId || !cronExpression || !instruction) {
    return NextResponse.json(
      { error: "tokenId, cronExpression, and instruction are required" },
      { status: 400 }
    );
  }
  if (!isCronExpression(cronExpression)) {
    return NextResponse.json({ error: "Invalid cron expression" }, { status: 400 });
  }

  const token = await prisma.agentToken.findUnique({
    where: { tokenId },
    select: { tokenId: true },
  });
  if (!token) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const { isAuthorized } = await checkOnChainAuth(tokenId, address);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const nextRunAt = findNextCronOccurrence(cronExpression, now);
  const automation = await prisma.agentAutomation.create({
    data: {
      tokenId,
      userAddress: address.toLowerCase(),
      cronExpression,
      instruction,
      status: body?.enabled === false ? "paused" : "active",
      nextRunAt,
    },
    select: automationSelect,
  });

  return NextResponse.json({
    automation: serializeAutomation(automation),
  });
}
