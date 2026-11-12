import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationAttachmentDescriptor } from "@/lib/chat-parts"

const getSession = vi.fn()

type ConversationRecord = {
  createdAt: Date
  id: string
  modelId: string | null
  providerId: string | null
  title: string
  updatedAt: Date
  userId: string
}

type MessageRecord = {
  content: string
  conversationId: string
  createdAt: Date
  id: string
  parts: unknown
  role: string
}

type UsageLogRecord = {
  attempts: unknown
  costUsd: number | null
  durationMs: number | null
  errorDetail?: string | null
  inputTokens: number | null
  messageId: string | null
  modelId: string | null
  outputTokens: number | null
  providerId: string
  routingReason: string | null
  routingTier: string | null
  statusCode?: number
  ttftMs: number | null
  userId?: string
}

type AttachmentRecord = {
  blob: Uint8Array<ArrayBuffer>
  byteSize: number
  conversationId: string
  createdAt: Date
  extractedText: string | null
  extractionStatus: string
  fileName: string
  id: string
  kind: string
  messageId: string | null
  mimeType: string
}

type SessionEventRecord = {
  conversationId: string
  id: string
  payload: Record<string, unknown>
  type: string
}

let conversationCounter = 1
let messageCounter = 1
let attachmentCounter = 1

const state: {
  attachments: AttachmentRecord[]
  conversations: ConversationRecord[]
  events: SessionEventRecord[]
  messages: MessageRecord[]
  usageLogs: UsageLogRecord[]
} = {
  attachments: [],
  conversations: [],
  events: [],
  messages: [],
  usageLogs: [],
}

function now() {
  return new Date("2026-03-28T12:00:00.000Z")
}

function resetState() {
  conversationCounter = 1
  messageCounter = 1
  attachmentCounter = 1
  state.attachments = []
  state.conversations = [
    {
      createdAt: now(),
      id: "conv-1",
      modelId: "openai/gpt-4.1-mini",
      providerId: "openrouter",
      title: "Nova conversa",
      updatedAt: now(),
      userId: "user-1",
    },
  ]
  state.messages = []
  state.events = []
  state.usageLogs = []
}

const mockPrisma = {
  $transaction: vi.fn(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma)),
  apiKey: {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
  },
  conversation: {
    create: vi.fn(
      async ({
        data,
        select,
      }: {
        data: Partial<ConversationRecord>
        select?: Record<string, boolean>
      }) => {
        const conversation: ConversationRecord = {
          createdAt: now(),
          id: `conv-${(conversationCounter += 1)}`,
          modelId: data.modelId ?? null,
          providerId: data.providerId ?? null,
          title: data.title ?? "Nova conversa",
          updatedAt: now(),
          userId: data.userId ?? "user-1",
        }
        state.conversations.push(conversation)
        return select ? project(conversation, select) : conversation
      },
    ),
    delete: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
      state.conversations = state.conversations.filter(
        (conversation) => conversation.id !== id,
      )
      state.messages = state.messages.filter(
        (message) => message.conversationId !== id,
      )
      state.attachments = state.attachments.filter(
        (attachment) => attachment.conversationId !== id,
      )
      return { id }
    }),
    findFirst: vi.fn(
      async ({ where }: { where: { id?: string; userId?: string } }) =>
        state.conversations.find(
          (conversation) =>
            (!where.id || conversation.id === where.id) &&
            (!where.userId || conversation.userId === where.userId),
        ) ?? null,
    ),
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          userId: string
          OR?: Array<{
            title?: { contains: string; mode: string }
            messages?: { some: { content: { contains: string; mode: string } } }
          }>
        }
      }) => {
        const matchesSearch = (conversation: ConversationRecord) => {
          if (!where.OR?.length) return true
          return where.OR.some((condition) => {
            if (condition.title) {
              return conversation.title
                .toLowerCase()
                .includes(condition.title.contains.toLowerCase())
            }
            if (condition.messages) {
              const needle =
                condition.messages.some.content.contains.toLowerCase()
              return state.messages.some(
                (message) =>
                  message.conversationId === conversation.id &&
                  message.content.toLowerCase().includes(needle),
              )
            }
            return false
          })
        }

        return state.conversations
          .filter((conversation) => conversation.userId === where.userId)
          .filter(matchesSearch)
          .sort(
            (left, right) =>
              right.updatedAt.getTime() - left.updatedAt.getTime(),
          )
      },
    ),
    update: vi.fn(
      async ({
        where: { id },
        data,
        select,
      }: {
        data: Partial<ConversationRecord>
        select?: Record<string, boolean>
        where: { id: string }
      }) => {
        const conversation = state.conversations.find(
          (entry) => entry.id === id,
        )
        if (!conversation) {
          throw new Error(`Conversation ${id} not found`)
        }

        conversation.title = data.title ?? conversation.title
        conversation.updatedAt = now()
        return select ? project(conversation, select) : conversation
      },
    ),
  },
  sessionEvent: {
    deleteMany: vi.fn(async ({ where }: { where: { id?: { in: string[] } } }) => {
      const ids = new Set(where.id?.in ?? [])
      const before = state.events.length
      state.events = state.events.filter((event) => !ids.has(event.id))
      return { count: before - state.events.length }
    }),
    findMany: vi.fn(async () => state.events),
  },
  conversationAttachment: {
    create: vi.fn(
      async ({
        data,
        select,
      }: {
        data: Omit<AttachmentRecord, "createdAt" | "id" | "messageId"> & {
          messageId?: string | null
        }
        select?: Record<string, boolean>
      }) => {
        const attachment: AttachmentRecord = {
          blob: data.blob,
          byteSize: data.byteSize,
          conversationId: data.conversationId,
          createdAt: now(),
          extractedText: data.extractedText ?? null,
          extractionStatus: data.extractionStatus,
          fileName: data.fileName,
          id: `att-${(attachmentCounter += 1)}`,
          kind: data.kind,
          messageId: data.messageId ?? null,
          mimeType: data.mimeType,
        }
        state.attachments.push(attachment)
        return select ? project(attachment, select) : attachment
      },
    ),
    findFirst: vi.fn(
      async ({
        where,
        select,
      }: {
        select?: Record<string, boolean>
        where: { conversationId?: string; id?: string }
      }) => {
        const attachment =
          state.attachments.find(
            (entry) =>
              (!where.conversationId ||
                entry.conversationId === where.conversationId) &&
              (!where.id || entry.id === where.id),
          ) ?? null
        return attachment && select ? project(attachment, select) : attachment
      },
    ),
    findMany: vi.fn(
      async ({
        where,
        select,
      }: {
        select?: Record<string, boolean>
        where?: {
          conversation?: { userId?: string }
          conversationId?: string
          id?: { in?: string[] }
        }
      }) => {
        const attachments = state.attachments.filter((attachment) => {
          if (
            where?.conversationId &&
            attachment.conversationId !== where.conversationId
          ) {
            return false
          }

          if (where?.id?.in && !where.id.in.includes(attachment.id)) {
            return false
          }

          if (where?.conversation?.userId) {
            const conversation = state.conversations.find(
              (entry) => entry.id === attachment.conversationId,
            )
            return conversation?.userId === where.conversation.userId
          }

          return true
        })

        return select
          ? attachments.map((attachment) => project(attachment, select))
          : attachments
      },
    ),
    updateMany: vi.fn(
      async ({
        data,
        where,
      }: {
        data: { messageId?: string | null }
        where: { conversationId?: string; id?: { in?: string[] } }
      }) => {
        let count = 0
        for (const attachment of state.attachments) {
          if (
            where.conversationId &&
            attachment.conversationId !== where.conversationId
          ) {
            continue
          }
          if (where.id?.in && !where.id.in.includes(attachment.id)) {
            continue
          }
          attachment.messageId = data.messageId ?? null
          count += 1
        }
        return { count }
      },
    ),
  },
  message: {
    create: vi.fn(
      async ({
        data,
        select,
      }: {
        data: Omit<MessageRecord, "createdAt" | "id"> & { id?: string }
        select?: Record<string, boolean>
      }) => {
        const message: MessageRecord = {
          content: data.content,
          conversationId: data.conversationId,
          createdAt: now(),
          id: data.id ?? `msg-${(messageCounter += 1)}`,
          parts: data.parts ?? null,
          role: data.role,
        }
        state.messages.push(message)
        return select ? project(message, select) : message
      },
    ),
    deleteMany: vi.fn(
      async ({
        where,
      }: {
        where: { conversationId?: string; id?: { in?: string[] } }
      }) => {
        const beforeCount = state.messages.length
        const deletedIds = new Set(where.id?.in ?? [])
        state.messages = state.messages.filter((message) => {
          if (
            where.conversationId &&
            message.conversationId !== where.conversationId
          ) {
            return true
          }
          return !deletedIds.has(message.id)
        })
        for (const attachment of state.attachments) {
          if (attachment.messageId && deletedIds.has(attachment.messageId)) {
            attachment.messageId = null
          }
        }
        return { count: beforeCount - state.messages.length }
      },
    ),
    findFirst: vi.fn(
      async ({
        where,
        select,
      }: {
        select?: Record<string, boolean>
        where: { conversationId?: string; id?: string }
      }) => {
        const message =
          state.messages.find(
            (entry) =>
              (!where.conversationId ||
                entry.conversationId === where.conversationId) &&
              (!where.id || entry.id === where.id),
          ) ?? null
        return message && select ? project(message, select) : message
      },
    ),
    findMany: vi.fn(
      async ({
        where,
        select,
      }: {
        select?: Record<string, boolean>
        where: { conversationId: string }
      }) => {
        const messages = state.messages
          .filter((message) => message.conversationId === where.conversationId)
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id),
          )
        return select
          ? messages.map((message) => project(message, select))
          : messages
      },
    ),
  },
  messageReaction: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "reaction-1",
      ...data,
    })),
    delete: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  },
  providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
  usageLog: {
    create: vi.fn().mockReturnValue({ catch: vi.fn() }),
    findMany: vi.fn(
      async ({
        where,
        select,
      }: {
        select?: Record<string, boolean>
        where: { messageId: { in: string[] }; userId: string }
      }) => {
        const ids = new Set(where.messageId.in)
        const logs = state.usageLogs.filter(
          (log) =>
            log.messageId !== null &&
            ids.has(log.messageId) &&
            (log.userId ?? "user-1") === where.userId,
        )
        return select ? logs.map((log) => project(log, select)) : logs
      },
    ),
  },
  user: { upsert: vi.fn().mockResolvedValue(null) },
}

function project<T extends Record<string, unknown>>(
  value: T,
  select: Record<string, boolean>,
) {
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, include]) => include)
      .map(([key]) => [key, value[key as keyof T]]),
  )
}

vi.mock("../lib/db", () => ({ prisma: mockPrisma }))
vi.mock("../env", () => ({}))
vi.mock("@/lib/auth/server", () => ({ auth: { getSession } }))

const conversationsFetch = (await import("../routes/conversations")).default

describe("conversation routes with attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
    getSession.mockResolvedValue({
      data: {
        session: { id: "session-1" },
        user: { email: "user@example.com", id: "user-1", name: "User" },
      },
    })
  })

  afterEach(() => {
    getSession.mockReset()
  })

  it("normaliza titulos longos enviados por bundles antigos", async () => {
    const longTitle = "titulo longo ".repeat(100)
    const createResponse = await conversationsFetch(
      new Request("http://localhost/conversations", {
        body: JSON.stringify({
          modelId: "auto",
          providerId: "auto",
          title: longTitle,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )

    expect(createResponse.status).toBe(201)
    const createPayload = (await createResponse.json()) as {
      conversation: { id: string; title: string }
    }
    expect(createPayload.conversation.title).toHaveLength(200)
    expect(createPayload.conversation.title).toBe(longTitle.trim().slice(0, 200))

    const updateResponse = await conversationsFetch(
      new Request(
        `http://localhost/conversations/${createPayload.conversation.id}`,
        {
          body: JSON.stringify({ title: longTitle }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      ),
    )

    expect(updateResponse.status).toBe(200)
    expect(
      ((await updateResponse.json()) as { conversation: { title: string } })
        .conversation.title,
    ).toHaveLength(200)
  })

  it("uploads an attachment, persists message parts, and hydrates them on fetch", async () => {
    const imageBody = new Uint8Array([137, 80, 78, 71])
    const formData = new FormData()
    formData.append(
      "file",
      new File([imageBody], "preview.png", { type: "image/png" }),
    )

    const uploadResponse = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/attachments", {
        body: formData,
        method: "POST",
      }),
    )

    expect(uploadResponse.status).toBe(201)
    const uploadPayload = (await uploadResponse.json()) as {
      attachment: ConversationAttachmentDescriptor
    }
    expect(uploadPayload.attachment.fileName).toBe("preview.png")
    expect(uploadPayload.attachment.contentUrl).toContain(
      "/conversations/conv-1/attachments/",
    )

    const saveResponse = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages", {
        body: JSON.stringify({
          messages: [
            {
              parts: [
                { text: "Analise a imagem", type: "text" },
                {
                  attachmentId: uploadPayload.attachment.id,
                  fileName: uploadPayload.attachment.fileName,
                  kind: "image",
                  mimeType: uploadPayload.attachment.mimeType,
                  type: "attachment",
                },
              ],
              role: "user",
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )

    expect(saveResponse.status).toBe(201)
    const savedPayload = (await saveResponse.json()) as {
      messages: Array<{ id: string; parts: Array<{ type: string }> }>
    }
    expect(savedPayload.messages[0]?.parts).toHaveLength(2)

    const fetchResponse = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages", {
        method: "GET",
      }),
    )

    expect(fetchResponse.status).toBe(200)
    const fetchPayload = (await fetchResponse.json()) as {
      messages: Array<{
        parts: Array<{ contentUrl?: string; fileName?: string; type: string }>
      }>
    }

    expect(fetchPayload.messages[0]?.parts[0]).toEqual({
      text: "Analise a imagem",
      type: "text",
    })
    expect(fetchPayload.messages[0]?.parts[1]).toMatchObject({
      contentUrl: uploadPayload.attachment.contentUrl,
      fileName: "preview.png",
      type: "attachment",
    })

    const contentResponse = await conversationsFetch(
      new Request(
        uploadPayload.attachment.contentUrl.replace(
          "/conversations",
          "http://localhost/conversations",
        ),
        {
          method: "GET",
        },
      ),
    )

    expect(contentResponse.status).toBe(200)
    expect(contentResponse.headers.get("Content-Type")).toBe("image/png")
    expect(new Uint8Array(await contentResponse.arrayBuffer())).toEqual(
      imageBody,
    )
  })

  it("anexa os bastidores (roteamento, tentativas, tempo, tokens) na mensagem do assistente", async () => {
    const saveResponse = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages", {
        body: JSON.stringify({
          messages: [
            { parts: [{ text: "Olá!", type: "text" }], role: "assistant" },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )
    expect(saveResponse.status).toBe(201)
    const savedPayload = (await saveResponse.json()) as {
      messages: Array<{ id: string }>
    }
    const assistantMessageId = savedPayload.messages[0]!.id

    state.usageLogs.push({
      attempts: [
        { errorSnippet: "rate_limited", modelId: "gpt-4o-mini", status: 429 },
      ],
      costUsd: 0.0021,
      durationMs: 1420,
      inputTokens: 512,
      messageId: assistantMessageId,
      modelId: "gpt-4o",
      outputTokens: 128,
      providerId: "openai",
      routingReason: "auto",
      routingTier: "balanced",
      ttftMs: 310,
    })

    const fetchResponse = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages", {
        method: "GET",
      }),
    )
    expect(fetchResponse.status).toBe(200)
    const fetchPayload = (await fetchResponse.json()) as {
      messages: Array<{
        id: string
        backstage?: { attempts: unknown[]; providerId: string; ttftMs: number }
      }>
    }
    const assistantMessage = fetchPayload.messages.find(
      (m) => m.id === assistantMessageId,
    )

    expect(assistantMessage?.backstage).toMatchObject({
      attempts: [{ modelId: "gpt-4o-mini", status: 429 }],
      providerId: "openai",
      ttftMs: 310,
    })
  })

  it("agrega múltiplas tentativas de fallback entre provedores (mesmo messageId) num único bastidores", async () => {
    const saveResponse = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages", {
        body: JSON.stringify({
          messages: [{ parts: [{ text: "Oi" }], role: "assistant" }],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )
    const savedPayload = (await saveResponse.json()) as {
      messages: Array<{ id: string }>
    }
    const assistantMessageId = savedPayload.messages[0]!.id

    // O roteamento automático tentou "gateway" (falhou) antes de cair para "quillbot" (sucesso) —
    // cada tentativa grava sua própria linha com o mesmo messageId (regressão: messageId não é único).
    state.usageLogs.push(
      {
        attempts: null,
        costUsd: null,
        durationMs: 251,
        errorDetail: "upstream indisponível",
        inputTokens: null,
        messageId: assistantMessageId,
        modelId: "amazon/nova-micro",
        outputTokens: null,
        providerId: "gateway",
        routingReason: "auto_default",
        routingTier: "default",
        statusCode: 503,
        ttftMs: null,
      },
      {
        attempts: null,
        costUsd: 0.0004,
        durationMs: 1270,
        errorDetail: null,
        inputTokens: 64,
        messageId: assistantMessageId,
        modelId: "quillbot-ai",
        outputTokens: 32,
        providerId: "quillbot",
        routingReason: "fallback",
        routingTier: "default",
        statusCode: 200,
        ttftMs: 1422,
      },
    )

    const fetchResponse = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages", {
        method: "GET",
      }),
    )
    const fetchPayload = (await fetchResponse.json()) as {
      messages: Array<{
        id: string
        backstage?: {
          attempts: Array<{
            modelId: string
            providerId: string
            status: number
          }>
          providerId: string
        }
      }>
    }
    const assistantMessage = fetchPayload.messages.find(
      (m) => m.id === assistantMessageId,
    )

    expect(assistantMessage?.backstage?.providerId).toBe("quillbot")
    expect(assistantMessage?.backstage?.attempts).toMatchObject([
      {
        durationMs: 251,
        modelId: "amazon/nova-micro",
        providerId: "gateway",
        status: 503,
      },
    ])
  })

  it("nao expoe UsageLog de outro usuario mesmo com messageId correlacionado", async () => {
    state.messages.push({
      content: "Resposta",
      conversationId: "conv-1",
      createdAt: now(),
      id: "shared-correlation-id",
      parts: null,
      role: "assistant",
    })
    state.usageLogs.push({
      attempts: null,
      costUsd: null,
      durationMs: 100,
      inputTokens: null,
      messageId: "shared-correlation-id",
      modelId: "private-model",
      outputTokens: null,
      providerId: "private-provider",
      routingReason: null,
      routingTier: null,
      statusCode: 500,
      ttftMs: null,
      userId: "user-2",
    })

    const response = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages"),
    )
    const payload = (await response.json()) as {
      messages: Array<{ id: string; backstage?: unknown }>
    }
    expect(payload.messages.find((message) => message.id === "shared-correlation-id"))
      .not.toHaveProperty("backstage")
  })

  it("rejeita reacao para mensagem fora da conversa autorizada", async () => {
    state.conversations.push({
      createdAt: now(),
      id: "conv-2",
      modelId: null,
      providerId: null,
      title: "Outra",
      updatedAt: now(),
      userId: "user-1",
    })
    state.messages.push({
      content: "Fora",
      conversationId: "conv-2",
      createdAt: now(),
      id: "msg-other-conversation",
      parts: null,
      role: "assistant",
    })

    const response = await conversationsFetch(
      new Request(
        "http://localhost/conversations/conv-1/messages/msg-other-conversation/reaction",
        {
          body: JSON.stringify({ type: "thumbs_down" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ),
    )

    expect(response.status).toBe(404)
    expect(mockPrisma.messageReaction.create).not.toHaveBeenCalled()
  })

  it("valida role de mensagens persistidas e tipo da nota de reacao", async () => {
    const invalidMessage = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages", {
        body: JSON.stringify({ messages: [{ content: "x", role: "system" }] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )
    expect(invalidMessage.status).toBe(400)

    state.messages.push({
      content: "Resposta",
      conversationId: "conv-1",
      createdAt: now(),
      id: "msg-reaction",
      parts: null,
      role: "assistant",
    })
    const invalidReaction = await conversationsFetch(
      new Request(
        "http://localhost/conversations/conv-1/messages/msg-reaction/reaction",
        {
          body: JSON.stringify({ note: 123, type: "thumbs_down" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ),
    )
    expect(invalidReaction.status).toBe(400)
  })

  it("compensa mensagens criadas quando uma escrita subsequente falha", async () => {
    mockPrisma.conversationAttachment.updateMany.mockRejectedValueOnce(
      new Error("attachment update failed"),
    )

    const response = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages", {
        body: JSON.stringify({
          messages: [
            {
              parts: [
                {
                  attachmentId: "att-missing",
                  fileName: "file.pdf",
                  kind: "document",
                  mimeType: "application/pdf",
                  type: "attachment",
                },
              ],
              role: "user",
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )

    expect(response.status).toBe(500)
    expect(state.messages).toEqual([])
  })

  it("ja retorna os bastidores no POST de mensagens (nao so no GET seguinte)", async () => {
    const clientMessageId = "client-generated-id-1"
    state.usageLogs.push({
      attempts: null,
      costUsd: 0.0004,
      durationMs: 3120,
      errorDetail: null,
      inputTokens: null,
      messageId: clientMessageId,
      modelId: "quillbot-ai",
      outputTokens: null,
      providerId: "quillbot",
      routingReason: "auto_default",
      routingTier: "default",
      statusCode: 200,
      ttftMs: 3277,
    })

    const saveResponse = await conversationsFetch(
      new Request("http://localhost/conversations/conv-1/messages", {
        body: JSON.stringify({
          messages: [
            {
              content: "Oi!",
              id: clientMessageId,
              parts: [{ text: "Oi!", type: "text" }],
              role: "assistant",
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )
    const savedPayload = (await saveResponse.json()) as {
      messages: Array<{
        id: string
        backstage?: { providerId: string; ttftMs: number }
      }>
    }

    expect(savedPayload.messages[0]?.id).toBe(clientMessageId)
    expect(savedPayload.messages[0]?.backstage).toMatchObject({
      providerId: "quillbot",
      ttftMs: 3277,
    })
  })

  it("trims persisted messages from a target id onward", async () => {
    state.messages.push(
      {
        content: "Primeira",
        conversationId: "conv-1",
        createdAt: now(),
        id: "msg-a",
        parts: null,
        role: "user",
      },
      {
        content: "Resposta",
        conversationId: "conv-1",
        createdAt: now(),
        id: "msg-b",
        parts: null,
        role: "assistant",
      },
      {
        content: "Segunda",
        conversationId: "conv-1",
        createdAt: now(),
        id: "msg-c",
        parts: null,
        role: "user",
      },
    )
    state.events.push(
      {
        conversationId: "conv-1",
        id: "evt_msg-a",
        payload: { messageId: "msg-a" },
        type: "user/message",
      },
      {
        conversationId: "conv-1",
        id: "evt_msg-b",
        payload: { messageId: "msg-b" },
        type: "assistant/message",
      },
      {
        conversationId: "conv-1",
        id: "evt_msg-c",
        payload: { messageId: "msg-c" },
        type: "user/message",
      },
    )

    const response = await conversationsFetch(
      new Request(
        "http://localhost/conversations/conv-1/messages?fromMessageId=msg-b",
        {
          method: "DELETE",
        },
      ),
    )

    expect(response.status).toBe(200)
    expect(state.messages.map((message) => message.id)).toEqual(["msg-a"])
    expect(state.events.map((event) => event.id)).toEqual(["evt_msg-a"])
  })

  it("lista conversas sem filtro quando ?q= esta ausente", async () => {
    state.conversations.push({
      createdAt: now(),
      id: "conv-2",
      modelId: null,
      providerId: null,
      title: "Deploy na Vercel",
      updatedAt: now(),
      userId: "user-1",
    })

    const response = await conversationsFetch(
      new Request("http://localhost/conversations"),
    )
    const payload = (await response.json()) as {
      conversations: Array<{ id: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.conversations.map((c) => c.id)).toEqual(["conv-1", "conv-2"])
  })

  it("filtra conversas por titulo e por conteudo das mensagens via ?q= (case-insensitive)", async () => {
    state.conversations.push(
      {
        createdAt: now(),
        id: "conv-2",
        modelId: null,
        providerId: null,
        title: "Deploy na Vercel",
        updatedAt: now(),
        userId: "user-1",
      },
      {
        createdAt: now(),
        id: "conv-other-user",
        modelId: null,
        providerId: null,
        title: "Deploy privado de outro usuario",
        updatedAt: now(),
        userId: "user-2",
      },
    )
    state.messages.push({
      content: "Como configurar Postgres no Neon?",
      conversationId: "conv-1",
      createdAt: now(),
      id: "msg-search",
      parts: null,
      role: "user",
    })

    // Match por titulo (e nao vaza conversas de outro usuario).
    const byTitle = await conversationsFetch(
      new Request("http://localhost/conversations?q=DEPLOY"),
    )
    const titlePayload = (await byTitle.json()) as {
      conversations: Array<{ id: string }>
    }
    expect(byTitle.status).toBe(200)
    expect(titlePayload.conversations.map((c) => c.id)).toEqual(["conv-2"])

    // Match por conteudo de mensagem de outra conversa.
    const byContent = await conversationsFetch(
      new Request("http://localhost/conversations?q=postgres"),
    )
    const contentPayload = (await byContent.json()) as {
      conversations: Array<{ id: string }>
    }
    expect(contentPayload.conversations.map((c) => c.id)).toEqual(["conv-1"])

    // Sem correspondencias.
    const none = await conversationsFetch(
      new Request("http://localhost/conversations?q=zzz-inexistente"),
    )
    const nonePayload = (await none.json()) as {
      conversations: Array<{ id: string }>
    }
    expect(nonePayload.conversations).toEqual([])
  })
})
