import { prisma } from "../lib/db"
import { listAllHarnessEvents } from "./events"
import type { HarnessRegistry } from "./registry"

export type ModelMessage = {
  content: string | unknown[]
  name?: string
  role: "assistant" | "system" | "tool" | "user"
  tool_call_id?: string
  tool_calls?: Array<{
    function: { arguments: string; name: string }
    id: string
    type: "function"
  }>
}

function contentFromUnknown(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const record = part as Record<string, unknown>
      return typeof record.text === "string" ? record.text : ""
    })
    .filter(Boolean)
    .join("\n")
}

export function normalizeRequestMessages(messages: Array<Record<string, unknown>>): ModelMessage[] {
  return messages
    .map((message): ModelMessage | null => {
      const role = message.role
      if (!['assistant', 'system', 'tool', 'user'].includes(String(role))) return null
      const normalized: ModelMessage = {
        content: Array.isArray(message.parts)
          ? message.parts
          : Array.isArray(message.content)
            ? message.content
            : contentFromUnknown(message.content),
        role: role as ModelMessage["role"],
      }
      if (typeof message.name === "string") normalized.name = message.name
      if (typeof message.tool_call_id === "string") normalized.tool_call_id = message.tool_call_id
      if (Array.isArray(message.tool_calls)) normalized.tool_calls = message.tool_calls as ModelMessage["tool_calls"]
      return normalized
    })
    .filter((message): message is ModelMessage => message !== null)
}

export async function deriveMessagesFromEvents(conversationId: string): Promise<ModelMessage[]> {
  const events = await listAllHarnessEvents(conversationId)
  const messages: ModelMessage[] = []
  const latestSummaryIndex = events.findLastIndex((event) => event.type === "compaction/summary")
  if (latestSummaryIndex >= 0) {
    const summary = events[latestSummaryIndex]!.payload.summary
    messages.push({ content: `Compacted earlier context:\n${String(summary ?? "")}`, role: "system" })
  }
  for (const event of events.slice(latestSummaryIndex + 1)) {
    const payload = event.payload as Record<string, unknown>
    if (event.type === "user/message") {
      messages.push({
        content: Array.isArray(payload.parts)
          ? payload.parts
          : contentFromUnknown(payload.content),
        role: "user",
      })
    } else if (event.type === "assistant/message") {
      const message: ModelMessage = { content: String(payload.content ?? ""), role: "assistant" }
      if (Array.isArray(payload.toolCalls)) {
        message.tool_calls = payload.toolCalls.map((call) => {
          const record = call as Record<string, unknown>
          return {
            function: {
              arguments: JSON.stringify(record.args ?? {}),
              name: String(record.toolName ?? "unknown_tool"),
            },
            id: String(record.toolCallId ?? crypto.randomUUID()),
            type: "function" as const,
          }
        })
      }
      messages.push(message)
    } else if (event.type === "tool/result") {
      messages.push({
        content: JSON.stringify(payload.result ?? payload.error ?? null),
        role: "tool",
        tool_call_id: String(payload.toolCallId ?? "unknown"),
      })
    }
  }
  return messages
}

export function compactModelMessages(messages: ModelMessage[], maxCharacters = 90_000): {
  compacted: boolean
  messages: ModelMessage[]
  summary?: string
} {
  const size = messages.reduce(
    (total, message) =>
      total +
      (typeof message.content === "string"
        ? message.content.length
        : JSON.stringify(message.content).length) +
      JSON.stringify(message.tool_calls ?? []).length,
    0,
  )
  if (size <= maxCharacters || messages.length <= 8) return { compacted: false, messages }

  let boundary = Math.max(0, messages.length - 8)
  while (boundary > 0 && messages[boundary]?.role === "tool") boundary -= 1
  const retained = messages.slice(boundary)
  const removed = messages.slice(0, boundary)
  const summary = removed
    .map((message) => {
      const content =
        typeof message.content === "string"
          ? message.content
          : contentFromUnknown(message.content)
      return `${message.role}: ${content.slice(0, 500)}`
    })
    .join("\n")
    .slice(-20_000)
  return {
    compacted: true,
    messages: [{ content: `Compacted earlier context:\n${summary}`, role: "system" }, ...retained],
    summary,
  }
}

export async function buildHarnessSystemPrompt(input: {
  projectId: string | null
  registry: HarnessRegistry
  userId: string
}): Promise<string> {
  const [settings, memories, skills, project] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId: input.userId } }),
    prisma.userMemory.findMany({ where: { userId: input.userId }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.harnessSkill.findMany({
      where: {
        enabled: true,
        userId: input.userId,
        OR: [{ projectId: null }, ...(input.projectId ? [{ projectId: input.projectId }] : [])],
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    input.projectId
      ? prisma.project.findFirst({ where: { id: input.projectId, userId: input.userId }, select: { instructions: true, name: true } })
      : null,
  ])

  const availableCapabilities = input.registry.listCapabilities().filter((capability) => capability.available)
  const unavailableCapabilities = input.registry.listCapabilities().filter((capability) => !capability.available)
  return [
    "You are ModelHub's agent runtime. Work in explicit, bounded steps and use tools when they materially improve the answer.",
    "Never claim that a tool ran unless a tool result is present. Respect approval denials and capability limits.",
    settings?.customInstructionsAbout ? `User context:\n${settings.customInstructionsAbout}` : "",
    settings?.customInstructionsStyle ? `Response preferences:\n${settings.customInstructionsStyle}` : "",
    memories.length ? `Saved memories:\n${memories.map((memory) => `- ${memory.content}`).join("\n")}` : "",
    project ? `Active project: ${project.name}\n${project.instructions ?? ""}` : "",
    skills.length
      ? `Active skills:\n${skills.map((skill) => `## ${skill.name}\n${skill.content}`).join("\n\n")}`
      : "",
    `Available capabilities: ${availableCapabilities.map((capability) => capability.id).join(", ") || "none"}.`,
    unavailableCapabilities.length
      ? `Unavailable capabilities (do not simulate): ${unavailableCapabilities.map((capability) => `${capability.id}: ${capability.reason}`).join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}
