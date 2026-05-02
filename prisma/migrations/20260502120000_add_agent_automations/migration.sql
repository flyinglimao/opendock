CREATE TYPE "AgentAutomationStatus" AS ENUM ('active', 'paused');
CREATE TYPE "AgentAutomationRunStatus" AS ENUM ('running', 'success', 'failed');

CREATE TABLE "AgentAutomation" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "status" "AgentAutomationStatus" NOT NULL DEFAULT 'active',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentAutomation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentAutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "status" "AgentAutomationRunStatus" NOT NULL DEFAULT 'running',
    "summary" TEXT,
    "output" TEXT,
    "error" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentAutomation_userAddress_updatedAt_idx" ON "AgentAutomation"("userAddress", "updatedAt");
CREATE INDEX "AgentAutomation_tokenId_userAddress_idx" ON "AgentAutomation"("tokenId", "userAddress");
CREATE INDEX "AgentAutomation_status_nextRunAt_idx" ON "AgentAutomation"("status", "nextRunAt");
CREATE UNIQUE INDEX "AgentAutomationRun_automationId_scheduledFor_key" ON "AgentAutomationRun"("automationId", "scheduledFor");
CREATE INDEX "AgentAutomationRun_automationId_startedAt_idx" ON "AgentAutomationRun"("automationId", "startedAt");
CREATE INDEX "AgentAutomationRun_status_startedAt_idx" ON "AgentAutomationRun"("status", "startedAt");

ALTER TABLE "AgentAutomation" ADD CONSTRAINT "AgentAutomation_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AgentToken"("tokenId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentAutomationRun" ADD CONSTRAINT "AgentAutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "AgentAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentAutomationRun" ADD CONSTRAINT "AgentAutomationRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
