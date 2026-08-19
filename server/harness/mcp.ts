import type { Prisma } from "../../generated/prisma/client"
import { createHash } from "node:crypto"
import type { HarnessToolRisk, JsonSchema } from "../../lib/harness/contracts"
import { decryptCredential } from "../lib/crypto"
import { prisma } from "../lib/db"
import { safeFetchPublicHttpUrl } from "./core-tools"
import type { HarnessPlugin } from "./registry"

const MAX_MCP_RESPONSE_BYTES = 1_000_000

type McpTool = {
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean }
  description?: string
  inputSchema?: JsonSchema
  name: string
}

type McpServerConfig = {
  encryptedHeaders: string | null
  id: string
  name: string
  toolsCache: unknown
  url: string
}

export function assertSecureMcpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl)
  const insecureDevAllowed = process.env.NODE_ENV !== "production" && process.env.MODELHUB_ALLOW_INSECURE_MCP === "true"
  if (url.protocol !== "https:" && !insecureDevAllowed) {
    throw new Error("Remote MCP endpoints must use HTTPS")
  }
  return url
}

function parseHeaders(encrypted: string | null): Record<string, string> {
  if (!encrypted) return {}
  const parsed = JSON.parse(decryptCredential(encrypted)) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => [key, value]),
  )
}

async function readBoundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_MCP_RESPONSE_BYTES) {
      await reader.cancel("MCP response limit")
      throw new Error("MCP response exceeded the 1 MB limit")
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

function parseRpcBody(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error("MCP server returned an empty response")
  if (trimmed.startsWith("data:")) {
    const data = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]")
      .join("\n")
    if (!data) throw new Error("MCP SSE response did not contain JSON data")
    return JSON.parse(data) as Record<string, unknown>
  }
  return JSON.parse(trimmed) as Record<string, unknown>
}

export async function readMcpRpcResponse(response: Response, requestId: string): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("text/event-stream")) return parseRpcBody(await readBoundedResponse(response))
  const reader = response.body?.getReader()
  if (!reader) throw new Error("MCP server returned an empty response")
  const decoder = new TextDecoder()
  let buffer = ""
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_MCP_RESPONSE_BYTES) {
      await reader.cancel("MCP response limit")
      throw new Error("MCP response exceeded the 1 MB limit")
    }
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ""
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
      if (!data || data === "[DONE]") continue
      const parsed = JSON.parse(data) as Record<string, unknown>
      if (String(parsed.id ?? "") === requestId) {
        await reader.cancel("MCP response received").catch(() => undefined)
        return parsed
      }
    }
  }
  throw new Error(`MCP SSE stream ended before response ${requestId}`)
}

async function mcpRpc(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
  sessionId?: string,
  operationId?: string,
): Promise<{ result: unknown; sessionId?: string }> {
  assertSecureMcpUrl(server.url)
  const requestId = operationId ?? crypto.randomUUID()
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener("abort", abort, { once: true })
  const timeout = setTimeout(() => controller.abort("MCP timeout"), 20_000)
  try {
    const response = await safeFetchPublicHttpUrl(server.url, {
      body: JSON.stringify({ id: requestId, jsonrpc: "2.0", method, params }),
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...parseHeaders(server.encryptedHeaders),
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        ...(operationId ? { "Idempotency-Key": operationId } : {}),
      },
      method: "POST",
      signal: controller.signal,
    })
    const body = await readMcpRpcResponse(response, requestId)
    if (!response.ok) throw new Error(`MCP ${response.status}: ${JSON.stringify(body).slice(0, 2_000)}`)
    if (body.error) throw new Error(`MCP error: ${JSON.stringify(body.error).slice(0, 2_000)}`)
    return { result: body.result, sessionId: response.headers.get("mcp-session-id") ?? sessionId }
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener("abort", abort)
  }
}

async function mcpNotify(
  server: McpServerConfig,
  method: string,
  signal: AbortSignal,
  sessionId?: string,
): Promise<void> {
  assertSecureMcpUrl(server.url)
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener("abort", abort, { once: true })
  const timeout = setTimeout(() => controller.abort("MCP timeout"), 20_000)
  try {
    const response = await safeFetchPublicHttpUrl(server.url, {
      body: JSON.stringify({ jsonrpc: "2.0", method }),
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...parseHeaders(server.encryptedHeaders),
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      method: "POST",
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`MCP notification failed with HTTP ${response.status}`)
    }
    await response.body?.cancel().catch(() => undefined)
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener("abort", abort)
  }
}

export function mcpToolRisk(tool: McpTool): HarnessToolRisk {
  if (tool.annotations?.destructiveHint) return "destructive"
  return "external-write"
}

export function safeMcpToolName(serverName: string, toolName: string): string {
  const normalize = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "")
  const hash = createHash("sha256").update(`${serverName}\0${toolName}`).digest("hex").slice(0, 8)
  return `mcp_${normalize(serverName).slice(0, 16)}_${normalize(toolName).slice(0, 28)}_${hash}`.slice(0, 64)
}

function cachedTools(value: unknown): McpTool[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (tool): tool is McpTool =>
      !!tool && typeof tool === "object" && typeof (tool as Record<string, unknown>).name === "string",
  )
}

async function discoverTools(server: McpServerConfig, signal: AbortSignal): Promise<{ sessionId?: string; tools: McpTool[] }> {
  try {
    const initialized = await mcpRpc(
      server,
      "initialize",
      { capabilities: {}, clientInfo: { name: "modelhub", version: "1.0.0" }, protocolVersion: "2025-06-18" },
      signal,
    )
    await mcpNotify(
      server,
      "notifications/initialized",
      signal,
      initialized.sessionId,
    )
    const tools: McpTool[] = []
    let cursor: string | undefined
    let activeSessionId = initialized.sessionId
    for (let page = 0; page < 100; page++) {
      const listed = await mcpRpc(
        server,
        "tools/list",
        cursor ? { cursor } : {},
        signal,
        activeSessionId,
      )
      activeSessionId = listed.sessionId
      const result = listed.result as { nextCursor?: unknown; tools?: unknown }
      tools.push(...cachedTools(result?.tools))
      if (tools.length > 1_000) throw new Error("MCP server exposed more than 1000 tools")
      cursor = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined
      if (!cursor) break
      if (page === 99) throw new Error("MCP tools/list exceeded 100 pages")
    }
    if (tools.length > 0) {
      await prisma.mcpServer.update({
        where: { id: server.id },
        data: { toolsCache: tools as unknown as Prisma.InputJsonValue },
      }).catch(() => undefined)
    }
    return { sessionId: activeSessionId, tools }
  } catch {
    return { tools: cachedTools(server.toolsCache) }
  }
}

export async function createMcpPlugin(
  userId: string,
  signal: AbortSignal,
  discover = true,
): Promise<HarnessPlugin> {
  const servers = await prisma.mcpServer.findMany({
    where: { status: "active", userId },
    select: { encryptedHeaders: true, id: true, name: true, toolsCache: true, url: true },
  })
  const discovered = discover
    ? await Promise.all(
        servers.map(async (server) => ({
          server,
          ...(await discoverTools(server, signal)),
        })),
      )
    : servers.map((server) => ({
        server,
        sessionId: undefined,
        tools: cachedTools(server.toolsCache),
      }))

  return {
    capabilities: ["mcp-remote-http"],
    description: "User-configured remote MCP Streamable HTTP tools.",
    id: "modelhub.mcp-remote",
    version: "1.0.0",
    register(registry) {
      const disposers = [
        registry.addCapability({
          available: true,
          description: "Remote MCP over public Streamable HTTP/SSE endpoints.",
          id: "mcp-http",
        }),
        registry.addCapability({
          available: false,
          description: "Local MCP stdio processes.",
          id: "mcp-stdio",
          reason: "Unavailable on the current serverless infrastructure",
        }),
      ]
      for (const entry of discovered) {
        for (const tool of entry.tools) {
          disposers.push(
            registry.addTool({
              name: safeMcpToolName(entry.server.name, tool.name),
              description: tool.description ?? `MCP tool ${tool.name} from ${entry.server.name}`,
              inputSchema: tool.inputSchema ?? { additionalProperties: true, type: "object" },
              risk: mcpToolRisk(tool),
              async execute(args, context) {
                const called = await mcpRpc(
                  entry.server,
                  "tools/call",
                  { arguments: args, name: tool.name },
                  context.signal,
                  entry.sessionId,
                  context.operationId,
                )
                return called.result
              },
            }),
          )
        }
      }
      return () => disposers.reverse().forEach((dispose) => dispose())
    },
  }
}
