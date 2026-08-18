import { Hono } from "hono"
import type { Context } from "hono"

import { isProviderEnabled } from "../lib/catalog"
import {
  jsonErrorResponse,
  vercelStreamToOpenAiSse,
} from "../lib/provider-core"
import { withProviderMetadata } from "../lib/observability"
import {
  authenticateAccess,
  getActiveApiKey,
  protectedCors,
  securityHeaders,
} from "../lib/security"
import { resolveMaxOutputTokens } from "@/lib/model-output-limits"
import {
  providerRegistry,
  getProviderModels,
  isProviderAvailableViaExternalApi,
} from "../providers/registry"
import {
  resolveRouting,
  type RoutingResult,
  type RoutingCandidate,
} from "../lib/routing/routing-resolver"
import type { RoutingTier } from "../lib/routing/complexity-scorer"
import {
  shouldTriggerFallback,
  isInCooldown,
  recordCooldown,
  recordTransientCooldown,
} from "../lib/routing/fallback"

const VALID_TIERS: RoutingTier[] = [
  "simple",
  "standard",
  "complex",
  "reasoning",
]
const AUTO_ROUTING_CANDIDATE_TIMEOUT_MS = Number(
  process.env.AUTO_ROUTING_CANDIDATE_TIMEOUT_MS ?? 45_000,
)
const AUTO_ROUTING_TIMEOUT_COOLDOWN_MS = 60_000

function parseProviderAndModel(
  unifiedModelId: string,
): { providerId: string; modelId: string } | null {
  const slashIndex = unifiedModelId.indexOf("/")
  if (slashIndex <= 0) {
    return null
  }

  const candidateProvider = unifiedModelId.substring(0, slashIndex)
  if (providerRegistry[candidateProvider]) {
    return {
      providerId: candidateProvider,
      modelId: unifiedModelId.substring(slashIndex + 1),
    }
  }

  return null
}

async function resolveAutoRouting(
  c: Context,
  body: Record<string, unknown>,
  forcedTierOverride?: RoutingTier,
): Promise<{
  routing: RoutingResult
  providerId: string
  modelId: string
} | null> {
  let userId = c.get("userId") as string | undefined

  const authHeader = c.req.header("Authorization")
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim()
  if (!userId && token) {
    const apiKey = await getActiveApiKey(token)
    userId = apiKey?.userId
  }
  if (!userId) return null

  const messages = Array.isArray(body.messages)
    ? (
        body.messages as Array<{
          role?: unknown
          content?: unknown
          parts?: unknown
        }>
      ).map((message) => ({
        role: typeof message.role === "string" ? message.role : "",
        content:
          message.content ??
          (Array.isArray(message.parts)
            ? message.parts
                .filter(
                  (part): part is { text: string; type: string } =>
                    typeof part === "object" &&
                    part !== null &&
                    "type" in part &&
                    part.type === "text" &&
                    "text" in part &&
                    typeof part.text === "string",
                )
                .map((part) => part.text)
                .join("\n")
            : ""),
      }))
    : []

  const tools = Array.isArray(body.tools)
    ? (body.tools as Array<{ function?: { name?: string } }>)
        .map((t) => t.function?.name ?? "")
        .filter(Boolean)
    : []

  // Extrair tier forçado via parâmetro direto (prefixo "complex:auto") ou header
  const headerTier = c.req.header("x-modelhub-tier")
  const forcedTier =
    forcedTierOverride ??
    (VALID_TIERS.includes(headerTier as RoutingTier)
      ? (headerTier as RoutingTier)
      : undefined)

  const result = await resolveRouting({
    userId,
    messages,
    forcedTier,
    toolNames: tools,
  })

  if (!result) return null

  return {
    routing: result,
    providerId: result.providerId,
    modelId: result.modelId,
  }
}

interface RoutingMeta {
  tier: string
  reason: string
  taskCategory: string | null
}

// Espelha o padrão X-Manifest-* do Manifest: cada resposta roteada expõe ao
// cliente qual tier/modelo/confiança foi usado, sem precisar consultar logs.
function withRoutingResponseHeaders(
  res: Response,
  meta: {
    tier: string
    reason: string
    provider: string
    model: string
    confidence?: number
    taskCategory?: string | null
    fallbackFrom?: string
  },
): Response {
  const headers = new Headers(res.headers)
  headers.set("X-ModelHub-Tier", meta.tier)
  headers.set("X-ModelHub-Reason", meta.reason)
  headers.set("X-ModelHub-Provider", meta.provider)
  headers.set("X-ModelHub-Model", meta.model)
  if (meta.confidence !== undefined)
    headers.set("X-ModelHub-Confidence", String(meta.confidence))
  if (meta.taskCategory)
    headers.set("X-ModelHub-Task-Category", meta.taskCategory)
  if (meta.fallbackFrom)
    headers.set("X-ModelHub-Fallback-From", meta.fallbackFrom)
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

// Valida se um provider pode receber forward via /v1/chat/completions.
// Retorna uma Response de erro quando inválido, ou null quando OK.
function validateProviderForForward(providerId: string): Response | null {
  if (!isProviderEnabled(providerId)) {
    return jsonErrorResponse(404, `Provider "${providerId}" is not available`)
  }
  if (!providerRegistry[providerId]) {
    return jsonErrorResponse(404, `Provider "${providerId}" not found`)
  }
  if (!isProviderAvailableViaExternalApi(providerId)) {
    return jsonErrorResponse(
      400,
      `Provider "${providerId}" usa autenticacao no navegador e nao esta disponivel via /v1/chat/completions`,
    )
  }
  return null
}

// Encaminha a requisição (já em formato OpenAI) ao handler interno do provider.
// Assume que validateProviderForForward já passou.
async function dispatchToProvider(
  c: { req: { url: string; raw: Request } },
  providerId: string,
  modelId: string,
  body: Record<string, unknown>,
  routingMeta: RoutingMeta | null,
  fallbackFrom?: string,
  signal?: AbortSignal,
): Promise<Response> {
  const entry = providerRegistry[providerId]

  const proxyBody: Record<string, unknown> = { ...body, modelId }
  delete proxyBody.model

  const internalUrl = new URL(c.req.url)
  internalUrl.pathname = `/${providerId}/api/chat`
  internalUrl.search = ""

  const internalHeaders = new Headers(c.req.raw.headers)
  internalHeaders.set("content-type", "application/json")
  // O corpo é reserializado (JSON.stringify(proxyBody)); remove o content-length
  // original para o construtor do Request recalcular o tamanho correto.
  internalHeaders.delete("content-length")

  if (routingMeta) {
    internalHeaders.set("x-modelhub-routing-tier", routingMeta.tier)
    internalHeaders.set("x-modelhub-routing-reason", routingMeta.reason)
    if (routingMeta.taskCategory) {
      internalHeaders.set("x-modelhub-task-category", routingMeta.taskCategory)
    }
  }
  if (fallbackFrom) {
    internalHeaders.set("x-modelhub-fallback-from", fallbackFrom)
  }

  const internalRequest = new Request(internalUrl.toString(), {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify(proxyBody),
    signal,
  })

  return entry.handler(internalRequest)
}

function hasUsefulStreamEvent(buffer: string): boolean {
  for (const line of buffer.split("\n")) {
    if (line.startsWith("0:")) {
      try {
        if ((JSON.parse(line.slice(2)) as string).trim()) return true
      } catch {
        continue
      }
    }
    if (line.startsWith("9:") || line.startsWith("a:")) return true
    if (line.startsWith("3:") || line.startsWith("d:")) {
      throw new Error("Provider stream completed without useful output")
    }
  }
  return false
}

async function requireUsefulStreamEvent(
  response: Response,
  timeoutMs: number,
): Promise<Response> {
  if (!response.body) throw new Error("Provider response has no body stream")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const bufferedChunks: Uint8Array[] = []
  let bufferedText = ""
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    while (true) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DOMException(
                  "Provider stream did not produce output",
                  "AbortError",
                ),
              ),
            timeoutMs,
          )
        }),
      ])
      if (timer) clearTimeout(timer)

      if (chunk.done)
        throw new Error("Provider stream ended without useful output")

      bufferedChunks.push(chunk.value)
      bufferedText += decoder.decode(chunk.value, { stream: true })
      if (hasUsefulStreamEvent(bufferedText)) break
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        bufferedChunks.forEach((chunk) => controller.enqueue(chunk))
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            controller.enqueue(chunk.value)
          }
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })

    return new Response(stream, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Executa o roteamento "auto": tenta o modelo primário e, em caso de falha
// elegível, percorre os fallbacks configurados (pulando os que estão em
// cooldown de rate-limit). Converte a resposta bem-sucedida para SSE OpenAI.
async function forwardAutoWithFallback(
  c: { req: { url: string; raw: Request } },
  body: Record<string, unknown>,
  resolved: { routing: RoutingResult; providerId: string; modelId: string },
): Promise<Response> {
  const primary: RoutingCandidate = {
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    tier: resolved.routing.tier,
  }
  const candidates: RoutingCandidate[] = [
    primary,
    ...resolved.routing.fallbacks,
  ]
  const primaryModel = `${primary.providerId}/${primary.modelId}`

  let lastError: Response | null = null
  let skippedByCooldown = false

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]

    const invalid = validateProviderForForward(cand.providerId)
    if (invalid) {
      lastError = invalid
      continue
    }
    if (isInCooldown(cand.providerId, cand.modelId)) {
      skippedByCooldown = true
      continue
    }

    const isFallback = i > 0
    const meta: RoutingMeta = {
      tier: cand.tier,
      reason: isFallback ? "fallback" : resolved.routing.reason,
      taskCategory: isFallback ? null : resolved.routing.taskCategory,
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let response: Response
    try {
      const timeout = new Promise<Response>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new DOMException("Provider timed out", "AbortError"))
        }, AUTO_ROUTING_CANDIDATE_TIMEOUT_MS)
      })
      response = await Promise.race([
        dispatchToProvider(
          c,
          cand.providerId,
          cand.modelId,
          body,
          meta,
          isFallback ? primaryModel : undefined,
          controller.signal,
        ),
        timeout,
      ])
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        recordTransientCooldown(
          cand.providerId,
          cand.modelId,
          AUTO_ROUTING_TIMEOUT_COOLDOWN_MS,
        )
        response = jsonErrorResponse(
          504,
          `Provider/model timed out: ${cand.providerId}/${cand.modelId}`,
        )
      } else {
        response = jsonErrorResponse(
          503,
          error instanceof Error ? error.message : "Provider request failed",
        )
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (response.ok) {
      try {
        response = await requireUsefulStreamEvent(
          response,
          AUTO_ROUTING_CANDIDATE_TIMEOUT_MS,
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          recordTransientCooldown(
            cand.providerId,
            cand.modelId,
            AUTO_ROUTING_TIMEOUT_COOLDOWN_MS,
          )
          response = jsonErrorResponse(
            504,
            `Provider/model stream timed out: ${cand.providerId}/${cand.modelId}`,
          )
        } else {
          response = jsonErrorResponse(
            503,
            error instanceof Error ? error.message : "Provider stream failed",
          )
        }
      }
    }
    recordCooldown(
      cand.providerId,
      cand.modelId,
      response.status,
      response.headers.get("retry-after"),
    )

    if (response.ok) {
      const sse = vercelStreamToOpenAiSse(
        withProviderMetadata(response, cand.providerId),
        `${cand.providerId}/${cand.modelId}`,
      )
      return withRoutingResponseHeaders(sse, {
        tier: meta.tier,
        reason: meta.reason,
        provider: cand.providerId,
        model: cand.modelId,
        confidence: isFallback ? undefined : resolved.routing.confidence,
        taskCategory: meta.taskCategory,
        fallbackFrom: isFallback ? primaryModel : undefined,
      })
    }

    lastError = withProviderMetadata(response, cand.providerId)
    if (!shouldTriggerFallback(response.status)) break
  }

  if (lastError) {
    return vercelStreamToOpenAiSse(lastError, primaryModel)
  }
  if (skippedByCooldown) {
    return jsonErrorResponse(
      429,
      "Todos os modelos de roteamento estão temporariamente em cooldown (rate limit). Tente novamente em instantes.",
    )
  }
  return jsonErrorResponse(
    503,
    "No routing candidates available. Configure your routing at /dashboard/routing.",
  )
}

const app = new Hono()
app.use("*", securityHeaders)
app.use("*", protectedCors)

// GET /v1/models — aggregated model list in OpenAI format (dynamic + cached)
app.get("/v1/models", async (c) => {
  const data: Array<{
    capabilities: import("../lib/provider-core").ProviderModel["capabilities"]
    created: number
    id: string
    name: string
    object: string
    owned_by: string
  }> = []
  const now = Math.floor(Date.now() / 1000)

  const enabledProviders = Object.keys(providerRegistry).filter(
    (providerId) =>
      isProviderEnabled(providerId) &&
      isProviderAvailableViaExternalApi(providerId),
  )

  const results = await Promise.allSettled(
    enabledProviders.map(async (providerId) => {
      const models = await getProviderModels(providerId)
      return { providerId, models }
    }),
  )

  for (const result of results) {
    if (result.status !== "fulfilled") continue
    const { providerId, models } = result.value
    for (const model of models) {
      data.push({
        capabilities: model.capabilities,
        id: `${providerId}/${model.id}`,
        name: model.name,
        object: "model",
        created: now,
        owned_by: providerId,
      })
    }
  }

  return c.json({ object: "list", data })
})

// POST /v1/chat/completions — unified routing
app.post("/v1/chat/completions", async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return jsonErrorResponse(400, "Invalid JSON request body")
  }

  const rawModel = body.model
  if (typeof rawModel !== "string" || !rawModel) {
    return jsonErrorResponse(
      400,
      'Missing or invalid "model" field. Use the format: provider/model-id or "auto"',
    )
  }

  // Suporte a model="auto" — resolve via configuração de roteamento do usuário,
  // com fallback automático para os demais modelos configurados quando o
  // modelo escolhido falha (>=400, exceto erros de request do cliente).
  if (rawModel === "auto" || rawModel.endsWith(":auto")) {
    const accessError = await authenticateAccess(c)
    if (accessError) return accessError

    const tierPrefix = rawModel.endsWith(":auto")
      ? rawModel.replace(":auto", "")
      : undefined
    const forcedTier = VALID_TIERS.includes(tierPrefix as RoutingTier)
      ? (tierPrefix as RoutingTier)
      : undefined
    const resolved = await resolveAutoRouting(c, body, forcedTier)
    if (!resolved) {
      return jsonErrorResponse(
        400,
        "No routing config and no ready providers for auto routing. Configure credentials at /setup and routing at /dashboard/routing, or use the explicit provider/model format.",
      )
    }
    return forwardAutoWithFallback(
      c,
      {
        ...body,
        max_tokens:
          body.max_tokens ??
          resolveMaxOutputTokens({
            modelId: resolved.modelId,
            providerId: resolved.providerId,
          }),
      },
      resolved,
    )
  }

  // Modelo explícito provider/model-id — sem fallback (cliente escolheu o modelo).
  const parsed = parseProviderAndModel(rawModel)
  if (!parsed) {
    return jsonErrorResponse(
      400,
      `Unable to resolve provider from model "${rawModel}". Use the format: provider/model-id (e.g. groq/llama-3.3-70b-versatile) or "auto"`,
    )
  }

  const invalid = validateProviderForForward(parsed.providerId)
  if (invalid) return invalid

  const response = await dispatchToProvider(
    c,
    parsed.providerId,
    parsed.modelId,
    {
      ...body,
      max_tokens:
        body.max_tokens ??
        resolveMaxOutputTokens({
          modelId: parsed.modelId,
          providerId: parsed.providerId,
        }),
    },
    null,
  )
  const tagged = withProviderMetadata(response, parsed.providerId)

  // Providers return Vercel AI SDK format — convert to OpenAI SSE for external clients
  return vercelStreamToOpenAiSse(tagged, rawModel)
})

export default app.fetch
