import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySessionAuthHeader } from "@/lib/auth";
import { findNextCronOccurrence, isCronExpression } from "@/lib/cron";

interface AutomationBody {
  cronExpression?: string;
  instruction?: string;
  enabled?: boolean;
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.agentAutomation.findFirst({
    where: { id, userAddress: address.toLowerCase() },
    select: {
      id: true,
      cronExpression: true,
      instruction: true,
      status: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as AutomationBody | null;
  const cronExpression = body?.cronExpression?.trim() ?? existing.cronExpression;
  const instruction = body?.instruction?.trim() ?? existing.instruction;
  if (!cronExpression || !instruction) {
    return NextResponse.json(
      { error: "cronExpression and instruction are required" },
      { status: 400 }
    );
  }
  if (!isCronExpression(cronExpression)) {
    return NextResponse.json({ error: "Invalid cron expression" }, { status: 400 });
  }

  const enabled = body?.enabled !== false;
  const cronChanged = cronExpression !== existing.cronExpression;
  const resumed = existing.status === "paused" && enabled;
  const automation = await prisma.agentAutomation.update({
    where: { id },
    data: {
      cronExpression,
      instruction,
      status: enabled ? "active" : "paused",
      ...(cronChanged || resumed
        ? {
            nextRunAt: findNextCronOccurrence(cronExpression, new Date()),
          }
        : {}),
    },
    select: automationSelect,
  });

  return NextResponse.json({
    automation: serializeAutomation(automation),
  });
}
