import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySessionAuthHeader } from "@/lib/auth";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function getLimit(req: NextRequest): number {
  const value = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

export async function GET(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = getLimit(req);
  const cursor = req.nextUrl.searchParams.get("cursor");
  const rows = await prisma.agentConversation.findMany({
    where: { userAddress: address.toLowerCase() },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      tokenId: true,
      title: true,
      providerAddress: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
      agentToken: {
        select: {
          name: true,
          image: true,
          description: true,
        },
      },
      messages: {
        orderBy: { sequence: "desc" },
        take: 1,
        select: {
          role: true,
          content: true,
        },
      },
      _count: { select: { messages: true } },
    },
  });

  const hasMore = rows.length > limit;
  const conversations = rows.slice(0, limit);

  return NextResponse.json({
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      tokenId: conversation.tokenId,
      title: conversation.title,
      providerAddress: conversation.providerAddress,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      messageCount: conversation._count.messages,
      preview: conversation.messages[0]?.content ?? "",
      previewRole: conversation.messages[0]?.role ?? null,
      agent: {
        name: conversation.agentToken.name ?? `Agent #${conversation.tokenId}`,
        image: conversation.agentToken.image,
        description: conversation.agentToken.description,
      },
    })),
    nextCursor: hasMore ? conversations[conversations.length - 1]?.id ?? null : null,
  });
}
