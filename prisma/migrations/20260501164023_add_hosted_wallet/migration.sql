/*
  Warnings:

  - You are about to drop the column `systemPrompt` on the `AgentToken` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AgentToken" DROP COLUMN "systemPrompt";
