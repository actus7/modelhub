import type { Prisma } from "../../generated/prisma/client"

import { prisma } from "../lib/db"
import { toHarnessJson } from "./json"

export const ACTIVE_ROOT_RUN_STATUSES = [
  "queued",
  "running",
  "yielded",
  "waiting_approval",
] as const

export const RUN_LEASE_MS = 60_000
export const RUN_LEASE_HEARTBEAT_MS = 20_000
export const RUN_IDLE_GRACE_MS = 2 * RUN_LEASE_MS
export const RUN_APPROVAL_GRACE_MS = 24 * 60 * 60 * 1_000

export function staleRootRunWhere(now = new Date()): Prisma.AgentRunWhereInput {
  const idleCutoff = new Date(now.getTime() - RUN_IDLE_GRACE_MS)
  const approvalCutoff = new Date(now.getTime() - RUN_APPROVAL_GRACE_MS)
  return {
    parentRunId: null,
    OR: [
      {
        leaseExpiresAt: { lt: now },
        status: "running",
      },
      {
        leaseExpiresAt: null,
        status: { in: ["queued", "yielded"] },
        updatedAt: { lt: idleCutoff },
      },
      {
        leaseExpiresAt: null,
        status: "waiting_approval",
        updatedAt: { lt: approvalCutoff },
      },
    ],
  }
}

export async function reconcileStaleRootRuns(input: {
  conversationId: string
  now?: Date
  userId: string
}): Promise<string[]> {
  const now = input.now ?? new Date()
  const staleWhere = staleRootRunWhere(now)

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.agentRun.findMany({
      where: {
        ...staleWhere,
        conversationId: input.conversationId,
        userId: input.userId,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
    const reconciled: string[] = []

    for (const candidate of candidates) {
      const updated = await tx.agentRun.updateMany({
        where: {
          ...staleRootRunWhere(now),
          id: candidate.id,
        },
        data: {
          error: "Run became orphaned after its worker lease expired",
          leaseExpiresAt: null,
          leaseToken: null,
          status: "failed",
        },
      })
      if (updated.count !== 1) continue

      reconciled.push(candidate.id)
      await tx.agentRun.updateMany({
        where: {
          parentRunId: candidate.id,
          status: { in: [...ACTIVE_ROOT_RUN_STATUSES] },
        },
        data: {
          error: "Parent run became orphaned",
          leaseExpiresAt: null,
          leaseToken: null,
          status: "failed",
        },
      })
      await tx.toolApproval.updateMany({
        where: { runId: candidate.id, status: "pending" },
        data: {
          decision: "orphaned-run",
          resolvedAt: now,
          result: toHarnessJson({ error: "Run became orphaned" }),
          status: "cancelled",
        },
      })
      await tx.toolApproval.updateMany({
        where: { runId: candidate.id, status: "executing" },
        data: {
          decision: "orphaned-run",
          executionExpiresAt: null,
          resolvedAt: now,
          result: toHarnessJson({
            error: "Run became orphaned while the external outcome was unknown",
            unknown: true,
          }),
          status: "unknown",
        },
      })
      await tx.sessionEvent.createMany({
        data: [
          {
            conversationId: input.conversationId,
            payload: toHarnessJson({
              message: "A execução anterior foi encerrada porque perdeu o vínculo com o servidor.",
              reason: "orphaned-run",
            }),
            runId: candidate.id,
            type: "run/error",
          },
          {
            conversationId: input.conversationId,
            payload: toHarnessJson({ reason: "orphaned-run", status: "failed" }),
            runId: candidate.id,
            type: "run/status",
          },
        ],
      })
    }

    return reconciled
  })
}

export function buildRunReplaySnapshot(
  events: Array<{ payload: unknown; type: string }>,
): { content: string; messageId: string; modelLabel?: string } | null {
  const durableText = events
    .filter((event) => event.type === "assistant/chunk")
    .flatMap((event) => {
      const deltas = (event.payload as Record<string, unknown>)?.deltas
      return Array.isArray(deltas)
        ? deltas.filter((delta): delta is string => typeof delta === "string")
        : []
    })
    .join("")
  const finalMessage = [...events]
    .reverse()
    .find((event) => event.type === "assistant/message")
  const finalPayload = finalMessage?.payload as Record<string, unknown> | undefined
  const fallbackText = typeof finalPayload?.content === "string"
    ? finalPayload.content
    : ""
  const messageId = typeof finalPayload?.messageId === "string"
    ? finalPayload.messageId
    : ""
  if (!messageId || (!durableText && !fallbackText)) return null

  return {
    content: durableText || fallbackText,
    messageId,
    ...(typeof finalPayload?.modelLabel === "string"
      ? { modelLabel: finalPayload.modelLabel }
      : {}),
  }
}

export async function findActiveRootRun(conversationId: string, userId: string) {
  return prisma.agentRun.findFirst({
    where: {
      conversationId,
      parentRunId: null,
      status: { in: [...ACTIVE_ROOT_RUN_STATUSES] },
      userId,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      leaseExpiresAt: true,
      status: true,
      updatedAt: true,
    },
  })
}
