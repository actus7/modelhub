-- Chat backstage correlation and optional reaction notes.
-- messageId deliberately remains non-unique: fallback attempts share it.
ALTER TABLE "UsageLog"
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "messageId" TEXT,
  ADD COLUMN "ttftMs" INTEGER,
  ADD COLUMN "attempts" JSONB;

ALTER TABLE "MessageReaction" ADD COLUMN "note" TEXT;

DROP INDEX IF EXISTS "UsageLog_messageId_key";
CREATE INDEX "UsageLog_conversationId_idx" ON "UsageLog"("conversationId");
CREATE INDEX "UsageLog_messageId_idx" ON "UsageLog"("messageId");

ALTER TABLE "UsageLog"
  ADD CONSTRAINT "UsageLog_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
