import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP, type LookupFunction } from "node:net"
import { lookup } from "node:dns/promises"
import { Readable } from "node:stream"

import type { HarnessPlugin } from "./registry"
import { appendHarnessEvent, listAllHarnessEvents } from "./events"
import { prisma } from "../lib/db"

const MAX_WEB_BYTES = 1_000_000
const MAX_FILE_BYTES = 1_000_000

function requiredString(args: Record<string, unknown>, key: string, max = 100_000): string {
  const value = args[key]
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${key} must be a non-empty string with at most ${max} characters`)
  }
  return value.trim()
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replaceAll(/^\[|\]$/g, "")
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7)
    if (mapped.includes(".")) return isPrivateAddress(mapped)
    const words = mapped.split(":")
    if (words.length === 2) {
      const high = Number.parseInt(words[0] ?? "", 16)
      const low = Number.parseInt(words[1] ?? "", 16)
      if (Number.isFinite(high) && Number.isFinite(low)) {
        return isPrivateAddress(
          `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
        )
      }
    }
    return true
  }
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return true
  }
  const parts = normalized.split(".").map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
    (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
    parts[0] === 0 ||
    parts[0] >= 224
  )
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  return (await resolvePublicHttpTarget(rawUrl)).url
}

async function resolvePublicHttpTarget(rawUrl: string): Promise<{ address: string; family: 4 | 6; url: URL }> {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP(S) URLs are allowed")
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not allowed")
  const hostname = url.hostname.toLowerCase().replaceAll(/^\[|\]$/g, "")
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("Private hosts are not allowed")
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("Private IP addresses are not allowed")
    return { address: hostname, family: isIP(hostname) as 4 | 6, url }
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error("The host does not resolve exclusively to public IP addresses")
    }
    const selected = addresses[0]!
    return { address: selected.address, family: selected.family as 4 | 6, url }
  }
}

export async function safeFetchPublicHttpUrl(
  rawUrl: string | URL,
  init: { body?: string; headers?: HeadersInit; method?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const { address, family, url } = await resolvePublicHttpTarget(rawUrl.toString())
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  headers.host = url.host
  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, address, family)
  }
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        headers,
        lookup: pinnedLookup,
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        signal: init.signal,
      },
      (response) => {
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, item))
          else if (value !== undefined) responseHeaders.set(key, String(value))
        }
        const status = response.statusCode ?? 502
        resolve(new Response([204, 205, 304].includes(status) ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>, {
          headers: responseHeaders,
          status,
          statusText: response.statusMessage,
        }))
      },
    )
    request.once("error", reject)
    if (init.body !== undefined) request.write(init.body)
    request.end()
  })
}

export async function fetchBoundedText(
  url: URL,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ content: string; contentType: string; status: number }> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener("abort", abort, { once: true })
  const timeout = setTimeout(() => controller.abort("web tool timeout"), 15_000)
  try {
    const response = await safeFetchPublicHttpUrl(url, {
      headers: { Accept: "text/html, text/plain, application/json" },
      signal: controller.signal,
    })
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= 5) throw new Error("Web response exceeded the redirect limit")
      const location = response.headers.get("location")
      if (!location) throw new Error(`Redirect without location (${response.status})`)
      return fetchBoundedText(
        await assertPublicHttpUrl(new URL(location, url).toString()),
        signal,
        redirects + 1,
      )
    }
    const reader = response.body?.getReader()
    if (!reader) return { content: "", contentType: response.headers.get("content-type") ?? "", status: response.status }
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_WEB_BYTES) {
        await reader.cancel("web response limit")
        throw new Error(`Web response exceeds ${MAX_WEB_BYTES} bytes`)
      }
      chunks.push(value)
    }
    return {
      content: new TextDecoder().decode(Buffer.concat(chunks)),
      contentType: response.headers.get("content-type") ?? "",
      status: response.status,
    }
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener("abort", abort)
  }
}

function flattenDuckDuckGoTopics(value: unknown): Array<{ text: string; url: string }> {
  if (!Array.isArray(value)) return []
  const output: Array<{ text: string; url: string }> = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    if (Array.isArray(record.Topics)) output.push(...flattenDuckDuckGoTopics(record.Topics))
    if (typeof record.Text === "string" && typeof record.FirstURL === "string") {
      output.push({ text: record.Text, url: record.FirstURL })
    }
  }
  return output
}

export const coreHarnessPlugin: HarnessPlugin = {
  capabilities: ["project-workspace", "session-query", "web", "goals", "plans", "todos", "subagents"],
  description: "Safe ModelHub-native tools backed by Neon and bounded public HTTP requests.",
  id: "modelhub.core-tools",
  version: "1.0.0",
  register(registry) {
    const disposers = [
      registry.addCapability({ available: true, description: "Versioned virtual files, canvases and project context.", id: "workspace" }),
      registry.addCapability({ available: true, description: "Bounded public HTTP fetch and search.", id: "web" }),
      registry.addCapability({ available: true, description: "Durable event, plan, goal and todo state.", id: "session" }),
      registry.addCapability({ available: false, description: "Host process execution.", id: "shell", reason: "Unavailable on the current serverless infrastructure" }),
      registry.addCapability({ available: false, description: "Persistent pseudo-terminal sessions.", id: "terminal", reason: "Unavailable on the current serverless infrastructure" }),
      registry.addCapability({ available: false, description: "Native language server processes.", id: "lsp", reason: "Unavailable on the current serverless infrastructure" }),
      registry.addTool({
        name: "project_context",
        description: "Read the active ModelHub project's instructions, virtual files and artifacts.",
        inputSchema: { additionalProperties: false, properties: {}, type: "object" },
        risk: "read",
        executionMode: "parallel-safe",
        async execute(_args, context) {
          if (!context.projectId) return { available: false, reason: "No project is attached to this conversation" }
          const project = await prisma.project.findFirst({
            where: { id: context.projectId, userId: context.userId },
            select: {
              artifacts: { orderBy: { updatedAt: "desc" }, select: { id: true, kind: true, title: true, updatedAt: true }, take: 50 },
              description: true,
              files: { orderBy: { updatedAt: "desc" }, select: { byteSize: true, currentVersion: true, fileName: true, id: true, mimeType: true }, take: 100 },
              id: true,
              instructions: true,
              name: true,
            },
          })
          return project ?? { available: false, reason: "Project not found" }
        },
      }),
      registry.addTool({
        name: "project_file_read",
        description: "Read a text file from the active project's versioned virtual filesystem.",
        inputSchema: {
          additionalProperties: false,
          properties: { path: { description: "Project file name", type: "string" } },
          required: ["path"],
          type: "object",
        },
        risk: "read",
        executionMode: "parallel-safe",
        async execute(args, context) {
          if (!context.projectId) throw new Error("No project is attached to this conversation")
          const path = requiredString(args, "path", 255)
          const file = await prisma.projectFile.findFirst({
            where: { fileName: path, projectId: context.projectId, project: { userId: context.userId } },
          })
          if (!file) throw new Error(`Project file not found: ${path}`)
          const text = file.extractedText ?? (file.mimeType.startsWith("text/") ? Buffer.from(file.blob).toString("utf8") : null)
          if (text === null) throw new Error(`Project file is not textual: ${path}`)
          return { content: text.slice(0, 200_000), mimeType: file.mimeType, path, version: file.currentVersion }
        },
      }),
      registry.addTool({
        name: "project_file_write",
        description: "Create or replace a text file in the active project's versioned virtual filesystem.",
        inputSchema: {
          additionalProperties: false,
          properties: {
            content: { type: "string" },
            mimeType: { description: "Defaults to text/plain", type: "string" },
            path: { type: "string" },
          },
          required: ["path", "content"],
          type: "object",
        },
        risk: "reversible-write",
        async execute(args, context) {
          if (!context.projectId) throw new Error("No project is attached to this conversation")
          const path = requiredString(args, "path", 255)
          const rawContent = args.content
          if (typeof rawContent !== "string" || !rawContent.trim() || rawContent.length > MAX_FILE_BYTES) {
            throw new Error(`content must be a non-empty string with at most ${MAX_FILE_BYTES} characters`)
          }
          const content = rawContent
          const mimeType = typeof args.mimeType === "string" ? args.mimeType.slice(0, 100) : "text/plain"
          const blob = Buffer.from(content, "utf8")
          const project = await prisma.project.findFirst({ where: { id: context.projectId, userId: context.userId }, select: { id: true } })
          if (!project) throw new Error("Active project was not found")
          for (let attempt = 0; attempt < 5; attempt++) {
            const existing = await prisma.projectFile.findUnique({
              where: { projectId_fileName: { fileName: path, projectId: context.projectId } },
            })
            if (!existing) {
              try {
                return await prisma.$transaction(async (tx) => {
                  const file = await tx.projectFile.create({ data: { blob, byteSize: blob.byteLength, extractedText: content, fileName: path, mimeType, projectId: context.projectId! } })
                  await tx.projectFileVersion.create({ data: { blob, byteSize: blob.byteLength, extractedText: content, mimeType, projectFileId: file.id, version: 1 } })
                  return { created: true, id: file.id, path, version: 1 }
                })
              } catch (error) {
                if ((error as { code?: string }).code === "P2002") continue
                throw error
              }
            }
            const version = existing.currentVersion + 1
            try {
              const updated = await prisma.$transaction(async (tx) => {
                const claimed = await tx.projectFile.updateMany({
                  where: { currentVersion: existing.currentVersion, id: existing.id },
                  data: { blob, byteSize: blob.byteLength, currentVersion: version, extractedText: content, mimeType },
                })
                if (claimed.count !== 1) throw new Error("PROJECT_FILE_VERSION_CONFLICT")
                await tx.projectFileVersion.create({ data: { blob, byteSize: blob.byteLength, extractedText: content, mimeType, projectFileId: existing.id, version } })
                return { created: false, id: existing.id, path, version }
              })
              return updated
            } catch (error) {
              if ((error as Error).message === "PROJECT_FILE_VERSION_CONFLICT" || (error as { code?: string }).code === "P2002") continue
              throw error
            }
          }
          throw new Error(`Concurrent writes did not settle for project file: ${path}`)
        },
      }),
      registry.addTool({
        name: "memory_search",
        description: "Search the current user's saved ModelHub memories.",
        inputSchema: { additionalProperties: false, properties: { query: { type: "string" } }, required: ["query"], type: "object" },
        risk: "read",
        executionMode: "parallel-safe",
        async execute(args, context) {
          const query = requiredString(args, "query", 200)
          return prisma.userMemory.findMany({ where: { content: { contains: query, mode: "insensitive" }, userId: context.userId }, orderBy: { updatedAt: "desc" }, take: 20 })
        },
      }),
      registry.addTool({
        name: "session_event_search",
        description: "Search the durable event log of the current conversation.",
        inputSchema: { additionalProperties: false, properties: { query: { type: "string" } }, required: ["query"], type: "object" },
        risk: "read",
        executionMode: "parallel-safe",
        async execute(args, context) {
          const query = requiredString(args, "query", 200).toLowerCase()
          const events = await listAllHarnessEvents(context.conversationId)
          return events.filter((event) => `${event.type} ${JSON.stringify(event.payload)}`.toLowerCase().includes(query)).slice(-50)
        },
      }),
      ...(["goal", "plan", "todo"] as const).map((domain) =>
        registry.addTool({
          name: `${domain}_write`,
          description: `Replace the current durable ${domain} state for this conversation.`,
          inputSchema: { additionalProperties: true, properties: { state: { type: "object" } }, required: ["state"], type: "object" },
          risk: "reversible-write" as const,
          async execute(args, context) {
            const state = args.state
            if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("state must be an object")
            return appendHarnessEvent({ conversationId: context.conversationId, payload: { state }, runId: context.runId, type: `${domain}/change` })
          },
        }),
      ),
      registry.addTool({
        name: "web_fetch",
        description: "Fetch bounded textual content from a public HTTP(S) URL. Private networks and credential-bearing URLs are blocked.",
        inputSchema: { additionalProperties: false, properties: { url: { type: "string" } }, required: ["url"], type: "object" },
        risk: "read",
        executionMode: "parallel-safe",
        async execute(args, context) {
          const url = await assertPublicHttpUrl(requiredString(args, "url", 2_048))
          return { url: url.toString(), ...(await fetchBoundedText(url, context.signal)) }
        },
      }),
      registry.addTool({
        name: "web_search",
        description: "Search the public web through DuckDuckGo's bounded instant-answer API.",
        inputSchema: { additionalProperties: false, properties: { query: { type: "string" } }, required: ["query"], type: "object" },
        risk: "read",
        executionMode: "parallel-safe",
        async execute(args, context) {
          const query = requiredString(args, "query", 500)
          const url = await assertPublicHttpUrl(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`)
          const result = await fetchBoundedText(url, context.signal)
          const parsed = JSON.parse(result.content) as Record<string, unknown>
          return {
            abstract: typeof parsed.AbstractText === "string" ? parsed.AbstractText : "",
            abstractUrl: typeof parsed.AbstractURL === "string" ? parsed.AbstractURL : "",
            results: flattenDuckDuckGoTopics(parsed.RelatedTopics).slice(0, 12),
          }
        },
      }),
      registry.addTool({
        name: "subagent",
        description: "Delegate one bounded research or reasoning task to a child model call and return its report.",
        inputSchema: { additionalProperties: false, properties: { objective: { type: "string" } }, required: ["objective"], type: "object" },
        risk: "reversible-write",
        async execute(args, context) {
          if (!context.invokeModel) throw new Error("Subagent provider is unavailable")
          const objective = requiredString(args, "objective", 20_000)
          await appendHarnessEvent({ conversationId: context.conversationId, payload: { objective }, runId: context.runId, type: "subagent/start" })
          const report = await context.invokeModel(objective)
          await appendHarnessEvent({ conversationId: context.conversationId, payload: { objective, report }, runId: context.runId, type: "subagent/end" })
          return { report }
        },
      }),
    ]
    return () => disposers.reverse().forEach((dispose) => dispose())
  },
}
