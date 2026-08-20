CREATE TABLE "ProviderQuota" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "label" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "windowHours" INTEGER NOT NULL DEFAULT 24,
    "requestLimit" INTEGER,
    "tokenLimit" INTEGER,
    "costLimitUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderQuota_userId_providerId_key"
ON "ProviderQuota"("userId", "providerId");

CREATE INDEX "ProviderQuota_userId_isEnabled_idx"
ON "ProviderQuota"("userId", "isEnabled");

ALTER TABLE "ProviderQuota"
ADD CONSTRAINT "ProviderQuota_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
