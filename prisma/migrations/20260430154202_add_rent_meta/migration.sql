-- AlterTable
ALTER TABLE "AgentToken" ADD COLUMN     "rentMaxDuration" INTEGER,
ADD COLUMN     "rentOrderId" TEXT,
ADD COLUMN     "rentPricePerSecond" TEXT;
