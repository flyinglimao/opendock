-- CreateTable
CREATE TABLE "UserSetting" (
    "userAddress" TEXT NOT NULL,
    "braveApiKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSetting_pkey" PRIMARY KEY ("userAddress")
);
