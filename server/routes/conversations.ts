import type { Context } from "hono"
import { Hono } from "hono"
import type { Prisma } from "../../generated/prisma/client.ts"
import { z } from "zod"

import {
  createMessageContentFallback,
  type ConversationMessagePart,
} from "@/lib/chat-parts"
import {
  buildAttachmentContentUrl,
  extractDocumentText,
  getAttachmentValidationError,
  hydrateMessageParts,
  parseSingleMessagePart,
  readUploadedFile,
  resolveAttachmentKind,
} from "../lib/conversation-attachments"
import { prisma } from "../lib/db"
import { jsonErrorResponse } from "../lib/provider-core"
import {
  authenticateAccess,
  protectedCors,
  securityHeaders,
} from "../lib/security"
import { requireAuth } from "./route-helpers"

const MAX_REACTION_NOTE_LENGTH = 500
const MAX_PERSISTED_MESSAGE_CONTENT_LENGTH = 2_000_000
const MAX_CLIENT_MESSAGE_ID_LENGTH = 64

const app = new Hono().basePath("/conversations")
app.use("*", securityHeaders)
app.use("*", protectedCors)
app.use("*", async (c, next) => {
  const authError = await authenticateAccess(c)
  if (authError) return authError
  return next()
})

type CreateMessageInput = {
  content?: string
  id?: string
  modelLabel?: string
  parts?: unknown[]
  role: string
}

const createMessageSchema = z.object({
  content: z.string().max(MAX_PERSISTED_MESSAGE_CONTENT_LENGTH).optional(),
  id: z
    .string()
    .min(1)
    .max(MAX_CLIENT_MESSAGE_ID_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  modelLabel: z.string().max(200).optional(),
  parts: z.array(z.unknown()).max(64).optional(),
  role: z.enum(["assistant", "user"]),
})

const createConversationSchema = z.object({
  modelId: z.string().trim().min(1).max(200).optional(),
  projectId: z.string().trim().min(1).max(64).optional(),
  providerId: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(200).optional(),
})

const updateConversationSchema = z.object({
  archived: z.boolean().optional(),
  projectId: z.string().trim().min(1).max(64).nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
})

/** Aceita o id gerado no cliente (ex.: usado no header de correlação com UsageLog) quando plausível. */
function sanitizeClientMessageId(id: string | undefined): string | undefined {
  if (!id || id.length === 0 || id.length > MAX_CLIENT_MESSAGE_ID_LENGTH) {
    return undefined
  }
  return id
}

function normalizeIncomingMessageParts(
  value: unknown,
): ConversationMessagePart[] {
  if (!Array.isArray(value)) {
    return []
  }

  const parts: ConversationMessagePart[] = []
  for (const rawPart of value) {
    if (!rawPart || typeof rawPart !== "object") {
      continue
    }

    const part = parseSingleMessagePart(rawPart as Record<string, unknown>)
    if (part) {
      parts.push(part)
    }
  }

  return parts
}

type StoredAttachment = {
  byteSize: number
  extractionStatus: string
  fileName: string
  id: string
  kind: string
  mimeType: string
}

type StoredMessage = {
  content: string
  createdAt: Date
  id: string
  parts: Prisma.JsonValue | null
  role: string
}

interface MessageBackstage {
  messageId: string | null
  providerId: string
  modelId: string | null
  routingTier: string | null
  routingReason: string | null
  durationMs: number | null
  ttftMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  attempts: Prisma.JsonValue
}

type UsageLogRow = {
  messageId: string | null
  providerId: string
  modelId: string | null
  statusCode: number
  errorDetail: string | null
  routingTier: string | null
  routingReason: string | null
  durationMs: number | null
  ttftMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  attempts: Prisma.JsonValue
}

/**
 * O roteamento automático pode tentar vários provedores até um responder — cada
 * tentativa (inclusive as que falharam) grava sua própria linha em UsageLog com o
 * mesmo messageId. Aqui agrupamos: a tentativa bem-sucedida (ou, se nenhuma deu
 * certo, a última) vira o resumo principal; as demais viram "attempts" (fallback).
 */
function buildBackstageByMessageId(
  rows: UsageLogRow[],
): Map<string, MessageBackstage> {
  const byMessageId = new Map<string, UsageLogRow[]>()
  for (const row of rows) {
    if (!row.messageId) continue
    const group = byMessageId.get(row.messageId) ?? []
    group.push(row)
    byMessageId.set(row.messageId, group)
  }

  const result = new Map<string, MessageBackstage>()
  for (const [messageId, group] of byMessageId) {
    const primary =
      group.find((row) => row.statusCode < 400) ?? group[group.length - 1]!
    const otherAttempts = group
      .filter((row) => row !== primary)
      .map((row) => ({
        durationMs: row.durationMs ?? undefined,
        errorSnippet: row.errorDetail?.slice(0, 300) ?? undefined,
        modelId: row.modelId ?? row.providerId,
        providerId: row.providerId,
        status: row.statusCode,
      }))
    const ownAttempts = Array.isArray(primary.attempts) ? primary.attempts : []

    result.set(messageId, {
      attempts: [...otherAttempts, ...ownAttempts],
      costUsd: primary.costUsd,
      durationMs: primary.durationMs,
      inputTokens: primary.inputTokens,
      messageId: primary.messageId,
      modelId: primary.modelId,
      outputTokens: primary.outputTokens,
      providerId: primary.providerId,
      routingReason: primary.routingReason,
      routingTier: primary.routingTier,
      ttftMs: primary.ttftMs,
    })
  }
  return result
}

function hydrateMessages(
  messages: StoredMessage[],
  attachments: StoredAttachment[],
  conversationId: string,
  backstageByMessageId: Map<string, MessageBackstage> = new Map(),
) {
  const attachmentsById = new Map(attachments.map((a) => [a.id, a]))

  return messages.map((message) => {
    const parts = hydrateMessageParts({
      attachmentsById,
      conversationId,
      fallbackContent: message.content,
      parts: message.parts,
    })
    const backstage = backstageByMessageId.get(message.id)

    return {
      content: message.content,
      createdAt: message.createdAt,
      id: message.id,
      parts,
      role: message.role,
      ...(backstage ? { backstage } : {}),
    }
  })
}

async function requireConversation(
  c: Context,
  userId: string,
  conversationId: string,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  })

  if (!conversation) {
    return null
  }

  return conversation
}

type AuthorizedConversation = {
  conversation: NonNullable<Awaited<ReturnType<typeof requireConversation>>>
  conversationId: string
  userId: string
}

/**
 * Resolves the authenticated user and the `:id` conversation they own in one
 * step, returning a ready-to-return Response (401 or 404) on failure. Collapses
 * the auth + param + ownership boilerplate shared by every conversation-scoped
 * handler.
 */
async function authorizeConversation(
  c: Context,
): Promise<AuthorizedConversation | Response> {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId

  const conversationId = c.req.param("id")
  if (!conversationId) return jsonErrorResponse(404, "Conversation not found")

  const conversation = await requireConversation(c, userId, conversationId)
  if (!conversation) return jsonErrorResponse(404, "Conversation not found")

  return { conversation, conversationId, userId }
}

async function persistMessages(
  conversationId: string,
  userId: string,
  messages: CreateMessageInput[],
) {
  const createdMessages: Array<{
    content: string
    createdAt: Date
    id: string
    parts: Prisma.JsonValue | null
    role: string
  }> = []

  try {
    for (const message of messages) {
      const parts = normalizeIncomingMessageParts(message.parts)
      const fallbackContent =
        parts.length > 0
          ? createMessageContentFallback(parts)
          : (message.content ?? "").trim()

      const partsWithMeta = message.modelLabel
        ? [
            ...parts,
            {
              modelLabel: message.modelLabel,
              type: "meta",
            } as ConversationMessagePart,
          ]
        : parts

      const clientId = sanitizeClientMessageId(message.id)

      const created = await prisma.message.create({
        data: {
          content: fallbackContent,
          conversationId,
          role: message.role,
          ...(clientId ? { id: clientId } : {}),
          ...(partsWithMeta.length > 0
            ? { parts: partsWithMeta as unknown as Prisma.InputJsonValue }
            : {}),
        },
        select: {
          content: true,
          createdAt: true,
          id: true,
          parts: true,
          role: true,
        },
      })

      createdMessages.push(created)

      const attachmentIds = parts
        .filter((part) => part.type === "attachment")
        .map((part) => part.attachmentId)

      if (attachmentIds.length > 0) {
        await prisma.conversationAttachment.updateMany({
          data: { messageId: created.id },
          where: {
            conversationId,
            id: { in: attachmentIds },
          },
        })
      }
    }

    await prisma.conversation.update({ where: { id: conversationId }, data: {} })
  } catch (error) {
    const createdIds = createdMessages.map((message) => message.id)
    if (createdIds.length > 0) {
      await prisma.message
        .deleteMany({
          where: { conversationId, id: { in: createdIds } },
        })
        .catch((cleanupError: unknown) => {
          console.error(
            "[conversations] Failed to compensate message persistence",
            cleanupError,
          )
        })
    }
    throw error
  }

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
  })

  const assistantMessageIds = createdMessages
    .filter((m) => m.role === "assistant")
    .map((m) => m.id)
  const usageLogs =
    assistantMessageIds.length > 0
      ? await prisma.usageLog.findMany({
          where: { messageId: { in: assistantMessageIds }, userId },
          orderBy: { createdAt: "asc" },
          select: {
            messageId: true,
            providerId: true,
            modelId: true,
            statusCode: true,
            errorDetail: true,
            routingTier: true,
            routingReason: true,
            durationMs: true,
            ttftMs: true,
            inputTokens: true,
            outputTokens: true,
            costUsd: true,
            attempts: true,
          },
        })
      : []
  const backstageByMessageId = buildBackstageByMessageId(usageLogs)

  return hydrateMessages(
    createdMessages,
    attachments,
    conversationId,
    backstageByMessageId,
  )
}

// GET /conversations — lista conversas do usuário
// `q` (opcional) busca por título da conversa E conteúdo das mensagens.
app.get("/", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId

  const archived = c.req.query("archived") === "true"
  const q = c.req.query("q")?.trim() ?? ""
  if (q.length > 200) {
    return jsonErrorResponse(400, "Search query is too long")
  }

  const where: Prisma.ConversationWhereInput = { userId, archived }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { messages: { some: { content: { contains: q, mode: "insensitive" } } } },
    ]
  }

  const conversations = await prisma.conversation.findMany({
    where,
    select: {
      id: true,
      title: true,
      providerId: true,
      modelId: true,
      projectId: true,
      archived: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  })

  return c.json({ conversations })
})

// POST /conversations — cria nova conversa
app.post("/", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId

  const parsed = createConversationSchema.safeParse(
    await c.req.json().catch(() => null),
  )
  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid conversation payload")
  }
  const body = parsed.data

  let projectId: string | null = null
  if (body.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: body.projectId, userId },
      select: { id: true },
    })
    if (!project) return jsonErrorResponse(404, "Project not found")
    projectId = project.id
  }

  const conversation = await prisma.conversation.create({
    data: {
      modelId: body.modelId ?? null,
      projectId,
      providerId: body.providerId ?? null,
      title: body.title ?? "Nova conversa",
      userId,
    },
    select: {
      createdAt: true,
      id: true,
      modelId: true,
      projectId: true,
      providerId: true,
      title: true,
      updatedAt: true,
    },
  })

  return c.json({ conversation }, 201)
})

// PATCH /conversations/:id — atualiza título/projeto
app.patch("/:id", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { conversationId: id, userId } = auth

  const parsed = updateConversationSchema.safeParse(
    await c.req.json().catch(() => null),
  )
  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid conversation payload")
  }
  const body = parsed.data

  const data: Record<string, unknown> = {}
  if (body.title !== undefined) data.title = body.title
  if (body.archived !== undefined) data.archived = body.archived
  if (body.projectId !== undefined) {
    if (body.projectId === null) {
      data.projectId = null
    } else {
      const project = await prisma.project.findFirst({
        where: { id: body.projectId, userId },
        select: { id: true },
      })
      if (!project) return jsonErrorResponse(404, "Project not found")
      data.projectId = project.id
    }
  }

  const conversation = await prisma.conversation.update({
    where: { id },
    data,
    select: {
      archived: true,
      id: true,
      projectId: true,
      title: true,
      updatedAt: true,
    },
  })

  return c.json({ conversation })
})

// DELETE /conversations/:id
app.delete("/:id", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { conversationId: id } = auth

  await prisma.conversation.delete({ where: { id } })
  return c.json({ success: true })
})

// GET /conversations/:id/messages — busca mensagens
app.get("/:id/messages", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { conversation: existing, conversationId: id } = auth

  const [messages, attachments] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: id },
      select: {
        id: true,
        role: true,
        content: true,
        parts: true,
        createdAt: true,
      },
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
  ])

  const assistantMessageIds = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.id)
  const usageLogs =
    assistantMessageIds.length > 0
      ? await prisma.usageLog.findMany({
          where: { messageId: { in: assistantMessageIds }, userId: auth.userId },
          orderBy: { createdAt: "asc" },
          select: {
            messageId: true,
            providerId: true,
            modelId: true,
            statusCode: true,
            errorDetail: true,
            routingTier: true,
            routingReason: true,
            durationMs: true,
            ttftMs: true,
            inputTokens: true,
            outputTokens: true,
            costUsd: true,
            attempts: true,
          },
        })
      : []
  const backstageByMessageId = buildBackstageByMessageId(usageLogs)

  return c.json({
    conversation: existing,
    messages: hydrateMessages(messages, attachments, id, backstageByMessageId),
  })
})

// POST /conversations/:id/attachments — upload de anexo
app.post("/:id/attachments", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { conversationId } = auth

  const formData = await c.req.raw.formData().catch(() => null)
  if (!formData) {
    return jsonErrorResponse(400, "Invalid multipart payload")
  }

  const fileValue = formData.get("file")
  if (!(fileValue instanceof File)) {
    return jsonErrorResponse(400, "File is required")
  }

  const validationError = getAttachmentValidationError(fileValue)
  if (validationError) {
    return jsonErrorResponse(400, validationError)
  }

  const kind = resolveAttachmentKind(fileValue.type)
  if (!kind) {
    return jsonErrorResponse(400, "Unsupported file type")
  }

  const buffer = await readUploadedFile(fileValue)
  const extraction =
    kind === "document"
      ? await extractDocumentText({ buffer, mimeType: fileValue.type })
      : { extractedText: null, extractionStatus: "completed" as const }

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
  })

  return c.json(
    {
      attachment: {
        ...attachment,
        contentUrl: buildAttachmentContentUrl(conversationId, attachment.id),
      },
    },
    201,
  )
})

// GET /conversations/:id/attachments/:attachmentId/content — serve o binário autenticado
app.get("/:id/attachments/:attachmentId/content", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { conversationId } = auth
  const attachmentId = c.req.param("attachmentId")

  const attachment = await prisma.conversationAttachment.findFirst({
    where: { conversationId, id: attachmentId },
    select: {
      blob: true,
      fileName: true,
      mimeType: true,
    },
  })

  if (!attachment) {
    return jsonErrorResponse(404, "Attachment not found")
  }

  return new Response(new Uint8Array(attachment.blob), {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
      "Content-Type": attachment.mimeType,
    },
  })
})

// POST /conversations/:id/messages — adiciona mensagem(ns)
app.post("/:id/messages", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { conversationId: id, userId } = auth

  const parsed = z
    .object({ messages: z.array(createMessageSchema).min(1).max(50) })
    .safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid messages payload")
  }

  const messages = await persistMessages(id, userId, parsed.data.messages)
  return c.json({ messages }, 201)
})

// DELETE /conversations/:id/messages?fromMessageId=...|afterMessageId=...
app.delete("/:id/messages", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { conversationId } = auth

  const fromMessageId = c.req.query("fromMessageId")
  const afterMessageId = c.req.query("afterMessageId")
  if (!fromMessageId && !afterMessageId) {
    return jsonErrorResponse(400, "fromMessageId or afterMessageId is required")
  }

  const orderedMessages = await prisma.message.findMany({
    where: { conversationId },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })

  const targetId = fromMessageId ?? afterMessageId!
  const targetIndex = orderedMessages.findIndex(
    (message) => message.id === targetId,
  )
  if (targetIndex === -1) {
    return jsonErrorResponse(404, "Message not found")
  }

  const deleteStartIndex = fromMessageId ? targetIndex : targetIndex + 1
  const idsToDelete = orderedMessages
    .slice(deleteStartIndex)
    .map((message) => message.id)
  if (idsToDelete.length === 0) {
    return c.json({ deletedMessageIds: [] })
  }

  const deletedIds = new Set(idsToDelete)
  await prisma.$transaction(async (tx) => {
    const projectedEvents = await tx.sessionEvent.findMany({
      where: {
        conversationId,
        type: { in: ["assistant/message", "user/message"] },
      },
      select: { id: true, payload: true },
    })
    const eventIdsToDelete = projectedEvents
      .filter((event) => {
        const payload = event.payload as Record<string, unknown>
        return typeof payload.messageId === "string" && deletedIds.has(payload.messageId)
      })
      .map((event) => event.id)
    if (eventIdsToDelete.length > 0) {
      await tx.sessionEvent.deleteMany({
        where: { conversationId, id: { in: eventIdsToDelete } },
      })
    }
    await tx.message.deleteMany({
      where: { conversationId, id: { in: idsToDelete } },
    })
    await tx.conversation.update({ where: { id: conversationId }, data: {} })
  })

  return c.json({ deletedMessageIds: idsToDelete })
})

// POST /conversations/:id/messages/:messageId/reaction — toggle reaction
app.post("/:id/messages/:messageId/reaction", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { userId } = auth
  const messageId = c.req.param("messageId")

  const parsed = z
    .object({
      note: z.string().max(MAX_REACTION_NOTE_LENGTH).optional(),
      type: z.enum(["thumbs_up", "thumbs_down"]),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid reaction payload")
  }
  const { type } = parsed.data
  const note =
    parsed.data.note === undefined
      ? undefined
      : parsed.data.note.trim() || null

  const message = await prisma.message.findFirst({
    where: { conversationId: auth.conversationId, id: messageId },
    select: { id: true },
  })
  if (!message) return jsonErrorResponse(404, "Message not found")

  const existingReaction = await prisma.messageReaction.findUnique({
    where: { messageId_userId: { messageId, userId } },
  })

  if (existingReaction) {
    if (existingReaction.type === type) {
      if (note !== undefined) {
        // Nota-only: mantém a reação, só atualiza a nota.
        const updated = await prisma.messageReaction.update({
          where: { id: existingReaction.id },
          data: { note },
        })
        return c.json({ reaction: updated })
      }
      // Mesmo tipo sem nota — clique no botão, remove (toggle off).
      await prisma.messageReaction.delete({
        where: { id: existingReaction.id },
      })
      return c.json({ reaction: null })
    }
    // Tipo diferente — troca a reação e reseta a nota anterior.
    const updated = await prisma.messageReaction.update({
      where: { id: existingReaction.id },
      data: { type, note: note ?? null },
    })
    return c.json({ reaction: updated })
  }

  const reaction = await prisma.messageReaction.create({
    data: { messageId, userId, note: note ?? null, type },
  })
  return c.json({ reaction }, 201)
})

// GET /conversations/:id/canvases — lista canvases da conversa
app.get("/:id/canvases", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { conversationId } = auth

  const canvases = await prisma.canvas.findMany({
    where: { conversationId },
    select: {
      activeVersion: true,
      conversationId: true,
      createdAt: true,
      id: true,
      kind: true,
      language: true,
      shareToken: true,
      title: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  })

  return c.json({ canvases })
})

// POST /conversations/:id/canvases — cria canvas na conversa (v1)
app.post("/:id/canvases", async (c) => {
  const auth = await authorizeConversation(c)
  if (auth instanceof Response) return auth
  const { conversationId } = auth

  const parsed = z
    .object({
      content: z.string().min(1).max(2_000_000),
      kind: z.enum(["markdown", "code", "html", "react", "mermaid"]),
      language: z.string().max(64).nullable().optional(),
      title: z.string().trim().min(1).max(200).optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})))

  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid canvas payload")
  }

  // Adapter Neon HTTP não suporta writes aninhados ($transaction interno):
  // cria o canvas e a versão 1 sequencialmente, com ação compensatória.
  const canvas = await prisma.canvas.create({
    data: {
      content: parsed.data.content,
      conversationId,
      kind: parsed.data.kind,
      language: parsed.data.language ?? null,
      title: parsed.data.title ?? "Canvas",
    },
  })

  try {
    await prisma.canvasVersion.create({
      data: {
        canvasId: canvas.id,
        content: parsed.data.content,
        kind: parsed.data.kind,
        language: parsed.data.language ?? null,
        version: 1,
      },
    })
  } catch (error) {
    await prisma.canvas
      .delete({ where: { id: canvas.id } })
      .catch(() => undefined)
    throw error
  }

  const versions = await prisma.canvasVersion.findMany({
    where: { canvasId: canvas.id },
    orderBy: { version: "desc" },
    select: { createdAt: true, kind: true, language: true, version: true },
  })

  return c.json(
    {
      canvas: {
        activeVersion: canvas.activeVersion,
        content: canvas.content,
        conversationId: canvas.conversationId,
        createdAt: canvas.createdAt,
        id: canvas.id,
        kind: canvas.kind,
        language: canvas.language,
        shareToken: canvas.shareToken,
        title: canvas.title,
        updatedAt: canvas.updatedAt,
        versions,
      },
    },
    201,
  )
})

// POST /conversations/:id/share — generate share token
app.post("/:id/share", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId

  const id = c.req.param("id")
  const existing = await prisma.conversation.findFirst({
    where: { id, userId },
  })
  if (!existing) return jsonErrorResponse(404, "Conversation not found")

  if (existing.shareToken) {
    return c.json({ shareToken: existing.shareToken })
  }

  const shareToken = crypto.randomUUID()
  await prisma.conversation.update({ where: { id }, data: { shareToken } })
  return c.json({ shareToken }, 201)
})

// DELETE /conversations/:id/share — revoke share token
app.delete("/:id/share", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId

  const id = c.req.param("id")
  const existing = await prisma.conversation.findFirst({
    where: { id, userId },
  })
  if (!existing) return jsonErrorResponse(404, "Conversation not found")

  await prisma.conversation.update({
    where: { id },
    data: { shareToken: null },
  })
  return c.json({ success: true })
})

export default app.fetch
