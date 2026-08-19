import { Hono } from "hono"
import { z } from "zod"

import { Prisma } from "../../generated/prisma/client"
import type { HarnessEvent, HarnessRunStatus } from "../../lib/harness/contracts"
import { appendHarnessEvent, ensureLegacyMessageEvents, listHarnessEvents } from "../harness/events"
import { assertPublicHttpUrl } from "../harness/core-tools"
import { assertSecureMcpUrl } from "../harness/mcp"
import { normalizeRequestMessages, type ModelMessage } from "../harness/prompt"
import {
  acquireRunLease,
  abortActiveHarnessRun,
  createHarnessRegistry,
  executeApprovedTool,
  refreshRunToolProjection,
  runHarness,
  type ModelDispatcher,
} from "../harness/runtime"
import { encryptCredential } from "../lib/crypto"
import { prisma } from "../lib/db"
import { jsonErrorResponse } from "../lib/provider-core"
import { authenticateAccess, protectedCors, securityHeaders } from "../lib/security"
import { requireAuth } from "./route-helpers"
import v1Fetch from "./v1"

const app = new Hono().basePath("/harness")
const MAX_HARNESS_TURN_BYTES = 4 * 1024 * 1024
app.use("*", securityHeaders)
app.use("*", protectedCors)
app.use("*", async (c, next) => {
  const authError = await authenticateAccess(c)
  if (authError) return authError
  return next()
})

const harnessMessageSchema = z.object({
  content: z.unknown().optional(),
  id: z.string().trim().min(1).max(64).optional(),
  parts: z.unknown().optional(),
  role: z.enum(["assistant", "system", "tool", "user"]),
  tool_call_id: z.string().optional(),
  tool_calls: z.unknown().optional(),
})

const turnSchema = z.object({
  enteredMessages: z.array(harnessMessageSchema).min(1).max(8).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
  maxSteps: z.number().int().min(1).max(64).default(16),
  messages: z.array(harnessMessageSchema).min(1).max(500),
  model: z.string().trim().min(1).max(300),
  projectId: z.string().trim().min(1).max(64).optional(),
})

const approvalSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  response: z.record(z.string(), z.unknown()).optional(),
})

const mcpServerSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  name: z.string().trim().min(1).max(80),
  status: z.enum(["active", "disabled"]).default("active"),
  url: z.url().max(2_048),
})
const mcpServerUpdateSchema = mcpServerSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
)

const skillSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  description: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().default(true),
  name: z.string().trim().min(1).max(100),
  projectId: z.string().trim().min(1).max(64).nullable().optional(),
})
const skillUpdateSchema = skillSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
)

const forkSchema = z.object({
  boundarySeq: z.string().regex(/^\d+$/).optional(),
  title: z.string().trim().min(1).max(200).optional(),
})

const projectionSchema = z.object({
  content: z.string().max(2_000_000),
  modelLabel: z.string().max(200).optional(),
  parts: z.array(z.unknown()).max(64),
})

const pluginConfigSchema = z.object({
  config: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean(),
})

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function messageText(content: unknown, parts: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((part): part is { text: string; type?: string } => {
      if (!part || typeof part !== "object") return false
      const candidate = part as { text?: unknown; type?: unknown }
      return typeof candidate.text === "string" && (!candidate.type || candidate.type === "text")
    })
    .map((part) => part.text)
    .join("\n")
}

async function ownedConversation(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({ where: { id: conversationId, userId } })
}

function dispatchFromRequest(request: Request): ModelDispatcher {
  return async ({ assistantMessageId, body, signal }) => {
    const url = new URL(request.url)
    url.pathname = "/v1/chat/completions"
    url.search = ""
    const headers = new Headers(request.headers)
    headers.set("content-type", "application/json")
    headers.set("x-modelhub-message-id", assistantMessageId)
    headers.delete("content-length")
    return v1Fetch(
      new Request(url, {
        body: JSON.stringify(body),
        headers,
        method: "POST",
        signal,
      }),
    )
  }
}

async function streamRun(input: {
  initialMessages?: ModelMessage[]
  request: Request
  runId: string
  userId: string
}): Promise<Response> {
  const run = await prisma.agentRun.findFirst({ where: { id: input.runId, userId: input.userId } })
  if (!run) return jsonErrorResponse(404, "Agent run not found")
  let lease: Awaited<ReturnType<typeof acquireRunLease>> = null
  if (["queued", "yielded", "running"].includes(run.status)) {
    lease = await acquireRunLease(run.id, input.userId)
    if (!lease) {
      return jsonErrorResponse(409, "Agent run is already owned by another worker; retry with the same run id")
    }
  }
  const encoder = new TextEncoder()
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  input.request.signal.addEventListener("abort", abort, { once: true })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: HarnessEvent) => {
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode(`event: harness\ndata: ${JSON.stringify(event)}\n\n`))
        }
      }

      try {
        let status = run.status as HarnessRunStatus
        if (lease) {
            status = await runHarness({
              dispatchModel: dispatchFromRequest(input.request),
              initialMessages: input.initialMessages,
              leaseToken: lease.token,
              onEvent: send,
              runId: run.id,
              signal: abortController.signal,
            })
        }

        const statusEvent = await appendHarnessEvent({
          conversationId: run.conversationId,
          payload: { status },
          runId: run.id,
          type: "run/status",
        })
        send(statusEvent)
        controller.close()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`))
        controller.close()
      } finally {
        input.request.signal.removeEventListener("abort", abort)
      }
    },
    cancel() {
      abortController.abort()
      input.request.signal.removeEventListener("abort", abort)
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  })
}

app.get("/capabilities", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const registry = await createHarnessRegistry(userId, c.req.raw.signal, {
    discoverMcp: false,
  })
  try {
    return c.json({ capabilities: registry.listCapabilities(), plugins: registry.listPlugins() })
  } finally {
    registry.dispose()
  }
})

app.get("/plugins", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const configs = await prisma.harnessPluginConfig.findMany({
    where: { userId },
    orderBy: { pluginId: "asc" },
  })
  return c.json({ configs })
})

app.patch("/plugins/:pluginId", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const pluginId = c.req.param("pluginId")
  if (!["modelhub.core-tools", "modelhub.mcp-remote"].includes(pluginId)) {
    return jsonErrorResponse(404, "Plugin not found")
  }
  const parsed = pluginConfigSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonErrorResponse(400, "Invalid plugin config")
  const config = await prisma.harnessPluginConfig.upsert({
    where: { userId_pluginId: { pluginId, userId } },
    create: { ...parsed.data, config: json(parsed.data.config), pluginId, userId },
    update: { ...parsed.data, config: json(parsed.data.config) },
  })
  return c.json({ config })
})

app.post("/conversations/:id/turns", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const conversationId = c.req.param("id")
  const conversation = await ownedConversation(conversationId, userId)
  if (!conversation) return jsonErrorResponse(404, "Conversation not found")

  const contentLength = Number(c.req.header("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_HARNESS_TURN_BYTES) {
    return jsonErrorResponse(413, "Harness turn payload is too large")
  }
  const rawBody = await c.req.text()
  if (Buffer.byteLength(rawBody, "utf8") > MAX_HARNESS_TURN_BYTES) {
    return jsonErrorResponse(413, "Harness turn payload is too large")
  }
  const parsed = turnSchema.safeParse((() => {
    try {
      return JSON.parse(rawBody) as unknown
    } catch {
      return null
    }
  })())
  if (!parsed.success) return jsonErrorResponse(400, "Invalid harness turn payload")
  const body = parsed.data

  if (body.projectId) {
    const project = await prisma.project.findFirst({ where: { id: body.projectId, userId }, select: { id: true } })
    if (!project) return jsonErrorResponse(404, "Project not found")
  }

  const existing = await prisma.agentRun.findUnique({
    where: { conversationId_idempotencyKey: { conversationId, idempotencyKey: body.idempotencyKey } },
  })
  let run = existing
  if (!run) {
    const activeRun = await prisma.agentRun.findFirst({
      where: {
        conversationId,
        parentRunId: null,
        status: { in: ["queued", "running", "yielded", "waiting_approval"] },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
    })
    if (activeRun) {
      return jsonErrorResponse(409, `Conversation already has active run ${activeRun.id} (${activeRun.status})`)
    }
    await ensureLegacyMessageEvents(conversationId)
    const lastUser = [...body.messages].reverse().find((message) => message.role === "user")
    if (!lastUser) return jsonErrorResponse(400, "A user message is required")
    const messageId = lastUser.id ?? crypto.randomUUID()
    const content = messageText(lastUser.content, lastUser.parts)
    const providerId = body.model.includes("/") ? body.model.slice(0, body.model.indexOf("/")) : null

    try {
      run = await prisma.$transaction(async (tx) => {
        const createdRun = await tx.agentRun.create({
        data: {
          conversationId,
          idempotencyKey: body.idempotencyKey,
          maxSteps: body.maxSteps,
          modelId: body.model,
          providerId,
          userId,
        },
      })
      await tx.message.create({
        data: {
          content,
          conversationId,
          id: messageId,
          parts: lastUser.parts === undefined ? undefined : json(lastUser.parts),
          role: "user",
        },
      })
      const enteredMessages = body.enteredMessages ?? [lastUser]
      await tx.sessionEvent.createMany({
        data: enteredMessages.map((message, index) => {
          const isProjectedUser = index === enteredMessages.length - 1
          const enteredId = isProjectedUser ? messageId : (message.id ?? crypto.randomUUID())
          return {
            conversationId,
            id: `evt_${enteredId}`,
            payload: json({
              content: messageText(message.content, message.parts),
              messageId: enteredId,
              parts: message.parts ?? null,
              source: isProjectedUser ? "direct" : "injected",
            }),
            runId: createdRun.id,
            type: "user/message",
          }
        }),
      })
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          engineVersion: "harness-v1",
          modelId: body.model,
          projectId: body.projectId ?? conversation.projectId,
          providerId,
        },
      })
        return createdRun
      })
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error
      run = await prisma.agentRun.findUnique({
        where: {
          conversationId_idempotencyKey: {
            conversationId,
            idempotencyKey: body.idempotencyKey,
          },
        },
      })
      if (!run) {
        const activeRun = await prisma.agentRun.findFirst({
          where: {
            conversationId,
            parentRunId: null,
            status: { in: ["queued", "running", "yielded", "waiting_approval"] },
          },
          select: { id: true, status: true },
        })
        if (activeRun) {
          return jsonErrorResponse(409, `Conversation already has active run ${activeRun.id} (${activeRun.status})`)
        }
        throw error
      }
    }
  }

  return await streamRun({
    initialMessages: existing
      ? undefined
      : normalizeRequestMessages(body.messages),
    request: c.req.raw,
    runId: run.id,
    userId,
  })
})

app.get("/conversations/:id/events", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const conversationId = c.req.param("id")
  if (!(await ownedConversation(conversationId, userId))) return jsonErrorResponse(404, "Conversation not found")
  let after = 0n
  try {
    after = BigInt(c.req.query("after") ?? "0")
  } catch {
    return jsonErrorResponse(400, "Invalid event cursor")
  }
  return c.json({ events: await listHarnessEvents(conversationId, after) })
})

app.post("/conversations/:id/fork", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const sourceId = c.req.param("id")
  const source = await ownedConversation(sourceId, userId)
  if (!source) return jsonErrorResponse(404, "Conversation not found")
  const parsed = forkSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return jsonErrorResponse(400, "Invalid fork payload")

  await ensureLegacyMessageEvents(sourceId)
  const latest = await prisma.sessionEvent.findFirst({
    where: { conversationId: sourceId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  })
  const boundarySeq = parsed.data.boundarySeq
    ? BigInt(parsed.data.boundarySeq)
    : (latest?.seq ?? 0n)
  if (latest && boundarySeq > latest.seq) return jsonErrorResponse(400, "Fork boundary is beyond the event log")

  const events = await prisma.sessionEvent.findMany({
    where: { conversationId: sourceId, seq: { lte: boundarySeq } },
    orderBy: { seq: "asc" },
  })
  const messageIds = events
    .map((event) => {
      const payload = event.payload as Record<string, unknown>
      return typeof payload.messageId === "string" ? payload.messageId : null
    })
    .filter((id): id is string => Boolean(id))
  const messages = await prisma.message.findMany({
    where: { conversationId: sourceId, id: { in: messageIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })
  const attachments = await prisma.conversationAttachment.findMany({
    where: { conversationId: sourceId, messageId: { in: messageIds } },
  })
  const referencedCanvasIds = messages.flatMap((message) =>
    Array.isArray(message.parts)
      ? message.parts
          .map((part) => {
            if (!part || typeof part !== "object") return null
            const canvasId = (part as Record<string, unknown>).canvasId
            return typeof canvasId === "string" ? canvasId : null
          })
          .filter((id): id is string => Boolean(id))
      : [],
  )
  const canvases = await prisma.canvas.findMany({
    where: { conversationId: sourceId, id: { in: referencedCanvasIds } },
    include: { versions: { orderBy: { version: "asc" } } },
  })
  const messageIdMap = new Map(messages.map((message) => [message.id, crypto.randomUUID()]))
  const attachmentIdMap = new Map(attachments.map((attachment) => [attachment.id, crypto.randomUUID()]))
  const canvasIdMap = new Map(canvases.map((canvas) => [canvas.id, crypto.randomUUID()]))
  const rewriteParts = (value: unknown): Prisma.InputJsonValue | undefined => {
    if (!Array.isArray(value)) return value == null ? undefined : json(value)
    return json(
      value.map((part) => {
        if (!part || typeof part !== "object") return part
        const record = { ...(part as Record<string, unknown>) }
        if (typeof record.attachmentId === "string") {
          record.attachmentId = attachmentIdMap.get(record.attachmentId) ?? record.attachmentId
        }
        if (typeof record.canvasId === "string") {
          record.canvasId = canvasIdMap.get(record.canvasId) ?? record.canvasId
        }
        return record
      }),
    )
  }

  const fork = await prisma.$transaction(async (tx) => {
    const created = await tx.conversation.create({
      data: {
        engineVersion: "harness-v1",
        forkBoundarySeq: boundarySeq,
        forkedFromId: sourceId,
        modelId: source.modelId,
        projectId: source.projectId,
        providerId: source.providerId,
        title: parsed.data.title ?? `${source.title} (fork)`,
        userId,
      },
    })
    for (const canvas of canvases) {
      const canvasId = canvasIdMap.get(canvas.id)!
      await tx.canvas.create({
        data: {
          activeVersion: canvas.activeVersion,
          content: canvas.content,
          conversationId: created.id,
          createdAt: canvas.createdAt,
          id: canvasId,
          kind: canvas.kind,
          language: canvas.language,
          title: canvas.title,
        },
      })
      if (canvas.versions.length > 0) {
        await tx.canvasVersion.createMany({
          data: canvas.versions.map((version) => ({
            canvasId,
            content: version.content,
            createdAt: version.createdAt,
            id: crypto.randomUUID(),
            kind: version.kind,
            language: version.language,
            version: version.version,
          })),
        })
      }
    }
    for (const attachment of attachments) {
      await tx.conversationAttachment.create({
        data: {
          blob: attachment.blob,
          byteSize: attachment.byteSize,
          conversationId: created.id,
          createdAt: attachment.createdAt,
          extractedText: attachment.extractedText,
          extractionStatus: attachment.extractionStatus,
          fileName: attachment.fileName,
          id: attachmentIdMap.get(attachment.id)!,
          kind: attachment.kind,
          mimeType: attachment.mimeType,
        },
      })
    }
    for (const message of messages) {
      await tx.message.create({
        data: {
          branchIndex: message.branchIndex,
          content: message.content,
          conversationId: created.id,
          createdAt: message.createdAt,
          id: messageIdMap.get(message.id)!,
          parts: rewriteParts(message.parts),
          role: message.role,
        },
      })
    }
    for (const message of messages) {
      const parentId = message.parentId
        ? messageIdMap.get(message.parentId)
        : undefined
      if (parentId) {
        await tx.message.update({
          where: { id: messageIdMap.get(message.id)! },
          data: { parentId },
        })
      }
    }
    for (const attachment of attachments) {
      const mappedMessageId = attachment.messageId
        ? messageIdMap.get(attachment.messageId)
        : undefined
      if (mappedMessageId) {
        await tx.conversationAttachment.update({
          where: { id: attachmentIdMap.get(attachment.id)! },
          data: { messageId: mappedMessageId },
        })
      }
    }
    for (const event of events) {
      const payload: Record<string, unknown> = {
        ...(event.payload as Record<string, unknown>),
        forkedFromEventId: event.id,
      }
      if (typeof payload.messageId === "string") {
        payload.messageId = messageIdMap.get(payload.messageId) ?? payload.messageId
      }
      await tx.sessionEvent.create({
        data: {
          conversationId: created.id,
          createdAt: event.createdAt,
          payload: json(payload),
          stepId: event.stepId,
          turnId: event.turnId,
          type: event.type,
        },
      })
    }
    return created
  })
  return c.json(
    {
      conversation: {
        ...fork,
        forkBoundarySeq: fork.forkBoundarySeq?.toString() ?? null,
      },
    },
    201,
  )
})

app.patch("/conversations/:id/messages/:messageId/projection", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const conversationId = c.req.param("id")
  if (!(await ownedConversation(conversationId, userId))) return jsonErrorResponse(404, "Conversation not found")
  const parsed = projectionSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonErrorResponse(400, "Invalid message projection")
  const message = await prisma.message.findFirst({
    where: { conversationId, id: c.req.param("messageId"), role: "assistant" },
    select: { id: true, parts: true },
  })
  if (!message) return jsonErrorResponse(404, "Assistant message not found")
  const harnessPart = Array.isArray(message.parts)
    ? message.parts.find(
        (part) =>
          part &&
          typeof part === "object" &&
          (part as Record<string, unknown>).type === "harness",
      )
    : undefined
  const existingMetaPart = Array.isArray(message.parts)
    ? message.parts.find(
        (part) =>
          part &&
          typeof part === "object" &&
          (part as Record<string, unknown>).type === "meta",
      )
    : undefined
  const parts = [
    ...parsed.data.parts,
    ...(harnessPart ? [harnessPart] : []),
    ...(parsed.data.modelLabel
      ? [{ modelLabel: parsed.data.modelLabel, type: "meta" }]
      : existingMetaPart
        ? [existingMetaPart]
        : []),
  ]
  await prisma.message.update({
    where: { id: message.id },
    data: { content: parsed.data.content, parts: json(parts) },
  })
  await appendHarnessEvent({
    conversationId,
    payload: { content: parsed.data.content, messageId: message.id, parts },
    type: "assistant/projection-updated",
  })
  return c.json({ success: true })
})

app.get("/agent-runs/:id", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const run = await prisma.agentRun.findFirst({
    where: { id: c.req.param("id"), userId },
    include: { approvals: { orderBy: { createdAt: "asc" } } },
  })
  if (!run) return jsonErrorResponse(404, "Agent run not found")
  return c.json({ run })
})

app.post("/agent-runs/:id/continue", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const run = await prisma.agentRun.findFirst({ where: { id: c.req.param("id"), userId } })
  if (!run) return jsonErrorResponse(404, "Agent run not found")
  if (!["yielded", "queued", "running"].includes(run.status)) {
    return jsonErrorResponse(409, `Run cannot continue from status ${run.status}`)
  }
  return await streamRun({ request: c.req.raw, runId: run.id, userId })
})

app.post("/agent-runs/:id/cancel", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const run = await prisma.agentRun.findFirst({ where: { id: c.req.param("id"), userId } })
  if (!run) return jsonErrorResponse(404, "Agent run not found")
  const cancelled = await prisma.$transaction(async (tx) => {
    const updated = await tx.agentRun.updateMany({
      where: { id: run.id, status: { in: ["queued", "running", "yielded", "waiting_approval"] } },
      data: { leaseExpiresAt: null, leaseToken: null, status: "cancelled" },
    })
    if (updated.count === 1) {
      const openApprovals = await tx.toolApproval.findMany({
        where: { runId: run.id, status: { in: ["pending", "executing"] } },
        select: { status: true, toolCallId: true, toolName: true },
      })
      await tx.toolApproval.updateMany({
        where: { runId: run.id, status: "pending" },
        data: { decision: "cancelled", resolvedAt: new Date(), result: json({ cancelled: true }), status: "cancelled" },
      })
      await tx.toolApproval.updateMany({
        where: { runId: run.id, status: "executing" },
        data: {
          decision: "cancelled",
          executionExpiresAt: null,
          resolvedAt: new Date(),
          result: json({ error: "Run cancelled while external outcome was unknown", unknown: true }),
          status: "unknown",
        },
      })
      await tx.sessionEvent.create({
        data: { conversationId: run.conversationId, payload: json({ status: "cancelled" }), runId: run.id, type: "run/status" },
      })
      if (openApprovals.length > 0) {
        await tx.sessionEvent.createMany({
          data: openApprovals.map((approval) => ({
            conversationId: run.conversationId,
            payload: json({
              result: approval.status === "executing"
                ? { error: "Run cancelled while external outcome was unknown", unknown: true }
                : { cancelled: true },
              toolCallId: approval.toolCallId,
              toolName: approval.toolName,
            }),
            runId: run.id,
            type: "tool/result",
          })),
        })
      }
    }
    return updated
  })
  const status = cancelled.count === 1 ? "cancelled" : run.status
  if (cancelled.count === 1) {
    abortActiveHarnessRun(run.id)
    await refreshRunToolProjection(run.id)
  }
  return c.json({ runId: run.id, status })
})

app.get("/agent-runs/:id/approvals", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const run = await prisma.agentRun.findFirst({ where: { id: c.req.param("id"), userId }, select: { id: true } })
  if (!run) return jsonErrorResponse(404, "Agent run not found")
  const approvals = await prisma.toolApproval.findMany({
    where: { runId: run.id, userId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, id: true, reason: true, risk: true, status: true, toolCallId: true, toolName: true },
  })
  return c.json({ approvals })
})

app.post("/tool-approvals/:id/resolve", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const parsed = approvalSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonErrorResponse(400, "Invalid approval decision")
  try {
    return c.json(await executeApprovedTool({ ...parsed.data, approvalId: c.req.param("id"), signal: c.req.raw.signal, userId }))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval could not be resolved"
    return jsonErrorResponse(message === "Approval not found" ? 404 : 409, message)
  }
})

app.get("/mcp-servers", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const servers = await prisma.mcpServer.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    select: { createdAt: true, id: true, name: true, status: true, toolsCache: true, updatedAt: true, url: true },
  })
  return c.json({ servers })
})

app.post("/mcp-servers", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const parsed = mcpServerSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonErrorResponse(400, "Invalid MCP server payload")
  try {
    assertSecureMcpUrl(parsed.data.url)
    await assertPublicHttpUrl(parsed.data.url)
    const server = await prisma.mcpServer.create({
      data: {
        encryptedHeaders: parsed.data.headers ? encryptCredential(JSON.stringify(parsed.data.headers)) : null,
        name: parsed.data.name,
        status: parsed.data.status,
        url: parsed.data.url,
        userId,
      },
      select: { createdAt: true, id: true, name: true, status: true, updatedAt: true, url: true },
    })
    return c.json({ server }, 201)
  } catch (error) {
    return jsonErrorResponse(400, error instanceof Error ? error.message : "Could not create MCP server")
  }
})

app.patch("/mcp-servers/:id", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const current = await prisma.mcpServer.findFirst({ where: { id: c.req.param("id"), userId } })
  if (!current) return jsonErrorResponse(404, "MCP server not found")
  const parsed = mcpServerUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonErrorResponse(400, "Invalid MCP server payload")
  try {
    if (parsed.data.url) {
      assertSecureMcpUrl(parsed.data.url)
      await assertPublicHttpUrl(parsed.data.url)
    }
    const server = await prisma.mcpServer.update({
      where: { id: current.id },
      data: {
        ...(parsed.data.headers
          ? { encryptedHeaders: encryptCredential(JSON.stringify(parsed.data.headers)) }
          : {}),
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.url ? { url: parsed.data.url } : {}),
        ...(parsed.data.url ? { toolsCache: Prisma.JsonNull } : {}),
      },
      select: { createdAt: true, id: true, name: true, status: true, updatedAt: true, url: true },
    })
    return c.json({ server })
  } catch (error) {
    return jsonErrorResponse(400, error instanceof Error ? error.message : "Could not update MCP server")
  }
})

app.delete("/mcp-servers/:id", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const removed = await prisma.mcpServer.deleteMany({ where: { id: c.req.param("id"), userId } })
  if (!removed.count) return jsonErrorResponse(404, "MCP server not found")
  return c.json({ success: true })
})

app.get("/skills", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  return c.json({ skills: await prisma.harnessSkill.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }) })
})

app.post("/skills", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const parsed = skillSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonErrorResponse(400, "Invalid skill payload")
  if (parsed.data.projectId) {
    const project = await prisma.project.findFirst({ where: { id: parsed.data.projectId, userId }, select: { id: true } })
    if (!project) return jsonErrorResponse(404, "Project not found")
  }
  try {
    const skill = await prisma.harnessSkill.create({ data: { ...parsed.data, userId } })
    return c.json({ skill }, 201)
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return jsonErrorResponse(409, "A skill with this name already exists in this scope")
    }
    throw error
  }
})

app.patch("/skills/:id", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const current = await prisma.harnessSkill.findFirst({ where: { id: c.req.param("id"), userId } })
  if (!current) return jsonErrorResponse(404, "Skill not found")
  const parsed = skillUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonErrorResponse(400, "Invalid skill payload")
  if (parsed.data.projectId) {
    const project = await prisma.project.findFirst({ where: { id: parsed.data.projectId, userId }, select: { id: true } })
    if (!project) return jsonErrorResponse(404, "Project not found")
  }
  try {
    const skill = await prisma.harnessSkill.update({
      where: { id: current.id },
      data: { ...parsed.data, version: { increment: 1 } },
    })
    return c.json({ skill })
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return jsonErrorResponse(409, "A skill with this name already exists in this scope")
    }
    throw error
  }
})

app.delete("/skills/:id", async (c) => {
  const userId = requireAuth(c)
  if (typeof userId !== "string") return userId
  const removed = await prisma.harnessSkill.deleteMany({ where: { id: c.req.param("id"), userId } })
  if (!removed.count) return jsonErrorResponse(404, "Skill not found")
  return c.json({ success: true })
})

export default app.fetch
