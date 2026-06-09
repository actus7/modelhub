-- Idempotente: este schema pode já existir em bancos onde foi aplicado via
-- `prisma db push` antes de a migração existir. Usamos IF NOT EXISTS / guardas
-- para que `migrate deploy` funcione tanto em bancos novos quanto nos que já
-- têm os objetos (evita SQLSTATE 42701 / 42P07).

-- AlterTable
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "baselineCostUsd" DOUBLE PRECISION;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "baselineModelId" TEXT;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "costUsd" DOUBLE PRECISION;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "inputTokens" INTEGER;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "outputTokens" INTEGER;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "routingReason" TEXT;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "routingTier" TEXT;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "taskCategory" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "RoutingConfig" (
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
CREATE TABLE IF NOT EXISTS "UserBudget" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "RoutingConfig_userId_key" ON "RoutingConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserBudget_userId_key" ON "UserBudget"("userId");

-- AddForeignKey (guardado: ADD CONSTRAINT não suporta IF NOT EXISTS)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoutingConfig_userId_fkey') THEN
    ALTER TABLE "RoutingConfig" ADD CONSTRAINT "RoutingConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserBudget_userId_fkey') THEN
    ALTER TABLE "UserBudget" ADD CONSTRAINT "UserBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
