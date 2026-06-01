-- CreateTable
CREATE TABLE "CloudConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Render',
    "token" TEXT NOT NULL,
    "externalUserId" TEXT,
    "externalUserEmail" TEXT,
    "externalOrganizationId" TEXT,
    "externalOrganizationName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudDeployment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalAppId" TEXT NOT NULL,
    "externalAppName" TEXT NOT NULL,
    "externalServiceId" TEXT NOT NULL,
    "externalDeploymentId" TEXT,
    "publicUrl" TEXT,
    "image" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "instanceType" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudConnection_userId_provider_key" ON "CloudConnection"("userId", "provider");

-- CreateIndex
CREATE INDEX "CloudConnection_userId_provider_idx" ON "CloudConnection"("userId", "provider");

-- CreateIndex
CREATE INDEX "CloudDeployment_connectionId_idx" ON "CloudDeployment"("connectionId");

-- CreateIndex
CREATE INDEX "CloudDeployment_userId_provider_idx" ON "CloudDeployment"("userId", "provider");

-- CreateIndex
CREATE INDEX "CloudDeployment_userId_status_idx" ON "CloudDeployment"("userId", "status");

-- AddForeignKey
ALTER TABLE "CloudConnection" ADD CONSTRAINT "CloudConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudDeployment" ADD CONSTRAINT "CloudDeployment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudDeployment" ADD CONSTRAINT "CloudDeployment_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CloudConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
