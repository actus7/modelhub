-- AlterTable
ALTER TABLE "UsageLog" ADD COLUMN     "baselineCostUsd" DOUBLE PRECISION,
ADD COLUMN     "baselineModelId" TEXT,
ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "routingReason" TEXT,
ADD COLUMN     "routingTier" TEXT,
ADD COLUMN     "taskCategory" TEXT;

-- CreateTable
CREATE TABLE "RoutingConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "complexityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "taskRoutingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tiers" JSONB NOT NULL DEFAULT '{}',
    "taskOverrides" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBudget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL DEFAULT 'monthly',
    "limitUsd" DOUBLE PRECISION,
    "alertThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "blocksRequests" BOOLEAN NOT NULL DEFAULT false,
    "baselineModelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoutingConfig_userId_key" ON "RoutingConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBudget_userId_key" ON "UserBudget"("userId");

-- AddForeignKey
ALTER TABLE "RoutingConfig" ADD CONSTRAINT "RoutingConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBudget" ADD CONSTRAINT "UserBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
