import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySessionAuthHeader } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;
  const conversation = await prisma.agentConversation.findFirst({
    where: {
      id: conversationId,
      userAddress: address.toLowerCase(),
    },
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
      tokenId: conversation.tokenId,
      title: conversation.title,
      providerAddress: conversation.providerAddress,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      agent: {
        name: conversation.agentToken.name ?? `Agent #${conversation.tokenId}`,
        image: conversation.agentToken.image,
        description: conversation.agentToken.description,
      },
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
