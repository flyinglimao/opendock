CREATE TABLE "AgentComputeWallet" (
    "id" SERIAL NOT NULL,
    "tokenId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "hdPath" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentComputeWallet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentComputeWallet_hdPath_key" ON "AgentComputeWallet"("hdPath");
CREATE UNIQUE INDEX "AgentComputeWallet_address_key" ON "AgentComputeWallet"("address");
CREATE INDEX "AgentComputeWallet_userAddress_idx" ON "AgentComputeWallet"("userAddress");
CREATE UNIQUE INDEX "AgentComputeWallet_tokenId_userAddress_key" ON "AgentComputeWallet"("tokenId", "userAddress");

ALTER TABLE "AgentComputeWallet" ADD CONSTRAINT "AgentComputeWallet_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AgentToken"("tokenId") ON DELETE CASCADE ON UPDATE CASCADE;
