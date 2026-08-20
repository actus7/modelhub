import type { Prisma } from "../../generated/prisma/client"
import type { HarnessEvent, HarnessRunStatus, HarnessToolCall } from "../../lib/harness/contracts"
import { prisma } from "../lib/db"
import { appendHarnessEvent, ensureLegacyMessageEvents, HarnessLeaseLostError, serializeHarnessEvent } from "./events"
import { toHarnessJson } from "./json"
import {
  consumeHarnessModelResponse,
  isModelOutputLimitFinishReason,
  type HarnessModelResult,
} from "./model-stream"
import { createMcpPlugin } from "./mcp"
import {
  buildHarnessSystemPrompt,
  compactModelMessages,
  deriveMessagesFromEvents,
  missingExplicitIterativeSections,
  type ModelMessage,
} from "./prompt"
import { HarnessRegistry, type HarnessToolDefinition } from "./registry"
import { coreHarnessPlugin } from "./core-tools"
import {
  RUN_LEASE_HEARTBEAT_MS,
  RUN_LEASE_MS,
} from "./run-lifecycle"

const EXECUTION_SLICE_MS = 50_000
export const MAX_TOOL_CALLS_PER_STEP = 16
export const MAX_SUBAGENTS_PER_RUN = 4
export const MAX_OUTPUT_LIMIT_CONTINUATIONS = 8
const APPROVAL_EXECUTION_MS = 60_000
const activeToolExecutions = new Map<string, Set<AbortController>>()
const activeRunExecutions = new Map<string, Set<AbortController>>()

type OpenAiHarnessToolSchema = ReturnType<HarnessRegistry["openAiSchemas"]>[number]

const PERSISTENT_COORDINATION_REQUEST =
  /\b(goal_write|plan_write|todo_write|salv(?:e|ar)|persist(?:a|ir|e)|registre|atualize)\b[\s\S]{0,80}\b(objetivo|goal|plano|plan|tarefas?|todos?)\b/i
const SUBAGENT_REQUEST =
  /\b(subagent|subagente|deleg(?:ate|ar|ue)|separate agent|agente separado)\b/i
const WEB_TOOL_REQUEST =
  /\b(search|research|look up|browse|web|internet|source|url|pesquis\w*|busc\w*|procure|consulte|fontes?)\b|https?:\/\//i
const CONTEXT_SEARCH_REQUEST =
  /\b(memory|memories|mem[oó]ria|history|hist[oó]rico|conversation events?|eventos? da conversa|previous conversation|conversa anterior)\b/i

export function selectHarnessToolSchemas(input: {
  messages: ModelMessage[]
  projectId: string | null
  tools: OpenAiHarnessToolSchema[]
}): OpenAiHarnessToolSchema[] {
  const latestUserContent = [...input.messages]
    .reverse()
    .find((message) => message.role === "user")?.content
  const latestUserText =
    typeof latestUserContent === "string"
      ? latestUserContent
      : JSON.stringify(latestUserContent ?? "")
  const exposePersistentCoordination =
    PERSISTENT_COORDINATION_REQUEST.test(latestUserText)
  const exposeSubagent = SUBAGENT_REQUEST.test(latestUserText)
  const exposeWebTools = WEB_TOOL_REQUEST.test(latestUserText)
  const exposeContextSearch = CONTEXT_SEARCH_REQUEST.test(latestUserText)

  return input.tools.filter((tool) => {
    const name = tool.function.name
    if (!input.projectId && name.startsWith("project_")) return false
    if (
      ["goal_write", "plan_write", "todo_write"].includes(name) &&
      !exposePersistentCoordination
    ) {
      return false
    }
    if (name === "subagent" && !exposeSubagent) return false
    if (["web_fetch", "web_search"].includes(name) && !exposeWebTools) {
      return false
    }
    if (
      ["memory_search", "session_event_search"].includes(name) &&
      !exposeContextSearch
    ) {
      return false
    }
    return true
  })
}

function resolvedHarnessModelLabel(
  requestedModel: string,
  routing: HarnessModelResult["routing"],
): string {
  if (!routing || requestedModel !== "auto") return requestedModel
  const tier = routing.tier
    ? `${routing.tier.charAt(0).toUpperCase()}${routing.tier.slice(1)}`
    : "Auto"
  return `Auto · ${tier} (${routing.providerId}/${routing.modelId})`
}

export function abortActiveHarnessRun(runId: string): void {
  for (const controller of activeRunExecutions.get(runId) ?? []) controller.abort("Harness run cancelled")
  for (const controller of activeToolExecutions.get(runId) ?? []) controller.abort("Harness run cancelled")
}

export type ModelDispatcher = (input: {
  assistantMessageId: string
  body: Record<string, unknown>
  signal: AbortSignal
}) => Promise<Response>

export function limitHarnessToolCalls(calls: HarnessToolCall[]): {
  accepted: HarnessToolCall[]
  rejected: HarnessToolCall[]
} {
  return { accepted: calls.slice(0, MAX_TOOL_CALLS_PER_STEP), rejected: calls.slice(MAX_TOOL_CALLS_PER_STEP) }
}

type RunHarnessInput = {
  dispatchModel: ModelDispatcher
  initialMessages?: ModelMessage[]
  onEvent: (event: HarnessEvent) => void | Promise<void>
  runId: string
  leaseToken: string
  signal: AbortSignal
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return toHarnessJson(value)
}

async function emit(
  input: Omit<Parameters<typeof appendHarnessEvent>[0], "runId"> & { runId: string },
  onEvent: RunHarnessInput["onEvent"],
  leaseToken?: string,
): Promise<HarnessEvent> {
  if (leaseToken) await renewRunLease(input.runId, leaseToken)
  const event = await appendHarnessEvent(input)
  await onEvent(event)
  return event
}

async function renewRunLease(runId: string, leaseToken: string): Promise<void> {
  const renewed = await prisma.agentRun.updateMany({
    where: { id: runId, leaseToken, status: "running" },
    data: { leaseExpiresAt: new Date(Date.now() + RUN_LEASE_MS) },
  })
  if (renewed.count !== 1) throw new HarnessLeaseLostError()
}

export function createRunLeaseHeartbeat(input: {
  intervalMs?: number
  parentSignal: AbortSignal
  renew: () => Promise<void>
}) {
  const leaseController = new AbortController()
  const signal = AbortSignal.any([input.parentSignal, leaseController.signal])
  let inFlight: Promise<void> | null = null
  let leaseLost = false
  let stopped = false

  const tick = () => {
    if (stopped || inFlight) return
    inFlight = input.renew()
      .catch((error) => {
        if (error instanceof HarnessLeaseLostError) {
          leaseLost = true
          leaseController.abort(error)
        }
      })
      .finally(() => {
        inFlight = null
      })
  }
  const timer = setInterval(tick, input.intervalMs ?? RUN_LEASE_HEARTBEAT_MS)
  timer.unref?.()

  return {
    controller: leaseController,
    get leaseLost() {
      return leaseLost
    },
    signal,
    async stop() {
      stopped = true
      clearInterval(timer)
      await inFlight
    },
  }
}

async function setRunStatus(
  runId: string,
  leaseToken: string,
  status: HarnessRunStatus,
  error?: string,
): Promise<boolean> {
  const updated = await prisma.agentRun.updateMany({
    where: { id: runId, leaseToken, status: "running" },
    data: {
      error: error?.slice(0, 4_000) ?? null,
      leaseExpiresAt: status === "running" ? new Date(Date.now() + RUN_LEASE_MS) : null,
      leaseToken: status === "running" ? undefined : null,
      status,
    },
  })
  return updated.count === 1
}

export type HarnessRunLease = { token: string; version: number }

export async function acquireRunLease(runId: string, userId: string): Promise<HarnessRunLease | null> {
  const token = crypto.randomUUID()
  const acquired = await prisma.agentRun.updateMany({
    where: {
      id: runId,
      userId,
      status: { in: ["queued", "yielded", "running"] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    },
    data: {
      leaseExpiresAt: new Date(Date.now() + RUN_LEASE_MS),
      leaseToken: token,
      leaseVersion: { increment: 1 },
      status: "running",
    },
  })
  if (acquired.count !== 1) return null
  const run = await prisma.agentRun.findFirst({ where: { id: runId, leaseToken: token }, select: { leaseVersion: true } })
  return run ? { token, version: run.leaseVersion } : null
}

export async function createHarnessRegistry(
  userId: string,
  signal: AbortSignal,
  options: { discoverMcp?: boolean } = {},
): Promise<HarnessRegistry> {
  const registry = new HarnessRegistry()
  const configs = await prisma.harnessPluginConfig.findMany({
    where: { userId },
    select: { enabled: true, pluginId: true },
  })
  const enabled = new Map(configs.map((config) => [config.pluginId, config.enabled]))
  if (enabled.get(coreHarnessPlugin.id) !== false) registry.mount(coreHarnessPlugin)
  if (enabled.get("modelhub.mcp-remote") !== false) {
    registry.mount(
      await createMcpPlugin(userId, signal, options.discoverMcp !== false),
    )
  }
  return registry
}

function resolvedRisk(tool: HarnessToolDefinition, args: Record<string, unknown>) {
  return typeof tool.risk === "function" ? tool.risk(args) : tool.risk
}

async function createApproval(input: {
  args: Record<string, unknown>
  conversationId: string
  onEvent: RunHarnessInput["onEvent"]
  risk: "reversible-write" | "external-write" | "destructive"
  runId: string
  leaseToken: string
  stepNumber: number
  toolCallId: string
  toolName: string
  userId: string
}): Promise<void> {
  const approval = await prisma.toolApproval.upsert({
    where: { runId_toolCallId: { runId: input.runId, toolCallId: input.toolCallId } },
    create: {
      args: asJson(input.args),
      reason:
        input.risk === "destructive"
          ? "This tool can delete or irreversibly change data."
          : input.risk === "external-write"
            ? "This tool can mutate an external system or expose data outside ModelHub."
            : "This tool changes durable ModelHub state or consumes a delegated model call.",
      risk: input.risk,
      runId: input.runId,
      operationKey: `tool:${input.runId}:${input.toolCallId}`,
      stepNumber: input.stepNumber,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      userId: input.userId,
    },
    update: {},
  })
  await emit(
    {
      conversationId: input.conversationId,
      payload: {
        approvalId: approval.id,
        args: input.args,
        reason: approval.reason,
        risk: input.risk,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
      },
      runId: input.runId,
      type: "tool/approval-required",
    },
    input.onEvent,
    input.leaseToken,
  )
}

async function executeTool(input: {
  call: HarnessToolCall
  conversationId: string
  dispatchModel: ModelDispatcher
  model: string
  onEvent: RunHarnessInput["onEvent"]
  projectId: string | null
  registry: HarnessRegistry
  runId: string
  leaseToken: string
  stepNumber: number
  signal: AbortSignal
  userId: string
}): Promise<{ approved: boolean; result?: unknown }> {
  await renewRunLease(input.runId, input.leaseToken)
  const tool = input.registry.getTool(input.call.toolName)
  await emit(
    {
      conversationId: input.conversationId,
      payload: input.call,
      runId: input.runId,
      type: "tool/call",
    },
    input.onEvent,
    input.leaseToken,
  )
  if (!tool) {
    const result = { error: `Unknown or unavailable tool: ${input.call.toolName}` }
    await emit({ conversationId: input.conversationId, payload: { ...input.call, result }, runId: input.runId, type: "tool/result" }, input.onEvent, input.leaseToken)
    return { approved: true, result }
  }

  const risk = resolvedRisk(tool, input.call.args)
  if (risk !== "read") {
    await createApproval({
      args: input.call.args,
      conversationId: input.conversationId,
      onEvent: input.onEvent,
      risk,
      runId: input.runId,
      leaseToken: input.leaseToken,
      stepNumber: input.stepNumber,
      toolCallId: input.call.toolCallId,
      toolName: input.call.toolName,
      userId: input.userId,
    })
    return { approved: false }
  }

  try {
    const result = await input.registry.executeTool(tool.name, input.call.args, {
      conversationId: input.conversationId,
      projectId: input.projectId,
      runId: input.runId,
      operationId: `tool:${input.runId}:${input.call.toolCallId}`,
      signal: input.signal,
      userId: input.userId,
      async invokeModel(prompt) {
        const parent = await prisma.agentRun.findUnique({
          where: { id: input.runId },
          select: { maxSubagentDepth: true, subagentDepth: true },
        })
        if (!parent || parent.subagentDepth >= parent.maxSubagentDepth) {
          throw new Error("Maximum subagent depth reached")
        }
        const childCount = await prisma.agentRun.count({ where: { parentRunId: input.runId } })
        if (childCount >= MAX_SUBAGENTS_PER_RUN) throw new Error("Maximum subagents per run reached")
        const child = await prisma.agentRun.create({
          data: {
            conversationId: input.conversationId,
            maxSteps: 1,
            maxSubagentDepth: parent.maxSubagentDepth,
            modelId: input.model,
            parentRunId: input.runId,
            status: "running",
            subagentDepth: parent.subagentDepth + 1,
            userId: input.userId,
          },
        })
        try {
          const response = await input.dispatchModel({
            assistantMessageId: crypto.randomUUID(),
            body: {
              messages: [
                {
                  content:
                    "You are a bounded subagent. Complete only the delegated objective and return a concise report with evidence and uncertainties.",
                  role: "system",
                },
                { content: prompt, role: "user" },
              ],
              model: input.model,
              stream: true,
            },
            signal: input.signal,
          })
          const text = (await consumeHarnessModelResponse(response)).text
          await prisma.agentRun.update({
            where: { id: child.id },
            data: { status: "completed", stepCount: 1 },
          })
          return text
        } catch (error) {
          await prisma.agentRun.update({
            where: { id: child.id },
            data: {
              error: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
              status: input.signal.aborted ? "cancelled" : "failed",
            },
          })
          throw error
        }
      },
    })
    const normalizedResult = toHarnessJson(result)
    await emit({ conversationId: input.conversationId, payload: { ...input.call, result: normalizedResult }, runId: input.runId, type: "tool/result" }, input.onEvent, input.leaseToken)
    return { approved: true, result: normalizedResult }
  } catch (error) {
    const result = { error: error instanceof Error ? error.message : String(error) }
    await emit({ conversationId: input.conversationId, payload: { ...input.call, result }, runId: input.runId, type: "tool/result" }, input.onEvent, input.leaseToken)
    return { approved: true, result }
  }
}

async function persistAssistantProjection(input: {
  content: string
  conversationId: string
  id: string
  model: string
  toolCalls: Array<Record<string, unknown>>
}): Promise<void> {
  const data = {
      content: input.content,
      conversationId: input.conversationId,
      id: input.id,
      parts: asJson([
        ...(input.content ? [{ text: input.content, type: "text" }] : []),
        { toolCalls: input.toolCalls, type: "harness" },
        { modelLabel: input.model, type: "meta" },
      ]),
      role: "assistant",
  } as const
  await prisma.message.upsert({
    where: { id: input.id },
    create: data,
    update: { parts: data.parts },
  })
  await prisma.conversation.update({ where: { id: input.conversationId }, data: {} })
}

async function completeAssistantRun(input: {
  assistantMessageId: string
  content: string
  conversationId: string
  finishReason: string | null
  leaseToken: string
  model: string
  onEvent: RunHarnessInput["onEvent"]
  runId: string
  stepId: string
  stepNumber: number
  toolCalls: Array<Record<string, unknown>>
  turnId: string
}): Promise<void> {
  const events = await prisma.$transaction(async (tx) => {
    const advanced = await tx.agentRun.updateMany({
      where: { id: input.runId, leaseToken: input.leaseToken, status: "running" },
      data: {
        leaseExpiresAt: null,
        leaseToken: null,
        status: "completed",
        stepCount: input.stepNumber,
      },
    })
    if (advanced.count !== 1) throw new HarnessLeaseLostError()

    const assistantEvent = await tx.sessionEvent.create({
      data: {
        conversationId: input.conversationId,
        id: `evt_${input.assistantMessageId}`,
        payload: asJson({
          content: input.content,
          finishReason: input.finishReason,
          messageId: input.assistantMessageId,
          modelLabel: input.model,
          toolCalls: [],
        }),
        runId: input.runId,
        stepId: input.stepId,
        turnId: input.turnId,
        type: "assistant/message",
      },
    })
    const parts = asJson([
      ...(input.content ? [{ text: input.content, type: "text" }] : []),
      { toolCalls: input.toolCalls, type: "harness" },
      { modelLabel: input.model, type: "meta" },
    ])
    await tx.message.upsert({
      where: { id: input.assistantMessageId },
      create: {
        content: input.content,
        conversationId: input.conversationId,
        id: input.assistantMessageId,
        parts,
        role: "assistant",
      },
      update: { content: input.content, parts },
    })
    await tx.conversation.update({ where: { id: input.conversationId }, data: {} })
    const stepEnd = await tx.sessionEvent.create({
      data: {
        conversationId: input.conversationId,
        payload: asJson({ finishReason: input.finishReason, stepNumber: input.stepNumber }),
        runId: input.runId,
        stepId: input.stepId,
        turnId: input.turnId,
        type: "step/end",
      },
    })
    const turnEnd = await tx.sessionEvent.create({
      data: {
        conversationId: input.conversationId,
        payload: asJson({ reason: "completed" }),
        runId: input.runId,
        turnId: input.turnId,
        type: "turn/end",
      },
    })
    return [assistantEvent, stepEnd, turnEnd]
  })
  for (const event of events) await input.onEvent(serializeHarnessEvent(event))
}

async function projectedToolCalls(runId: string): Promise<Array<Record<string, unknown>>> {
  const events = await prisma.sessionEvent.findMany({
    where: {
      runId,
      type: { in: ["tool/call", "tool/result", "tool/approval-required"] },
    },
    orderBy: { seq: "asc" },
    select: { payload: true, type: true },
  })
  const calls = new Map<string, Record<string, unknown>>()
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>
    const toolCallId = String(payload.toolCallId ?? "")
    if (!toolCallId) continue
    const current = calls.get(toolCallId) ?? {
      args: payload.args ?? {},
      status: "running",
      toolCallId,
      toolName: String(payload.toolName ?? "unknown_tool"),
    }
    if (event.type === "tool/approval-required") {
      current.approvalId = payload.approvalId
      current.requiresApproval = true
      current.status = "pending-approval"
    } else if (event.type === "tool/result") {
      current.result = payload.result ?? null
      current.status = "completed"
    }
    calls.set(toolCallId, current)
  }
  return [...calls.values()]
}

async function unresolvedToolCalls(runId: string): Promise<{ assistantMessageId: string; calls: HarnessToolCall[] } | null> {
  const events = await prisma.sessionEvent.findMany({
    where: { runId, type: { in: ["assistant/message", "tool/result"] } },
    orderBy: { seq: "asc" },
    select: { payload: true, type: true },
  })
  const pending = new Map<string, HarnessToolCall>()
  let assistantMessageId = ""
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>
    if (event.type === "assistant/message" && Array.isArray(payload.toolCalls)) {
      assistantMessageId = String(payload.messageId ?? assistantMessageId)
      for (const value of payload.toolCalls) {
        const call = value as Record<string, unknown>
        const toolCallId = String(call.toolCallId ?? "")
        if (!toolCallId) continue
        pending.set(toolCallId, {
          args: call.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args as Record<string, unknown> : {},
          toolCallId,
          toolName: String(call.toolName ?? "unknown_tool"),
        })
      }
    } else if (event.type === "tool/result") {
      pending.delete(String(payload.toolCallId ?? ""))
    }
  }
  return pending.size > 0 && assistantMessageId ? { assistantMessageId, calls: [...pending.values()] } : null
}

async function interruptedAssistantStep(runId: string): Promise<{ content: string } | null> {
  const lastStart = await prisma.sessionEvent.findFirst({
    where: { runId, type: "step/start" },
    orderBy: { seq: "desc" },
    select: { stepId: true },
  })
  if (!lastStart?.stepId) return null

  const completedStep = await prisma.sessionEvent.findFirst({
    where: { runId, stepId: lastStart.stepId, type: "step/end" },
    select: { seq: true },
  })
  if (completedStep) return null

  const events = await prisma.sessionEvent.findMany({
    where: {
      runId,
      stepId: lastStart.stepId,
      type: { in: ["assistant/chunk", "assistant/message"] },
    },
    orderBy: { seq: "asc" },
    select: { payload: true, type: true },
  })
  if (events.some((event) => event.type === "assistant/message")) {
    return { content: "" }
  }

  const content = events
    .filter((event) => event.type === "assistant/chunk")
    .flatMap((event) => {
      const deltas = (event.payload as Record<string, unknown>).deltas
      return Array.isArray(deltas)
        ? deltas.filter((delta): delta is string => typeof delta === "string")
        : []
    })
    .join("")
  return content ? { content } : null
}

export async function refreshRunToolProjection(runId: string): Promise<void> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { conversationId: true, modelId: true } })
  if (!run) return
  const assistantEvent = await prisma.sessionEvent.findFirst({
    where: { runId, type: "assistant/message" },
    orderBy: { seq: "desc" },
    select: { payload: true },
  })
  const assistantMessageId = (assistantEvent?.payload as Record<string, unknown> | undefined)?.messageId
  if (typeof assistantMessageId !== "string") return
  const message = await prisma.message.findUnique({ where: { id: assistantMessageId }, select: { content: true } })
  if (!message) return
  await prisma.message.update({
    where: { id: assistantMessageId },
    data: {
      parts: toHarnessJson([
        ...(message.content ? [{ text: message.content, type: "text" }] : []),
        { toolCalls: await projectedToolCalls(runId), type: "harness" },
        { modelLabel: run.modelId ?? "auto", type: "meta" },
      ]),
    },
  })
}

export async function runHarness(input: RunHarnessInput): Promise<HarnessRunStatus> {
  const run = await prisma.agentRun.findUnique({
    where: { id: input.runId },
    include: { conversation: { select: { id: true, projectId: true } } },
  })
  if (!run) throw new Error("Agent run not found")
  const startedAt = Date.now()
  let turnId = crypto.randomUUID()
  await renewRunLease(run.id, input.leaseToken)
  const heartbeat = createRunLeaseHeartbeat({
    parentSignal: input.signal,
    renew: () => renewRunLease(run.id, input.leaseToken),
  })
  const runControllers = activeRunExecutions.get(run.id) ?? new Set<AbortController>()
  runControllers.add(heartbeat.controller)
  activeRunExecutions.set(run.id, runControllers)
  let registry: HarnessRegistry

  try {
    registry = await createHarnessRegistry(run.userId, heartbeat.signal)
  } catch (error) {
    await heartbeat.stop()
    runControllers.delete(heartbeat.controller)
    if (runControllers.size === 0) activeRunExecutions.delete(run.id)
    throw error
  }

  try {
    await ensureLegacyMessageEvents(run.conversationId)
    const existingTurn = await prisma.sessionEvent.findFirst({ where: { runId: run.id, type: "turn/start" } })
    turnId = existingTurn?.turnId ?? turnId
    if (!existingTurn) {
      await emit({ conversationId: run.conversationId, payload: {}, runId: run.id, turnId, type: "turn/start" }, input.onEvent, input.leaseToken)
      await emit(
        {
          conversationId: run.conversationId,
          payload: { status: "running" },
          runId: run.id,
          turnId,
          type: "run/status",
        },
        input.onEvent,
        input.leaseToken,
      )
    }

    let messages = input.initialMessages?.length ? input.initialMessages : await deriveMessagesFromEvents(run.conversationId)
    const interruptedStep = input.initialMessages?.length
      ? null
      : await interruptedAssistantStep(run.id)
    if (interruptedStep) {
      if (interruptedStep.content) {
        messages.push({ content: interruptedStep.content, role: "assistant" })
      }
      messages.push({
        content:
          "The previous worker stopped during an assistant response. Continue exactly where it stopped without repeating completed content, then finish the original request.",
        role: "system",
      })
    }
    const systemPrompt = await buildHarnessSystemPrompt({ projectId: run.conversation.projectId, registry, userId: run.userId })
    let currentStepCount = run.stepCount
    let outputLimitContinuations = 0
    const unresolved = await unresolvedToolCalls(run.id)
    if (unresolved) {
      const stepNumber = currentStepCount + 1
      const stepId = crypto.randomUUID()
      await emit({ conversationId: run.conversationId, payload: { resumed: true, stepNumber }, runId: run.id, stepId, turnId, type: "step/start" }, input.onEvent, input.leaseToken)
      const recovered = await Promise.all(unresolved.calls.slice(0, MAX_TOOL_CALLS_PER_STEP).map((call) => executeTool({
        call,
        conversationId: run.conversationId,
        dispatchModel: input.dispatchModel,
        leaseToken: input.leaseToken,
        model: run.modelId ?? "auto",
        onEvent: input.onEvent,
        projectId: run.conversation.projectId,
        registry,
        runId: run.id,
        signal: heartbeat.signal,
        stepNumber,
        userId: run.userId,
      })))
      if (recovered.some((item) => !item.approved)) {
        await persistAssistantProjection({
          content: "",
          conversationId: run.conversationId,
          id: unresolved.assistantMessageId,
          model: run.modelId ?? "auto",
          toolCalls: await projectedToolCalls(run.id),
        })
        await emit({ conversationId: run.conversationId, payload: { finishReason: "waiting-approval", resumed: true, stepNumber }, runId: run.id, stepId, turnId, type: "step/end" }, input.onEvent, input.leaseToken)
        await setRunStatus(run.id, input.leaseToken, "waiting_approval")
        return "waiting_approval"
      }
      currentStepCount = stepNumber
      const advanced = await prisma.agentRun.updateMany({
        where: { id: run.id, leaseToken: input.leaseToken, status: "running" },
        data: { stepCount: stepNumber, leaseExpiresAt: new Date(Date.now() + RUN_LEASE_MS) },
      })
      if (advanced.count !== 1) throw new HarnessLeaseLostError()
      await emit({ conversationId: run.conversationId, payload: { finishReason: "recovered-tools", resumed: true, stepNumber }, runId: run.id, stepId, turnId, type: "step/end" }, input.onEvent, input.leaseToken)
      messages = await deriveMessagesFromEvents(run.conversationId)
    }

    for (let stepNumber = currentStepCount + 1; stepNumber <= run.maxSteps; stepNumber++) {
      if (heartbeat.signal.aborted) {
        await setRunStatus(run.id, input.leaseToken, "cancelled")
        return "cancelled"
      }
      if (Date.now() - startedAt >= EXECUTION_SLICE_MS) {
        await emit({ conversationId: run.conversationId, payload: { reason: "function-slice", stepNumber }, runId: run.id, turnId, type: "run/yielded" }, input.onEvent, input.leaseToken)
        await setRunStatus(run.id, input.leaseToken, "yielded")
        return "yielded"
      }

      const stepId = crypto.randomUUID()
      await emit({ conversationId: run.conversationId, payload: { stepNumber }, runId: run.id, stepId, turnId, type: "step/start" }, input.onEvent, input.leaseToken)
      const compacted = compactModelMessages(messages)
      messages = compacted.messages
      if (compacted.compacted) {
        await emit({ conversationId: run.conversationId, payload: { summary: compacted.summary }, runId: run.id, stepId, turnId, type: "compaction/summary" }, input.onEvent, input.leaseToken)
      }

      const assistantMessageId = crypto.randomUUID()
      await renewRunLease(run.id, input.leaseToken)
      const response = await input.dispatchModel({
        assistantMessageId,
        body: {
          messages: [{ content: systemPrompt, role: "system" }, ...messages],
          model: run.modelId ?? "auto",
          stream: true,
          tool_choice: "auto",
          tools: selectHarnessToolSchemas({
            messages,
            projectId: run.conversation.projectId,
            tools: registry.openAiSchemas(),
          }),
        },
        signal: heartbeat.signal,
      })
      let chunkIndex = 0
      let durableChunks: string[] = []
      const flushDurableChunks = async () => {
        if (durableChunks.length === 0) return
        const deltas = durableChunks
        durableChunks = []
        await emit(
          { conversationId: run.conversationId, payload: { deltas, live: false }, runId: run.id, stepId, turnId, type: "assistant/chunk" },
          input.onEvent,
          input.leaseToken,
        )
      }
      const result = await consumeHarnessModelResponse(response, async (delta) => {
        chunkIndex += 1
        durableChunks.push(delta)
        await input.onEvent({
          conversationId: run.conversationId,
          createdAt: new Date().toISOString(),
          eventId: `live_${run.id}_${stepNumber}_${chunkIndex}`,
          payload: { delta, live: true },
          runId: run.id,
          seq: "0",
          stepId,
          turnId,
          type: "assistant/chunk",
        })
        if (durableChunks.length >= 32) await flushDurableChunks()
      })
      await flushDurableChunks()
      await renewRunLease(run.id, input.leaseToken)
      const resultModelLabel = resolvedHarnessModelLabel(
        run.modelId ?? "auto",
        result.routing,
      )
      if (result.toolCalls.length === 0) {
        if (
          isModelOutputLimitFinishReason(result.finishReason) &&
          outputLimitContinuations < MAX_OUTPUT_LIMIT_CONTINUATIONS &&
          stepNumber < run.maxSteps
        ) {
          outputLimitContinuations += 1
          await emit(
            {
              conversationId: run.conversationId,
              payload: {
                content: result.text,
                continuationRequired: true,
                finishReason: result.finishReason,
                messageId: assistantMessageId,
                modelLabel: resultModelLabel,
                toolCalls: [],
              },
              runId: run.id,
              stepId,
              turnId,
              type: "assistant/message",
            },
            input.onEvent,
            input.leaseToken,
          )
          messages.push({ content: result.text, role: "assistant" })
          messages.push({
            content:
              "Continue exactly from the last emitted character. Do not repeat completed content. Finish every section, numbered round, and deliverable required by the original user request.",
            role: "system",
          })
          await emit(
            {
              conversationId: run.conversationId,
              payload: {
                finishReason: result.finishReason,
                outputLimitContinuation: outputLimitContinuations,
                stepNumber,
              },
              runId: run.id,
              stepId,
              turnId,
              type: "step/end",
            },
            input.onEvent,
            input.leaseToken,
          )
          const advanced = await prisma.agentRun.updateMany({
            where: { id: run.id, leaseToken: input.leaseToken, status: "running" },
            data: {
              leaseExpiresAt: new Date(Date.now() + RUN_LEASE_MS),
              stepCount: stepNumber,
            },
          })
          if (advanced.count !== 1) throw new HarnessLeaseLostError()
          continue
        }
        const missingSections = missingExplicitIterativeSections(
          messages,
          result.text,
        )
        if (missingSections.length > 0) {
          await emit(
            {
              conversationId: run.conversationId,
              payload: {
                content: result.text,
                continuationRequired: true,
                finishReason: "format-incomplete",
                messageId: assistantMessageId,
                missingSections,
                modelLabel: resultModelLabel,
                toolCalls: [],
              },
              runId: run.id,
              stepId,
              turnId,
              type: "assistant/message",
            },
            input.onEvent,
            input.leaseToken,
          )
          messages.push({ content: result.text, role: "assistant" })
          messages.push({
            content: `Your response stopped before satisfying the user's explicit iterative format. Continue without repeating completed content. Emit every missing section using these exact headings, in order:\n${missingSections.join("\n")}`,
            role: "system",
          })
          await emit(
            {
              conversationId: run.conversationId,
              payload: {
                finishReason: "format-incomplete",
                missingSections,
                stepNumber,
              },
              runId: run.id,
              stepId,
              turnId,
              type: "step/end",
            },
            input.onEvent,
            input.leaseToken,
          )
          const advanced = await prisma.agentRun.updateMany({
            where: {
              id: run.id,
              leaseToken: input.leaseToken,
              status: "running",
            },
            data: {
              leaseExpiresAt: new Date(Date.now() + RUN_LEASE_MS),
              stepCount: stepNumber,
            },
          })
          if (advanced.count !== 1) throw new HarnessLeaseLostError()
          continue
        }
        await completeAssistantRun({
          assistantMessageId,
          content: result.text,
          conversationId: run.conversationId,
          finishReason: result.finishReason,
          leaseToken: input.leaseToken,
          model: resultModelLabel,
          onEvent: input.onEvent,
          runId: run.id,
          stepId,
          stepNumber,
          toolCalls: await projectedToolCalls(run.id),
          turnId,
        })
        return "completed"
      }
      await emit(
        {
          conversationId: run.conversationId,
          payload: { content: result.text, finishReason: result.finishReason, messageId: assistantMessageId, toolCalls: result.toolCalls },
          runId: run.id,
          stepId,
          turnId,
          type: "assistant/message",
        },
        input.onEvent,
        input.leaseToken,
      )
      messages.push({
        content: result.text,
        role: "assistant",
        ...(result.toolCalls.length
          ? {
              tool_calls: result.toolCalls.map((call) => ({
                function: { arguments: JSON.stringify(call.args), name: call.toolName },
                id: call.toolCallId,
                type: "function" as const,
              })),
            }
          : {}),
      })

      const { accepted: acceptedCalls, rejected: rejectedCalls } = limitHarnessToolCalls(result.toolCalls)
      const parallel = acceptedCalls.filter((call) => registry.getTool(call.toolName)?.executionMode === "parallel-safe")
      const sequential = acceptedCalls.filter((call) => !parallel.includes(call))
      const execute = (call: HarnessToolCall) => executeTool({
        call,
        conversationId: run.conversationId,
        dispatchModel: input.dispatchModel,
        model: run.modelId ?? "auto",
        onEvent: input.onEvent,
        projectId: run.conversation.projectId,
        registry,
        runId: run.id,
        leaseToken: input.leaseToken,
        stepNumber,
        signal: heartbeat.signal,
        userId: run.userId,
      })
      const results = new Map<string, Awaited<ReturnType<typeof execute>>>()
      for (const call of rejectedCalls) {
        const rejected = { error: `Tool call limit exceeded (${MAX_TOOL_CALLS_PER_STEP} per step)` }
        await emit({ conversationId: run.conversationId, payload: call, runId: run.id, stepId, turnId, type: "tool/call" }, input.onEvent, input.leaseToken)
        await emit({ conversationId: run.conversationId, payload: { ...call, result: rejected }, runId: run.id, stepId, turnId, type: "tool/result" }, input.onEvent, input.leaseToken)
        results.set(call.toolCallId, { approved: true, result: rejected })
      }
      const parallelResults = await Promise.all(parallel.map(async (call) => ({ call, result: await execute(call) })))
      for (const item of parallelResults) results.set(item.call.toolCallId, item.result)
      for (const call of sequential) results.set(call.toolCallId, await execute(call))
      if ([...results.values()].some((item) => !item.approved)) {
        await emit(
          {
            conversationId: run.conversationId,
            payload: { finishReason: "waiting-approval", stepNumber },
            runId: run.id,
            stepId,
            turnId,
            type: "step/end",
          },
          input.onEvent,
          input.leaseToken,
        )
        await persistAssistantProjection({
          content: result.text,
          conversationId: run.conversationId,
          id: assistantMessageId,
          model: resultModelLabel,
          toolCalls: await projectedToolCalls(run.id),
        })
        await setRunStatus(run.id, input.leaseToken, "waiting_approval")
        return "waiting_approval"
      }
      for (const call of result.toolCalls) {
        messages.push({ content: JSON.stringify(results.get(call.toolCallId)?.result ?? null), role: "tool", tool_call_id: call.toolCallId })
      }
      await emit({ conversationId: run.conversationId, payload: { finishReason: "tool-calls", stepNumber }, runId: run.id, stepId, turnId, type: "step/end" }, input.onEvent, input.leaseToken)
      const advanced = await prisma.agentRun.updateMany({
        where: { id: run.id, leaseToken: input.leaseToken, status: "running" },
        data: { stepCount: stepNumber, leaseExpiresAt: new Date(Date.now() + RUN_LEASE_MS) },
      })
      if (advanced.count !== 1) throw new HarnessLeaseLostError()
    }

    const message = `Maximum step budget (${run.maxSteps}) exhausted`
    await emit({ conversationId: run.conversationId, payload: { message, reason: "max-steps" }, runId: run.id, turnId, type: "run/error" }, input.onEvent, input.leaseToken)
    await emit({ conversationId: run.conversationId, payload: { reason: "max-steps" }, runId: run.id, turnId, type: "turn/end" }, input.onEvent, input.leaseToken)
    await setRunStatus(run.id, input.leaseToken, "failed", message)
    return "failed"
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      error instanceof HarnessLeaseLostError ||
      heartbeat.leaseLost ||
      (heartbeat.controller.signal.aborted && !input.signal.aborted)
    ) {
      const current = await prisma.agentRun.findUnique({ where: { id: run.id }, select: { status: true } })
      return (current?.status ?? "failed") as HarnessRunStatus
    }
    if (input.signal.aborted) {
      await setRunStatus(run.id, input.leaseToken, "cancelled", message)
      return "cancelled"
    }
    await emit({ conversationId: run.conversationId, payload: { message }, runId: run.id, turnId, type: "run/error" }, input.onEvent, input.leaseToken).catch(() => undefined)
    await setRunStatus(run.id, input.leaseToken, "failed", message)
    return "failed"
  } finally {
    await heartbeat.stop()
    runControllers.delete(heartbeat.controller)
    if (runControllers.size === 0) activeRunExecutions.delete(run.id)
    registry.dispose()
  }
}

export async function executeApprovedTool(input: {
  approvalId: string
  decision: "approved" | "denied"
  response?: Record<string, unknown>
  signal: AbortSignal
  userId: string
}): Promise<{ result: unknown; runId: string; status: HarnessRunStatus }> {
  const approval = await prisma.toolApproval.findFirst({
    where: { id: input.approvalId, userId: input.userId },
    include: { run: { include: { conversation: { select: { projectId: true } } } } },
  })
  if (!approval) throw new Error("Approval not found")
  if (["approved", "denied", "failed", "cancelled", "unknown"].includes(approval.status)) {
    const currentRun = await prisma.agentRun.findUnique({ where: { id: approval.runId }, select: { status: true } })
    return {
      result: approval.result ?? { decision: approval.decision },
      runId: approval.runId,
      status: (currentRun?.status ?? "failed") as HarnessRunStatus,
    }
  }
  if (approval.status === "executing") {
    if (approval.executionExpiresAt && approval.executionExpiresAt > new Date()) {
      throw new Error("Approval is already being executed")
    }
    const unknownResult = toHarnessJson({
      error: "The previous tool execution expired with an unknown external outcome and was not retried",
      operationKey: approval.operationKey,
      unknown: true,
    })
    const remaining = await prisma.$transaction(async (tx) => {
      const recovered = await tx.toolApproval.updateMany({
        where: { id: approval.id, status: "executing" },
        data: { executionExpiresAt: null, resolvedAt: new Date(), result: unknownResult, status: "unknown" },
      })
      if (recovered.count !== 1) throw new Error("Approval recovery lost its claim")
      await tx.sessionEvent.create({
        data: {
          conversationId: approval.run.conversationId,
          payload: toHarnessJson({ result: unknownResult, toolCallId: approval.toolCallId, toolName: approval.toolName }),
          runId: approval.runId,
          type: "tool/result",
        },
      })
      return tx.toolApproval.count({ where: { runId: approval.runId, status: { in: ["pending", "executing"] } } })
    })
    if (remaining === 0) {
      await prisma.agentRun.updateMany({
        where: { id: approval.runId, status: "waiting_approval" },
        data: { status: "yielded", stepCount: approval.stepNumber },
      })
    }
    await refreshRunToolProjection(approval.runId)
    return { result: unknownResult, runId: approval.runId, status: remaining === 0 ? "yielded" : "waiting_approval" }
  }
  const executionToken = crypto.randomUUID()
  const claimed = await prisma.toolApproval.updateMany({
    where: {
      id: approval.id,
      status: "pending",
      userId: input.userId,
      run: { status: "waiting_approval" },
    },
    data: {
      attemptCount: { increment: 1 },
      decision: input.decision,
      executionExpiresAt: new Date(Date.now() + APPROVAL_EXECUTION_MS),
      executionStartedAt: new Date(),
      executionToken,
      response: asJson(input.response ?? {}),
      status: "executing",
    },
  })
  if (claimed.count !== 1) throw new Error("Approval is no longer pending on an active approval run")

  let result: unknown = { denied: true, reason: input.response?.reason ?? "Denied by user" }
  let finalStatus: "approved" | "denied" | "failed" = input.decision
  const executionController = new AbortController()
  const abortExecution = () => executionController.abort(input.signal.reason)
  input.signal.addEventListener("abort", abortExecution, { once: true })
  const activeForRun = activeToolExecutions.get(approval.runId) ?? new Set<AbortController>()
  activeForRun.add(executionController)
  activeToolExecutions.set(approval.runId, activeForRun)
  try {
    if (input.decision === "approved") {
      const liveRun = await prisma.agentRun.findFirst({
        where: { id: approval.runId, status: "waiting_approval" },
        select: { id: true },
      })
      if (!liveRun) throw new Error("Run is no longer awaiting approval")
      const registry = await createHarnessRegistry(input.userId, executionController.signal)
      try {
      const tool = registry.getTool(approval.toolName)
      if (!tool) throw new Error(`Tool is no longer available: ${approval.toolName}`)
      result = await registry.executeTool(tool.name, approval.args as Record<string, unknown>, {
        conversationId: approval.run.conversationId,
        operationId: approval.operationKey,
        projectId: approval.run.conversation.projectId,
        runId: approval.runId,
        signal: executionController.signal,
        userId: input.userId,
      })
      } finally {
        registry.dispose()
      }
    }
  } catch (error) {
    finalStatus = "failed"
    result = { error: error instanceof Error ? error.message : String(error) }
  } finally {
    input.signal.removeEventListener("abort", abortExecution)
    activeForRun.delete(executionController)
    if (activeForRun.size === 0) activeToolExecutions.delete(approval.runId)
  }

  const persistedResult = toHarnessJson(result)
  const remaining = await prisma.$transaction(async (tx) => {
    const resolved = await tx.toolApproval.updateMany({
      where: { executionToken, id: approval.id, status: "executing", run: { status: "waiting_approval" } },
      data: { executionExpiresAt: null, resolvedAt: new Date(), result: persistedResult, status: finalStatus },
    })
    if (resolved.count !== 1) throw new Error("Approval execution lost its claim")
    await tx.sessionEvent.create({
      data: {
        conversationId: approval.run.conversationId,
        payload: toHarnessJson({
          decision: input.decision,
          operationKey: approval.operationKey,
          result: persistedResult,
          toolCallId: approval.toolCallId,
          toolName: approval.toolName,
        }),
        runId: approval.runId,
        type: "tool/result",
      },
    })
    return tx.toolApproval.count({ where: { runId: approval.runId, status: { in: ["pending", "executing"] } } })
  })
  const status: HarnessRunStatus = remaining === 0 ? "yielded" : "waiting_approval"
  if (remaining === 0) {
    await prisma.agentRun.updateMany({
      where: { id: approval.runId, status: "waiting_approval" },
      data: { status: "yielded", stepCount: approval.stepNumber },
    })
  }
  await refreshRunToolProjection(approval.runId)
  return { result: persistedResult, runId: approval.runId, status }
}
