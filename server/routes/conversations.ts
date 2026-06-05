import type { Context } from "hono";
import { Hono } from "hono";
import type { Prisma } from "../../generated/prisma/client.ts";

import {
  createMessageContentFallback,
  type ConversationMessagePart,
} from "@/lib/chat-parts";
import {
  buildAttachmentContentUrl,
  extractDocumentText,
  getAttachmentValidationError,
  hydrateMessageParts,
  parseSingleMessagePart,
  readUploadedFile,
  resolveAttachmentKind,
} from "../lib/conversation-attachments";
import { prisma } from "../lib/db";
import { jsonErrorResponse } from "../lib/provider-core";
import { authenticateAccess, protectedCors, securityHeaders } from "../lib/security";
import { requireAuth } from "./route-helpers";

const app = new Hono().basePath("/conversations");
app.use("*", securityHeaders);
app.use("*", protectedCors);
app.use("*", async (c, next) => {
  const authError = await authenticateAccess(c);
  if (authError) return authError;
  return next();
});

type CreateMessageInput = {
  content?: string;
  parts?: ConversationMessagePart[];
  role: string;
};


function normalizeIncomingMessageParts(value: unknown): ConversationMessagePart[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parts: ConversationMessagePart[] = [];
  for (const rawPart of value) {
    if (!rawPart || typeof rawPart !== "object") {
      continue;
    }

    const part = parseSingleMessagePart(rawPart as Record<string, unknown>);
    if (part) {
      parts.push(part);
    }
  }

  return parts;
}

type StoredAttachment = {
  byteSize: number;
  extractionStatus: string;
  fileName: string;
  id: string;
  kind: string;
  mimeType: string;
};

type StoredMessage = {
  content: string;
  createdAt: Date;
  id: string;
  parts: Prisma.JsonValue | null;
  role: string;
};

function hydrateMessages(
  messages: StoredMessage[],
  attachments: StoredAttachment[],
  conversationId: string,
) {
  const attachmentsById = new Map(
    attachments.map((a) => [a.id, a]),
  );

  return messages.map((message) => {
    const parts = hydrateMessageParts({
      attachmentsById,
      conversationId,
      fallbackContent: message.content,
      parts: message.parts,
    });

    return {
      content: message.content,
      createdAt: message.createdAt,
      id: message.id,
      parts,
      role: message.role,
    };
  });
}

async function requireConversation(c: Context, userId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  });

  if (!conversation) {
    return null;
  }

  return conversation;
}

type AuthorizedConversation = {
  conversation: NonNullable<Awaited<ReturnType<typeof requireConversation>>>;
  conversationId: string;
  userId: string;
};

/**
 * Resolves the authenticated user and the `:id` conversation they own in one
 * step, returning a ready-to-return Response (401 or 404) on failure. Collapses
 * the auth + param + ownership boilerplate shared by every conversation-scoped
 * handler.
 */
async function authorizeConversation(c: Context): Promise<AuthorizedConversation | Response> {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const conversationId = c.req.param("id");
  if (!conversationId) return jsonErrorResponse(404, "Conversation not found");

  const conversation = await requireConversation(c, userId, conversationId);
  if (!conversation) return jsonErrorResponse(404, "Conversation not found");

  return { conversation, conversationId, userId };
}

async function persistMessages(conversationId: string, messages: CreateMessageInput[]) {
  const createdMessages = await prisma.$transaction(async (tx) => {
    const output: Array<{
      content: string;
      createdAt: Date;
      id: string;
      parts: Prisma.JsonValue | null;
      role: string;
    }> = [];

    for (const message of messages) {
      const parts = normalizeIncomingMessageParts(message.parts);
      const fallbackContent = parts.length > 0
        ? createMessageContentFallback(parts)
        : (message.content ?? "").trim();

      const created = await tx.message.create({
        data: {
          content: fallbackContent,
          conversationId,
          role: message.role,
          ...(parts.length > 0 ? { parts: parts as unknown as Prisma.InputJsonValue } : {}),
        },
        select: {
          content: true,
          createdAt: true,
          id: true,
          parts: true,
          role: true,
        },
      });

      const attachmentIds = parts
        .filter((part) => part.type === "attachment")
        .map((part) => part.attachmentId);

      if (attachmentIds.length > 0) {
        await tx.conversationAttachment.updateMany({
          data: { messageId: created.id },
          where: {
            conversationId,
            id: { in: attachmentIds },
          },
        });
      }

      output.push(created);
    }

    await tx.conversation.update({ where: { id: conversationId }, data: {} });
    return output;
  });

  const attachments = await prisma.conversationAttachment.findMany({
    where: { conversationId },
    select: {
      byteSize: true,
      extractionStatus: true,
      fileName: true,
      id: true,
      kind: true,
      messageId: true,
      mimeType: true,
    },
  });

  return hydrateMessages(createdMessages, attachments, conversationId);
}

// GET /conversations — lista conversas do usuário
app.get("/", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const archived = c.req.query("archived") === "true";

  const conversations = await prisma.conversation.findMany({
    where: { userId, archived },
    select: {
      id: true,
      title: true,
      providerId: true,
      modelId: true,
      archived: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return c.json({ conversations });
});

// POST /conversations — cria nova conversa
app.post("/", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const body = await c.req.json().catch(() => ({})) as {
    modelId?: string;
    providerId?: string;
    title?: string;
  };

  const conversation = await prisma.conversation.create({
    data: {
      modelId: body.modelId ?? null,
      providerId: body.providerId ?? null,
      title: body.title ?? "Nova conversa",
      userId,
    },
    select: {
      id: true,
      title: true,
      providerId: true,
      modelId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return c.json({ conversation }, 201);
});

// PATCH /conversations/:id — atualiza título
app.patch("/:id", async (c) => {
  const auth = await authorizeConversation(c);
  if (auth instanceof Response) return auth;
  const { conversationId: id } = auth;

  const body = await c.req.json().catch(() => ({})) as { title?: string; archived?: boolean };

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.archived !== undefined) data.archived = body.archived;

  const conversation = await prisma.conversation.update({
    where: { id },
    data,
    select: { id: true, title: true, archived: true, updatedAt: true },
  });

  return c.json({ conversation });
});

// DELETE /conversations/:id
app.delete("/:id", async (c) => {
  const auth = await authorizeConversation(c);
  if (auth instanceof Response) return auth;
  const { conversationId: id } = auth;

  await prisma.conversation.delete({ where: { id } });
  return c.json({ success: true });
});

// GET /conversations/:id/messages — busca mensagens
app.get("/:id/messages", async (c) => {
  const auth = await authorizeConversation(c);
  if (auth instanceof Response) return auth;
  const { conversation: existing, conversationId: id } = auth;

  const [messages, attachments] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: id },
      select: { id: true, role: true, content: true, parts: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.conversationAttachment.findMany({
      where: { conversationId: id },
      select: {
        byteSize: true,
        extractionStatus: true,
        fileName: true,
        id: true,
        kind: true,
        mimeType: true,
      },
    }),
  ]);

  return c.json({
    conversation: existing,
    messages: hydrateMessages(messages, attachments, id),
  });
});

// POST /conversations/:id/attachments — upload de anexo
app.post("/:id/attachments", async (c) => {
  const auth = await authorizeConversation(c);
  if (auth instanceof Response) return auth;
  const { conversationId } = auth;

  const formData = await c.req.raw.formData().catch(() => null);
  if (!formData) {
    return jsonErrorResponse(400, "Invalid multipart payload");
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    return jsonErrorResponse(400, "File is required");
  }

  const validationError = getAttachmentValidationError(fileValue);
  if (validationError) {
    return jsonErrorResponse(400, validationError);
  }

  const kind = resolveAttachmentKind(fileValue.type);
  if (!kind) {
    return jsonErrorResponse(400, "Unsupported file type");
  }

  const buffer = await readUploadedFile(fileValue);
  const extraction =
    kind === "document"
      ? await extractDocumentText({ buffer, mimeType: fileValue.type })
      : { extractedText: null, extractionStatus: "completed" as const };

  const attachment = await prisma.conversationAttachment.create({
    data: {
      blob: buffer,
      byteSize: fileValue.size,
      conversationId,
      extractedText: extraction.extractedText,
      extractionStatus: extraction.extractionStatus,
      fileName: fileValue.name,
      kind,
      mimeType: fileValue.type,
    },
    select: {
      byteSize: true,
      extractionStatus: true,
      fileName: true,
      id: true,
      kind: true,
      mimeType: true,
    },
  });

  return c.json({
    attachment: {
      ...attachment,
      contentUrl: buildAttachmentContentUrl(conversationId, attachment.id),
    },
  }, 201);
});

// GET /conversations/:id/attachments/:attachmentId/content — serve o binário autenticado
app.get("/:id/attachments/:attachmentId/content", async (c) => {
  const auth = await authorizeConversation(c);
  if (auth instanceof Response) return auth;
  const { conversationId } = auth;
  const attachmentId = c.req.param("attachmentId");

  const attachment = await prisma.conversationAttachment.findFirst({
    where: { conversationId, id: attachmentId },
    select: {
      blob: true,
      fileName: true,
      mimeType: true,
    },
  });

  if (!attachment) {
    return jsonErrorResponse(404, "Attachment not found");
  }

  return new Response(new Uint8Array(attachment.blob), {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
      "Content-Type": attachment.mimeType,
    },
  });
});

// POST /conversations/:id/messages — adiciona mensagem(ns)
app.post("/:id/messages", async (c) => {
  const auth = await authorizeConversation(c);
  if (auth instanceof Response) return auth;
  const { conversationId: id } = auth;

  const body = await c.req.json().catch(() => ({})) as {
    messages?: CreateMessageInput[];
  };

  if (!body.messages?.length) {
    return jsonErrorResponse(400, "No messages provided");
  }

  const messages = await persistMessages(id, body.messages);
  return c.json({ messages }, 201);
});

// DELETE /conversations/:id/messages?fromMessageId=...|afterMessageId=...
app.delete("/:id/messages", async (c) => {
  const auth = await authorizeConversation(c);
  if (auth instanceof Response) return auth;
  const { conversationId } = auth;

  const fromMessageId = c.req.query("fromMessageId");
  const afterMessageId = c.req.query("afterMessageId");
  if (!fromMessageId && !afterMessageId) {
    return jsonErrorResponse(400, "fromMessageId or afterMessageId is required");
  }

  const orderedMessages = await prisma.message.findMany({
    where: { conversationId },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const targetId = fromMessageId ?? afterMessageId!;
  const targetIndex = orderedMessages.findIndex((message) => message.id === targetId);
  if (targetIndex === -1) {
    return jsonErrorResponse(404, "Message not found");
  }

  const deleteStartIndex = fromMessageId ? targetIndex : targetIndex + 1;
  const idsToDelete = orderedMessages.slice(deleteStartIndex).map((message) => message.id);
  if (idsToDelete.length === 0) {
    return c.json({ deletedMessageIds: [] });
  }

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId, id: { in: idsToDelete } } }),
    prisma.conversation.update({ where: { id: conversationId }, data: {} }),
  ]);

  return c.json({ deletedMessageIds: idsToDelete });
});

// POST /conversations/:id/messages/:messageId/reaction — toggle reaction
app.post("/:id/messages/:messageId/reaction", async (c) => {
  const auth = await authorizeConversation(c);
  if (auth instanceof Response) return auth;
  const { conversationId, userId } = auth;
  const messageId = c.req.param("messageId");

  const body = await c.req.json().catch(() => ({})) as { type?: string };
  const type = body.type;
  if (type !== "thumbs_up" && type !== "thumbs_down") {
    return jsonErrorResponse(400, "type must be 'thumbs_up' or 'thumbs_down'");
  }

  const existingReaction = await prisma.messageReaction.findUnique({
    where: { messageId_userId: { messageId, userId } },
  });

  if (existingReaction) {
    if (existingReaction.type === type) {
      // Same reaction — remove it (toggle off)
      await prisma.messageReaction.delete({ where: { id: existingReaction.id } });
      return c.json({ reaction: null });
    }
    // Different reaction — update
    const updated = await prisma.messageReaction.update({
      where: { id: existingReaction.id },
      data: { type },
    });
    return c.json({ reaction: updated });
  }

  const reaction = await prisma.messageReaction.create({
    data: { messageId, userId, type },
  });
  return c.json({ reaction }, 201);
});

// POST /conversations/:id/share — generate share token
app.post("/:id/share", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const id = c.req.param("id");
  const existing = await prisma.conversation.findFirst({ where: { id, userId } });
  if (!existing) return jsonErrorResponse(404, "Conversation not found");

  if (existing.shareToken) {
    return c.json({ shareToken: existing.shareToken });
  }

  const shareToken = crypto.randomUUID();
  await prisma.conversation.update({ where: { id }, data: { shareToken } });
  return c.json({ shareToken }, 201);
});

// DELETE /conversations/:id/share — revoke share token
app.delete("/:id/share", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const id = c.req.param("id");
  const existing = await prisma.conversation.findFirst({ where: { id, userId } });
  if (!existing) return jsonErrorResponse(404, "Conversation not found");

  await prisma.conversation.update({ where: { id }, data: { shareToken: null } });
  return c.json({ success: true });
});

export default app.fetch;
