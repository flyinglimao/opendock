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
  { params }: { params: Promise<{ id: string; conversationId: string }> }
) {
  const { id, conversationId } = await params;
  const auth = await requireAuthorizedAddress(id, req);
  if (auth.response) return auth.response;

  const conversation = await prisma.agentConversation.findFirst({
    where: {
      id: conversationId,
      tokenId: id,
      userAddress: auth.address!,
    },
    select: {
      id: true,
      title: true,
      providerAddress: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
      messages: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          role: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      providerAddress: conversation.providerAddress,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        sequence: message.sequence,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
    },
  });
}
