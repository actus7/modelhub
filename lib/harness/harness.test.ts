import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { parseChatStream } from "../chat-stream"
import { consumeHarnessStream } from "./client"
import type { HarnessEvent } from "./contracts"
import {
  compactModelMessages,
  HARNESS_COMPLETION_GUIDANCE,
  HARNESS_ITERATIVE_DELIVERY_GUIDANCE,
  HARNESS_NO_PROJECT_GUIDANCE,
  HARNESS_TOOL_USE_GUIDANCE,
  missingExplicitIterativeSections,
} from "../../server/harness/prompt"
import { HarnessRegistry } from "../../server/harness/registry"
import {
  consumeHarnessModelResponse,
  isModelOutputLimitFinishReason,
} from "../../server/harness/model-stream"
import { assertPublicHttpUrl } from "../../server/harness/core-tools"
import { collectHarnessEventPages } from "../../server/harness/events"
import { toHarnessJson } from "../../server/harness/json"
import { assertSecureMcpUrl, mcpToolRisk, readMcpRpcResponse, safeMcpToolName } from "../../server/harness/mcp"
import { parseSingleMessagePart } from "../../server/lib/conversation-attachments"
import {
  limitHarnessToolCalls,
  MAX_TOOL_CALLS_PER_STEP,
  selectHarnessToolSchemas,
} from "../../server/harness/runtime"

describe("harness stream protocol", () => {
  it("keeps ordinary multi-role refinement from pausing for internal tracking approval", () => {
    expect(HARNESS_TOOL_USE_GUIDANCE).toContain("creator/critic")
    expect(HARNESS_TOOL_USE_GUIDANCE).toContain("goal_write")
    expect(HARNESS_TOOL_USE_GUIDANCE).toContain("pause for approval")
  })

  it("recognizes provider finish reasons that require automatic continuation", () => {
    expect(isModelOutputLimitFinishReason("length")).toBe(true)
    expect(isModelOutputLimitFinishReason("max_tokens")).toBe(true)
    expect(isModelOutputLimitFinishReason("max-output-tokens")).toBe(true)
    expect(isModelOutputLimitFinishReason("stop")).toBe(false)
    expect(HARNESS_COMPLETION_GUIDANCE).toContain("numbered round")
    expect(HARNESS_NO_PROJECT_GUIDANCE).toContain("project_file_write")
    expect(HARNESS_ITERATIVE_DELIVERY_GUIDANCE).toContain("final round")
  })

  it("detects missing sections in an explicitly formatted iterative request", () => {
    const user = `Realize 3 rodadas consecutivas.\n[Rodada X - Crítica]\n[Rodada X - Ajustes]\n[Rodada X - Entrega]`
    const messages = [{ content: user, role: "user" as const }]

    expect(
      missingExplicitIterativeSections(
        messages,
        "[Rodada 1 - Entrega]: versão inicial",
      ),
    ).toEqual([
      "[Rodada 1 - Crítica]",
      "[Rodada 1 - Ajustes]",
      "[Rodada 2 - Crítica]",
      "[Rodada 2 - Ajustes]",
      "[Rodada 2 - Entrega]",
      "[Rodada 3 - Crítica]",
      "[Rodada 3 - Ajustes]",
      "[Rodada 3 - Entrega]",
    ])

    const complete = Array.from({ length: 3 }, (_, index) => {
      const round = index + 1
      return `[Rodada ${round} - Crítica]\n[Rodada ${round} - Ajustes]\n[Rodada ${round} - Entrega]`
    }).join("\n")
    expect(missingExplicitIterativeSections(messages, complete)).toEqual([])

    expect(
      missingExplicitIterativeSections(
        messages,
        complete.replace("[Rodada 3 - Entrega]", "[Rodada 3 - Entrega Final]"),
      ),
    ).toEqual([])
  })

  it("hides unusable stateful tools for an ordinary multi-role artifact request", () => {
    const tool = (name: string) => ({
      function: { description: name, name, parameters: { type: "object" as const } },
      type: "function" as const,
    })
    const selected = selectHarnessToolSchemas({
      messages: [{ content: "Atue como criador e crítico e crie um jogo", role: "user" }],
      projectId: null,
      tools: [
        tool("goal_write"),
        tool("todo_write"),
        tool("subagent"),
        tool("project_file_write"),
        tool("web_search"),
        tool("memory_search"),
        tool("session_event_search"),
      ],
    })
    expect(selected.map((item) => item.function.name)).toEqual([])
  })

  it("exposes stateful tools only for explicit persistence or delegation requests", () => {
    const tool = (name: string) => ({
      function: { description: name, name, parameters: { type: "object" as const } },
      type: "function" as const,
    })
    const selected = selectHarnessToolSchemas({
      messages: [{ content: "Salve um plano persistente e delegue a um subagente", role: "user" }],
      projectId: "project-1",
      tools: [tool("plan_write"), tool("subagent"), tool("project_file_write")],
    })
    expect(selected.map((item) => item.function.name)).toEqual([
      "plan_write",
      "subagent",
      "project_file_write",
    ])
  })

  it("exposes web tools only when the user explicitly requests research", () => {
    const tool = (name: string) => ({
      function: { description: name, name, parameters: { type: "object" as const } },
      type: "function" as const,
    })
    const selected = selectHarnessToolSchemas({
      messages: [{ content: "Pesquise na web e cite fontes", role: "user" }],
      projectId: null,
      tools: [tool("web_search"), tool("web_fetch"), tool("goal_write")],
    })
    expect(selected.map((item) => item.function.name)).toEqual([
      "web_search",
      "web_fetch",
    ])
  })

  it("parses streamed harness events and terminal status", async () => {
    const events: HarnessEvent[] = [
      {
        conversationId: "conversation-1",
        createdAt: new Date(0).toISOString(),
        eventId: "event-1",
        payload: { delta: "hello", live: true },
        runId: "run-1",
        seq: "0",
        stepId: "step-1",
        turnId: "turn-1",
        type: "assistant/chunk",
      },
      {
        conversationId: "conversation-1",
        createdAt: new Date(0).toISOString(),
        eventId: "event-2",
        payload: { messageId: "message-1" },
        runId: "run-1",
        seq: "2",
        stepId: "step-1",
        turnId: "turn-1",
        type: "assistant/message",
      },
      {
        conversationId: "conversation-1",
        createdAt: new Date(0).toISOString(),
        eventId: "event-3",
        payload: { status: "completed" },
        runId: "run-1",
        seq: "3",
        stepId: null,
        turnId: "turn-1",
        type: "run/status",
      },
    ]
    const body = events
      .map((event) => `event: harness\ndata: ${JSON.stringify(event)}\n\n`)
      .join("")
    const observed: string[] = []
    const result = await consumeHarnessStream(new Response(body), (event) => {
      observed.push(event.type)
    })

    expect(result).toMatchObject({
      assistantMessageId: "message-1",
      runId: "run-1",
      status: "completed",
      text: "hello",
    })
    expect(observed).toEqual([
      "assistant/chunk",
      "assistant/message",
      "run/status",
    ])
  })

  it("accepts an idempotent continuation replay after the run is terminal", async () => {
    const terminalEvent: HarnessEvent = {
      conversationId: "conversation-1",
      createdAt: new Date(0).toISOString(),
      eventId: "event-terminal-replay",
      payload: { status: "completed" },
      runId: "run-1",
      seq: "4",
      stepId: null,
      turnId: "turn-1",
      type: "run/status",
    }
    const body = `event: harness\ndata: ${JSON.stringify(terminalEvent)}\n\n`

    await expect(consumeHarnessStream(new Response(body))).resolves.toEqual({
      assistantMessageId: undefined,
      runId: "run-1",
      status: "completed",
      text: "",
    })
  })

  it("collects OpenAI tool calls emitted in the final delta", async () => {
    const toolStarts = vi.fn()
    const response = new Response(
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  function: { arguments: '{"query":"modelhub"}', name: "web_search" },
                  id: "call-1",
                  index: 0,
                  type: "function",
                },
              ],
            },
            finish_reason: "tool_calls",
            index: 0,
          },
        ],
      })}\n\ndata: [DONE]\n\n`,
    )

    const parsed = await parseChatStream(response, { onToolStart: toolStarts })
    expect(parsed.finishReason).toBe("tool_calls")
    expect(toolStarts).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { query: "modelhub" },
        toolCallId: "call-1",
        toolName: "web_search",
      }),
    )
  })

  it("surfaces durable run failures as stream errors", async () => {
    const failed: HarnessEvent[] = [
      {
        conversationId: "conversation-1",
        createdAt: new Date(0).toISOString(),
        eventId: "event-error",
        payload: { message: "provider unavailable" },
        runId: "run-1",
        seq: "1",
        stepId: null,
        turnId: "turn-1",
        type: "run/error",
      },
      {
        conversationId: "conversation-1",
        createdAt: new Date(0).toISOString(),
        eventId: "event-status",
        payload: { status: "failed" },
        runId: "run-1",
        seq: "2",
        stepId: null,
        turnId: "turn-1",
        type: "run/status",
      },
    ]
    const body = failed
      .map((event) => `event: harness\ndata: ${JSON.stringify(event)}\n\n`)
      .join("")
    await expect(consumeHarnessStream(new Response(body))).rejects.toThrow(
      "provider unavailable",
    )
  })

  it("collects Vercel tool calls for the server runtime", async () => {
    const result = await consumeHarnessModelResponse(
      new Response(
        '0:"checking"\n9:{"toolCallId":"call-1","toolName":"project_context","args":{}}\nd:{"finishReason":"tool-calls"}\n',
      ),
    )
    expect(result).toEqual({
      finishReason: "tool-calls",
      text: "checking",
      toolCalls: [
        { args: {}, toolCallId: "call-1", toolName: "project_context" },
      ],
    })
  })

  it("keeps the effective Auto routing metadata", async () => {
    const result = await consumeHarnessModelResponse(
      new Response('0:"ok"\nd:{"finishReason":"stop"}\n', {
        headers: {
          "x-modelhub-model": "qwen3.5-27b",
          "x-modelhub-provider": "groq",
          "x-modelhub-tier": "reasoning",
        },
      }),
    )
    expect(result.routing).toEqual({
      modelId: "qwen3.5-27b",
      providerId: "groq",
      tier: "reasoning",
    })
  })

  it("persists streamed deltas in source order even when writes have different latency", async () => {
    const observed: string[] = []
    await consumeHarnessModelResponse(
      new Response('0:"a"\n0:"b"\n0:"c"\nd:{"finishReason":"stop"}\n'),
      async (delta) => {
        await new Promise((resolve) => setTimeout(resolve, delta === "a" ? 10 : 0))
        observed.push(delta)
      },
    )
    expect(observed).toEqual(["a", "b", "c"])
  })
})

describe("harness registry and compaction", () => {
  it("retains validated harness tool traces in message projections", () => {
    expect(
      parseSingleMessagePart({
        toolCalls: [
          {
            args: { query: "status" },
            result: { ok: true },
            status: "completed",
            toolCallId: "call-1",
            toolName: "session_event_search",
          },
        ],
        type: "harness",
      }),
    ).toMatchObject({
      toolCalls: [
        {
          status: "completed",
          toolCallId: "call-1",
          toolName: "session_event_search",
        },
      ],
      type: "harness",
    })
  })

  it.each([
    "http://127.0.0.1/private",
    "http://[::1]/private",
    "http://[::ffff:127.0.0.1]/private",
    "http://100.64.0.1/private",
  ])("rejects private web targets: %s", async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toThrow()
  })

  it("mounts and disposes plugins without leaking tools", () => {
    const registry = new HarnessRegistry()
    registry.mount({
      capabilities: ["test"],
      description: "test plugin",
      id: "test.plugin",
      register(target) {
        const removeCapability = target.addCapability({
          available: true,
          description: "test",
          id: "test",
        })
        const removeTool = target.addTool({
          description: "test tool",
          async execute() {
            return { ok: true }
          },
          inputSchema: { type: "object" },
          name: "test_tool",
          risk: "read",
        })
        return () => {
          removeTool()
          removeCapability()
        }
      },
      version: "1.0.0",
    })

    expect(registry.listTools()).toHaveLength(1)
    expect(registry.listCapabilities()).toHaveLength(1)
    registry.dispose()
    expect(registry.listTools()).toHaveLength(0)
    expect(registry.listCapabilities()).toHaveLength(0)
  })

  it("keeps recent messages and emits a bounded summary", () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      content: `${index}:${"x".repeat(100)}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    }))
    const result = compactModelMessages(messages, 500)
    expect(result.compacted).toBe(true)
    expect(result.messages).toHaveLength(9)
    expect(result.messages[0]).toMatchObject({ role: "system" })
    expect(result.summary?.length).toBeLessThanOrEqual(20_000)
  })

  it("never trusts a remote MCP readOnly hint to bypass approval", () => {
    expect(mcpToolRisk({ annotations: { readOnlyHint: true }, name: "mutate" })).toBe("external-write")
    expect(mcpToolRisk({ annotations: { destructiveHint: true }, name: "delete" })).toBe("destructive")
  })

  it("refuses plaintext remote MCP endpoints", () => {
    expect(() => assertSecureMcpUrl("http://public.example/mcp")).toThrow("HTTPS")
    expect(assertSecureMcpUrl("https://public.example/mcp").protocol).toBe("https:")
  })

  it("uses a stable hash to avoid MCP normalized-name collisions", () => {
    const hyphenated = safeMcpToolName("server", "a-b")
    const underscored = safeMcpToolName("server", "a_b")
    expect(hyphenated).not.toBe(underscored)
    expect(hyphenated).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
  })

  it("correlates a multiline MCP SSE response and ignores notifications", async () => {
    const response = new Response(
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n' +
        'event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":"request-1","result":{"ok":true}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    )
    await expect(readMcpRpcResponse(response, "request-1")).resolves.toMatchObject({
      id: "request-1",
      result: { ok: true },
    })
  })

  it("never splits an assistant tool call from its tool result during compaction", () => {
    const messages = [
      { content: "old", role: "user" as const },
      {
        content: "calling",
        role: "assistant" as const,
        tool_calls: [{ function: { arguments: "{}", name: "test" }, id: "call-1", type: "function" as const }],
      },
      { content: "result", role: "tool" as const, tool_call_id: "call-1" },
      ...Array.from({ length: 7 }, (_, index) => ({ content: `recent-${index}`, role: "user" as const })),
    ]
    const result = compactModelMessages(messages, 1)
    expect(result.messages[1]).toMatchObject({ role: "assistant" })
    expect(result.messages[2]).toMatchObject({ role: "tool", tool_call_id: "call-1" })
  })

  it("runs reversible plugin middleware around tool execution", async () => {
    const registry = new HarnessRegistry()
    const order: string[] = []
    registry.addTool({
      description: "pipeline test",
      async execute() {
        order.push("execute")
        return "result"
      },
      inputSchema: { type: "object" },
      name: "pipeline_test",
      risk: "read",
    })
    const remove = registry.addToolMiddleware({
      id: "test.middleware",
      before() { order.push("before") },
      after({ result }) { order.push("after"); return `${result}:post` },
    })
    const result = await registry.executeTool("pipeline_test", {}, {
      conversationId: "conversation-1",
      operationId: "operation-1",
      projectId: null,
      runId: "run-1",
      signal: new AbortController().signal,
      userId: "user-1",
    })
    expect(result).toBe("result:post")
    expect(order).toEqual(["before", "execute", "after"])
    remove()
    registry.dispose()
  })

  it("bounds adversarial model tool fan-out per step", () => {
    const calls = Array.from({ length: 40 }, (_, index) => ({ args: {}, toolCallId: `call-${index}`, toolName: "test" }))
    const limited = limitHarnessToolCalls(calls)
    expect(limited.accepted).toHaveLength(MAX_TOOL_CALLS_PER_STEP)
    expect(limited.rejected).toHaveLength(40 - MAX_TOOL_CALLS_PER_STEP)
  })

  it("ships database uniqueness for active runs and virtual paths", () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260819120000_harness_runtime/migration.sql"), "utf8")
    expect(sql).toContain('"AgentRun_one_active_root_per_conversation_key"')
    expect(sql).toContain('"ProjectFile_projectId_fileName_key"')
    expect(sql).toContain("'waiting_approval'")
  })

  it("serializes cyclic and bigint tool results without losing the durable event", () => {
    const value: Record<string, unknown> = { count: 12n }
    value.self = value
    expect(toHarnessJson(value)).toEqual({ count: "12", self: "[Circular]" })
  })

  it("reads every event page instead of truncating model history at 1000 events", async () => {
    const events = Array.from({ length: 1_001 }, (_, index): HarnessEvent => ({
      conversationId: "conversation-1",
      createdAt: new Date(0).toISOString(),
      eventId: `event-${index + 1}`,
      payload: {},
      runId: null,
      seq: String(index + 1),
      stepId: null,
      turnId: null,
      type: "user/message",
    }))
    const result = await collectHarnessEventPages(async (after) =>
      events.filter((event) => BigInt(event.seq) > after).slice(0, 1_000),
    )
    expect(result).toHaveLength(1_001)
    expect(result.at(-1)?.eventId).toBe("event-1001")
  })
})
