import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkOnChainAuth, verifyAuthHeader } from "@/lib/auth";

async function requireAuthorizedAddress(id: string, req: NextRequest) {
  const address = await verifyAuthHeader(id, req.headers.get("Authorization"));
  if (!address) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      address: null,
    };
  }

  const { isAuthorized } = await checkOnChainAuth(id, address);
  if (!isAuthorized) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      address: null,
    };
  }

  return { response: null, address: address.toLowerCase() };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuthorizedAddress(id, req);
  if (auth.response) return auth.response;

  const conversations = await prisma.agentConversation.findMany({
    where: { tokenId: id, userAddress: auth.address! },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      providerAddress: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
      messages: {
        orderBy: { sequence: "desc" },
        take: 1,
        select: { content: true, role: true },
      },
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      providerAddress: conversation.providerAddress,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      messageCount: conversation._count.messages,
      preview: conversation.messages[0]?.content ?? "",
      previewRole: conversation.messages[0]?.role ?? null,
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuthorizedAddress(id, req);
  if (auth.response) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    providerAddress?: string;
  };
  const title = body.title?.trim() || "New conversation";

  const conversation = await prisma.agentConversation.create({
    data: {
      tokenId: id,
      userAddress: auth.address!,
      title,
      providerAddress: body.providerAddress ?? null,
    },
    select: {
      id: true,
      title: true,
      providerAddress: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
    },
  });

  return NextResponse.json({
    conversation: {
      ...conversation,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      messageCount: 0,
      preview: "",
      previewRole: null,
    },
  });
}
