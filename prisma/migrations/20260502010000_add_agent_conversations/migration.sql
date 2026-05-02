CREATE TYPE "AgentConversationRole" AS ENUM ('user', 'assistant');

CREATE TABLE "AgentConversation" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "title" TEXT,
    "providerAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" "AgentConversationRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentConversation_tokenId_userAddress_lastMessageAt_idx" ON "AgentConversation"("tokenId", "userAddress", "lastMessageAt");
CREATE INDEX "AgentConversation_userAddress_idx" ON "AgentConversation"("userAddress");
CREATE UNIQUE INDEX "AgentConversationMessage_conversationId_sequence_key" ON "AgentConversationMessage"("conversationId", "sequence");
CREATE INDEX "AgentConversationMessage_conversationId_createdAt_idx" ON "AgentConversationMessage"("conversationId", "createdAt");

ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AgentToken"("tokenId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentConversationMessage" ADD CONSTRAINT "AgentConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
