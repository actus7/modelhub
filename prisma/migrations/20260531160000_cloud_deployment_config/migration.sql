-- AlterTable
ALTER TABLE "CloudDeployment" ADD COLUMN "config" JSONB;

-- AlterTable
ALTER TABLE "CloudConnection" ADD COLUMN "modelhubApiKey" TEXT;
