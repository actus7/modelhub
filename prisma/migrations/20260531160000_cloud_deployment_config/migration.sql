-- AlterTable
ALTER TABLE "CloudDeployment" ADD COLUMN IF NOT EXISTS "config" JSONB;

-- AlterTable
ALTER TABLE "CloudConnection" ADD COLUMN IF NOT EXISTS "modelhubApiKey" TEXT;
