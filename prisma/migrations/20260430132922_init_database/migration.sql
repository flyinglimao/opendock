-- CreateTable
CREATE TABLE "AgentToken" (
    "tokenId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 16602,
    "metadataHash" TEXT NOT NULL,
    "dataHash" TEXT,
    "name" TEXT,
    "description" TEXT,
    "image" TEXT,
    "imageHash" TEXT,
    "systemPrompt" TEXT,
    "metadataReady" BOOLEAN NOT NULL DEFAULT false,
    "owner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentToken_pkey" PRIMARY KEY ("tokenId")
);

-- CreateIndex
CREATE INDEX "AgentToken_owner_idx" ON "AgentToken"("owner");

-- CreateIndex
CREATE INDEX "AgentToken_metadataReady_idx" ON "AgentToken"("metadataReady");
