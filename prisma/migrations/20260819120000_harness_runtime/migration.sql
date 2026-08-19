-- Native, event-sourced harness runtime. The migration is additive so the
-- previous chat runtime can still read the same conversations during rollback.

-- Keep the schema expansion and both legacy-data projections atomic. If any
-- constraint or backfill fails, PostgreSQL rolls the whole migration back and
-- Prisma can retry without a partially-created harness runtime.
BEGIN;

ALTER TABLE "ProjectFile"
  ADD COLUMN "currentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Conversation"
  ADD COLUMN "engineVersion" TEXT,
  ADD COLUMN "forkedFromId" TEXT,
  ADD COLUMN "forkBoundarySeq" BIGINT;

CREATE TABLE "ProjectFileVersion" (
  "id" TEXT NOT NULL,
  "projectFileId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "blob" BYTEA NOT NULL,
  "extractedText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectFileVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "parentRunId" TEXT,
  "idempotencyKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "providerId" TEXT,
  "modelId" TEXT,
  "stepCount" INTEGER NOT NULL DEFAULT 0,
  "maxSteps" INTEGER NOT NULL DEFAULT 16,
  "subagentDepth" INTEGER NOT NULL DEFAULT 0,
  "maxSubagentDepth" INTEGER NOT NULL DEFAULT 2,
  "leaseToken" TEXT,
  "leaseVersion" INTEGER NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionEvent" (
  "seq" BIGSERIAL NOT NULL,
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "runId" TEXT,
  "turnId" TEXT,
  "stepId" TEXT,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("seq")
);

CREATE TABLE "ToolApproval" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "toolCallId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "args" JSONB NOT NULL,
  "risk" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "decision" TEXT,
  "response" JSONB,
  "operationKey" TEXT NOT NULL,
  "result" JSONB,
  "stepNumber" INTEGER NOT NULL,
  "executionToken" TEXT,
  "executionStartedAt" TIMESTAMP(3),
  "executionExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ToolApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HarnessPluginConfig" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pluginId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "config" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HarnessPluginConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "McpServer" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "encryptedHeaders" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "toolsCache" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HarnessSkill" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "content" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HarnessSkill_pkey" PRIMARY KEY ("id")
);

-- Seed version 1 before agents can modify existing virtual project files.
INSERT INTO "ProjectFileVersion" (
  "id", "projectFileId", "version", "mimeType", "byteSize", "blob", "extractedText", "createdAt"
)
SELECT
  'pfv_' || "ProjectFile"."id",
  "ProjectFile"."id",
  1,
  "ProjectFile"."mimeType",
  "ProjectFile"."byteSize",
  "ProjectFile"."blob",
  "ProjectFile"."extractedText",
  "ProjectFile"."createdAt"
FROM "ProjectFile";

CREATE UNIQUE INDEX "ProjectFileVersion_projectFileId_version_key" ON "ProjectFileVersion"("projectFileId", "version");
CREATE UNIQUE INDEX "ProjectFile_projectId_fileName_key" ON "ProjectFile"("projectId", "fileName");
CREATE INDEX "ProjectFileVersion_projectFileId_createdAt_idx" ON "ProjectFileVersion"("projectFileId", "createdAt");
CREATE INDEX "Conversation_forkedFromId_idx" ON "Conversation"("forkedFromId");
CREATE UNIQUE INDEX "SessionEvent_id_key" ON "SessionEvent"("id");
CREATE INDEX "SessionEvent_conversationId_seq_idx" ON "SessionEvent"("conversationId", "seq");
CREATE INDEX "SessionEvent_runId_seq_idx" ON "SessionEvent"("runId", "seq");
CREATE INDEX "SessionEvent_turnId_idx" ON "SessionEvent"("turnId");
CREATE UNIQUE INDEX "AgentRun_conversationId_idempotencyKey_key" ON "AgentRun"("conversationId", "idempotencyKey");
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");
CREATE INDEX "AgentRun_conversationId_status_idx" ON "AgentRun"("conversationId", "status");
CREATE INDEX "AgentRun_parentRunId_idx" ON "AgentRun"("parentRunId");
CREATE UNIQUE INDEX "AgentRun_one_active_root_per_conversation_key"
  ON "AgentRun"("conversationId")
  WHERE "parentRunId" IS NULL
    AND "status" IN ('queued', 'running', 'yielded', 'waiting_approval');
CREATE UNIQUE INDEX "ToolApproval_runId_toolCallId_key" ON "ToolApproval"("runId", "toolCallId");
CREATE UNIQUE INDEX "ToolApproval_operationKey_key" ON "ToolApproval"("operationKey");
CREATE INDEX "ToolApproval_userId_status_createdAt_idx" ON "ToolApproval"("userId", "status", "createdAt");
CREATE INDEX "ToolApproval_status_executionExpiresAt_idx" ON "ToolApproval"("status", "executionExpiresAt");
CREATE UNIQUE INDEX "HarnessPluginConfig_userId_pluginId_key" ON "HarnessPluginConfig"("userId", "pluginId");
CREATE INDEX "HarnessPluginConfig_userId_enabled_idx" ON "HarnessPluginConfig"("userId", "enabled");
CREATE UNIQUE INDEX "McpServer_userId_name_key" ON "McpServer"("userId", "name");
CREATE INDEX "McpServer_userId_status_idx" ON "McpServer"("userId", "status");
CREATE UNIQUE INDEX "HarnessSkill_userId_projectId_name_key" ON "HarnessSkill"("userId", "projectId", "name");
CREATE UNIQUE INDEX "HarnessSkill_userId_global_name_key"
  ON "HarnessSkill"("userId", "name")
  WHERE "projectId" IS NULL;
CREATE INDEX "HarnessSkill_userId_enabled_idx" ON "HarnessSkill"("userId", "enabled");
CREATE INDEX "HarnessSkill_projectId_enabled_idx" ON "HarnessSkill"("projectId", "enabled");

ALTER TABLE "ProjectFileVersion" ADD CONSTRAINT "ProjectFileVersion_projectFileId_fkey" FOREIGN KEY ("projectFileId") REFERENCES "ProjectFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_forkedFromId_fkey" FOREIGN KEY ("forkedFromId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ToolApproval" ADD CONSTRAINT "ToolApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToolApproval" ADD CONSTRAINT "ToolApproval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HarnessPluginConfig" ADD CONSTRAINT "HarnessPluginConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpServer" ADD CONSTRAINT "McpServer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HarnessSkill" ADD CONSTRAINT "HarnessSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HarnessSkill" ADD CONSTRAINT "HarnessSkill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the established chat transcript as the first event projection.
INSERT INTO "SessionEvent" ("id", "conversationId", "type", "payload", "createdAt")
SELECT
  'evt_' || "Message"."id",
  "Message"."conversationId",
  CASE WHEN "Message"."role" = 'assistant' THEN 'assistant/message' ELSE 'user/message' END,
  jsonb_build_object(
    'messageId', "Message"."id",
    'role', "Message"."role",
    'content', "Message"."content",
    'parts', COALESCE("Message"."parts", 'null'::jsonb),
    'legacy', true
  ),
  "Message"."createdAt"
FROM "Message"
ORDER BY "Message"."createdAt", "Message"."id"
ON CONFLICT ("id") DO NOTHING;

COMMIT;
