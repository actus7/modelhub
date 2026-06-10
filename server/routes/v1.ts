import { Hono } from 'hono'

import { isProviderEnabled } from '../lib/catalog'
import { jsonErrorResponse, vercelStreamToOpenAiSse } from '../lib/provider-core'
import { withProviderMetadata } from '../lib/observability'
import { getActiveApiKey, protectedCors, securityHeaders } from '../lib/security'
import { providerRegistry, getProviderModels, isProviderAvailableViaExternalApi } from '../providers/registry'
import { resolveRouting, type RoutingResult, type RoutingCandidate } from '../lib/routing/routing-resolver'
import type { RoutingTier } from '../lib/routing/complexity-scorer'
import { shouldTriggerFallback, isInCooldown, recordCooldown } from '../lib/routing/fallback'

const VALID_TIERS: RoutingTier[] = ['simple', 'standard', 'complex', 'reasoning']

function parseProviderAndModel(unifiedModelId: string): { providerId: string; modelId: string } | null {
  const slashIndex = unifiedModelId.indexOf('/')
  if (slashIndex <= 0) {
    return null
  }

  const candidateProvider = unifiedModelId.substring(0, slashIndex)
  if (providerRegistry[candidateProvider]) {
    return { providerId: candidateProvider, modelId: unifiedModelId.substring(slashIndex + 1) }
  }

  return null
}

async function resolveAutoRouting(
  c: { req: { header: (name: string) => string | undefined } },
  body: Record<string, unknown>,
  forcedTierOverride?: RoutingTier,
): Promise<{ routing: RoutingResult; providerId: string; modelId: string } | null> {
  // Extrair userId do token de autenticação
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const apiKey = await getActiveApiKey(token)
  if (!apiKey) return null

  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<{ role: string; content: unknown }>)
    : []

  const tools = Array.isArray(body.tools)
    ? (body.tools as Array<{ function?: { name?: string } }>).map((t) => t.function?.name ?? '').filter(Boolean)
    : []

  // Extrair tier forçado via parâmetro direto (prefixo "complex:auto") ou header
  const headerTier = c.req.header('x-modelhub-tier')
  const forcedTier = forcedTierOverride ?? (VALID_TIERS.includes(headerTier as RoutingTier)
    ? (headerTier as RoutingTier)
    : undefined)

  const result = await resolveRouting({
    userId: apiKey.userId,
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
): Promise<Response> {
  const entry = providerRegistry[providerId]

  const proxyBody: Record<string, unknown> = { ...body, modelId }
  delete proxyBody.model

  const internalUrl = new URL(c.req.url)
  internalUrl.pathname = `/${providerId}/api/chat`
  internalUrl.search = ''

  const internalHeaders = new Headers(c.req.raw.headers)
  internalHeaders.set('content-type', 'application/json')
  // O corpo é reserializado (JSON.stringify(proxyBody)); remove o content-length
  // original para o construtor do Request recalcular o tamanho correto.
  internalHeaders.delete('content-length')

  if (routingMeta) {
    internalHeaders.set('x-modelhub-routing-tier', routingMeta.tier)
    internalHeaders.set('x-modelhub-routing-reason', routingMeta.reason)
    if (routingMeta.taskCategory) {
      internalHeaders.set('x-modelhub-task-category', routingMeta.taskCategory)
    }
  }
  if (fallbackFrom) {
    internalHeaders.set('x-modelhub-fallback-from', fallbackFrom)
  }

  const internalRequest = new Request(internalUrl.toString(), {
    method: 'POST',
    headers: internalHeaders,
    body: JSON.stringify(proxyBody),
  })

  return entry.handler(internalRequest)
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
  const candidates: RoutingCandidate[] = [primary, ...resolved.routing.fallbacks]
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
      reason: isFallback ? 'fallback' : resolved.routing.reason,
      taskCategory: isFallback ? null : resolved.routing.taskCategory,
    }
    const response = await dispatchToProvider(
      c,
      cand.providerId,
      cand.modelId,
      body,
      meta,
      isFallback ? primaryModel : undefined,
    )
    recordCooldown(cand.providerId, cand.modelId, response.status, response.headers.get('retry-after'))

    if (response.ok) {
      return vercelStreamToOpenAiSse(withProviderMetadata(response, cand.providerId), `${cand.providerId}/${cand.modelId}`)
    }

    lastError = withProviderMetadata(response, cand.providerId)
    if (!shouldTriggerFallback(response.status)) break
  }

  if (lastError) {
    return vercelStreamToOpenAiSse(lastError, primaryModel)
  }
  if (skippedByCooldown) {
    return jsonErrorResponse(429, 'Todos os modelos de roteamento estão temporariamente em cooldown (rate limit). Tente novamente em instantes.')
  }
  return jsonErrorResponse(503, 'No routing candidates available. Configure your routing at /dashboard/routing.')
}

const app = new Hono()
app.use('*', securityHeaders)
app.use('*', protectedCors)

// GET /v1/models — aggregated model list in OpenAI format (dynamic + cached)
app.get('/v1/models', async (c) => {
  const data: Array<{
    capabilities: import('../lib/provider-core').ProviderModel['capabilities']
    created: number
    id: string
    name: string
    object: string
    owned_by: string
  }> = []
  const now = Math.floor(Date.now() / 1000)

  const enabledProviders = Object.keys(providerRegistry).filter(
    (providerId) => isProviderEnabled(providerId) && isProviderAvailableViaExternalApi(providerId),
  )

  const results = await Promise.allSettled(
    enabledProviders.map(async (providerId) => {
      const models = await getProviderModels(providerId)
      return { providerId, models }
    }),
  )

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const { providerId, models } = result.value
    for (const model of models) {
      data.push({
        capabilities: model.capabilities,
        id: `${providerId}/${model.id}`,
        name: model.name,
        object: 'model',
        created: now,
        owned_by: providerId,
      })
    }
  }

  return c.json({ object: 'list', data })
})

// POST /v1/chat/completions — unified routing
app.post('/v1/chat/completions', async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return jsonErrorResponse(400, 'Invalid JSON request body')
  }

  const rawModel = body.model
  if (typeof rawModel !== 'string' || !rawModel) {
    return jsonErrorResponse(400, 'Missing or invalid "model" field. Use the format: provider/model-id or "auto"')
  }

  // Suporte a model="auto" — resolve via configuração de roteamento do usuário,
  // com fallback automático para os demais modelos configurados quando o
  // modelo escolhido falha (>=400, exceto erros de request do cliente).
  if (rawModel === 'auto' || rawModel.endsWith(':auto')) {
    const tierPrefix = rawModel.endsWith(':auto') ? rawModel.replace(':auto', '') : undefined
    const forcedTier = VALID_TIERS.includes(tierPrefix as RoutingTier) ? (tierPrefix as RoutingTier) : undefined
    const resolved = await resolveAutoRouting(c, body, forcedTier)
    if (!resolved) {
      return jsonErrorResponse(400, 'Routing config not found. Configure your routing at /dashboard/routing or use explicit provider/model format.')
    }
    return forwardAutoWithFallback(c, body, resolved)
  }

  // Modelo explícito provider/model-id — sem fallback (cliente escolheu o modelo).
  const parsed = parseProviderAndModel(rawModel)
  if (!parsed) {
    return jsonErrorResponse(400, `Unable to resolve provider from model "${rawModel}". Use the format: provider/model-id (e.g. groq/llama-3.3-70b-versatile) or "auto"`)
  }

  const invalid = validateProviderForForward(parsed.providerId)
  if (invalid) return invalid

  const response = await dispatchToProvider(c, parsed.providerId, parsed.modelId, body, null)
  const tagged = withProviderMetadata(response, parsed.providerId)

  // Providers return Vercel AI SDK format — convert to OpenAI SSE for external clients
  return vercelStreamToOpenAiSse(tagged, rawModel)
})

export default app.fetch
