import type { HarnessEvent, HarnessEventType } from "../../lib/harness/contracts"
import { prisma } from "../lib/db"
import { toHarnessJson } from "./json"

type AppendEventInput = {
  conversationId: string
  createdAt?: Date
  id?: string
  payload?: Record<string, unknown>
  runId?: string | null
  stepId?: string | null
  turnId?: string | null
  type: HarnessEventType | (string & {})
}

export class HarnessLeaseLostError extends Error {
  constructor() {
    super("Harness run lease was lost or the run was cancelled")
    this.name = "HarnessLeaseLostError"
  }
}

export function serializeHarnessEvent(event: {
  conversationId: string
  createdAt: Date
  id: string
  payload: unknown
  runId: string | null
  seq: bigint
  stepId: string | null
  turnId: string | null
  type: string
}): HarnessEvent {
  return {
    conversationId: event.conversationId,
    createdAt: event.createdAt.toISOString(),
    eventId: event.id,
    payload: (event.payload ?? {}) as Record<string, unknown>,
    runId: event.runId,
    seq: event.seq.toString(),
    stepId: event.stepId,
    turnId: event.turnId,
    type: event.type,
  }
}

export async function appendHarnessEvent(input: AppendEventInput): Promise<HarnessEvent> {
  const event = await prisma.sessionEvent.create({
    data: {
      conversationId: input.conversationId,
      createdAt: input.createdAt,
      id: input.id,
      payload: toHarnessJson(input.payload ?? {}),
      runId: input.runId ?? null,
      stepId: input.stepId ?? null,
      turnId: input.turnId ?? null,
      type: input.type,
    },
  })
  return serializeHarnessEvent(event)
}

export async function listHarnessEvents(
  conversationId: string,
  after = 0n,
  take = 500,
): Promise<HarnessEvent[]> {
  const events = await prisma.sessionEvent.findMany({
    where: { conversationId, seq: { gt: after } },
    orderBy: { seq: "asc" },
    take: Math.min(Math.max(take, 1), 1_000),
  })
  return events.map(serializeHarnessEvent)
}

export async function collectHarnessEventPages(
  fetchPage: (after: bigint) => Promise<HarnessEvent[]>,
): Promise<HarnessEvent[]> {
  const result: HarnessEvent[] = []
  let after = 0n
  while (true) {
    const page = await fetchPage(after)
    result.push(...page)
    if (page.length < 1_000) return result
    after = BigInt(page.at(-1)!.seq)
  }
}

export async function listAllHarnessEvents(conversationId: string): Promise<HarnessEvent[]> {
  return collectHarnessEventPages((after) => listHarnessEvents(conversationId, after, 1_000))
}

export async function ensureLegacyMessageEvents(conversationId: string): Promise<void> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { content: true, createdAt: true, id: true, parts: true, role: true },
  })
  if (messages.length === 0) return

  await prisma.sessionEvent.createMany({
    data: messages.map((message) => ({
      conversationId,
      createdAt: message.createdAt,
      id: `evt_${message.id}`,
      payload: toHarnessJson({
        content: message.content,
        legacy: true,
        messageId: message.id,
        parts: message.parts,
        role: message.role,
      }),
      type: message.role === "assistant" ? "assistant/message" : "user/message",
    })),
    skipDuplicates: true,
  })
}
