import { Hono } from 'hono'

import { isProviderEnabled } from '../lib/catalog'
import { jsonErrorResponse, vercelStreamToOpenAiSse } from '../lib/provider-core'
import { withProviderMetadata } from '../lib/observability'
import { getActiveApiKey, protectedCors, securityHeaders } from '../lib/security'
import { providerRegistry, getProviderModels, isProviderAvailableViaExternalApi } from '../providers/registry'
import { resolveRouting, type RoutingResult } from '../lib/routing/routing-resolver'
import type { RoutingTier } from '../lib/routing/complexity-scorer'

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

  // Extrair tier forçado via header ou prefixo do modelo ("complex:auto")
  const headerTier = c.req.header('x-modelhub-tier')
  const forcedTier = VALID_TIERS.includes(headerTier as RoutingTier)
    ? (headerTier as RoutingTier)
    : undefined

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

const app = new Hono()
app.use('*', securityHeaders)
app.use('*', protectedCors)

// GET /v1/models — aggregated model list in OpenAI format (dynamic + cached)
app.get('/v1/models', async (c) => {
  const data: Array<{ id: string; object: string; created: number; owned_by: string }> = []
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
        id: `${providerId}/${model.id}`,
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

  let providerId: string
  let modelId: string
  let effectiveModel = rawModel
  let routingMeta: { tier: string; reason: string; taskCategory: string | null } | null = null

  // Suporte a model="auto" — resolve via configuração de roteamento do usuário
  if (rawModel === 'auto' || rawModel.endsWith(':auto')) {
    const tierPrefix = rawModel.endsWith(':auto') ? rawModel.replace(':auto', '') : undefined
    const autoBody = tierPrefix ? { ...body, _forcedTier: tierPrefix } : body
    const resolved = await resolveAutoRouting(c, autoBody)
    if (!resolved) {
      return jsonErrorResponse(400, 'Routing config not found. Configure your routing at /dashboard/routing or use explicit provider/model format.')
    }
    providerId = resolved.providerId
    modelId = resolved.modelId
    effectiveModel = `${providerId}/${modelId}`
    routingMeta = {
      tier: resolved.routing.tier,
      reason: resolved.routing.reason,
      taskCategory: resolved.routing.taskCategory,
    }
  } else {
    const parsed = parseProviderAndModel(rawModel)
    if (!parsed) {
      return jsonErrorResponse(400, `Unable to resolve provider from model "${rawModel}". Use the format: provider/model-id (e.g. groq/llama-3.3-70b-versatile) or "auto"`)
    }
    providerId = parsed.providerId
    modelId = parsed.modelId
  }

  if (!isProviderEnabled(providerId)) {
    return jsonErrorResponse(404, `Provider "${providerId}" is not available`)
  }

  const entry = providerRegistry[providerId]
  if (!entry) {
    return jsonErrorResponse(404, `Provider "${providerId}" not found`)
  }

  if (!isProviderAvailableViaExternalApi(providerId)) {
    return jsonErrorResponse(
      400,
      `Provider "${providerId}" usa autenticacao no navegador e nao esta disponivel via /v1/chat/completions`,
    )
  }

  // Transform OpenAI-format body to internal proxy format
  const proxyBody: Record<string, unknown> = {
    ...body,
    modelId,
  }
  delete proxyBody.model

  // Build internal Request targeting the provider's /api/chat endpoint
  const internalUrl = new URL(c.req.url)
  internalUrl.pathname = `/${providerId}/api/chat`
  internalUrl.search = ''

  const internalHeaders = new Headers(c.req.raw.headers)
  internalHeaders.set('content-type', 'application/json')

  // Passar metadados de roteamento via headers internos para logging no provider handler
  if (routingMeta) {
    internalHeaders.set('x-modelhub-routing-tier', routingMeta.tier)
    internalHeaders.set('x-modelhub-routing-reason', routingMeta.reason)
    if (routingMeta.taskCategory) {
      internalHeaders.set('x-modelhub-task-category', routingMeta.taskCategory)
    }
  }

  const internalRequest = new Request(internalUrl.toString(), {
    method: 'POST',
    headers: internalHeaders,
    body: JSON.stringify(proxyBody),
  })

  const response = await entry.handler(internalRequest)
  const tagged = withProviderMetadata(response, providerId)

  // Providers return Vercel AI SDK format — convert to OpenAI SSE for external clients
  return vercelStreamToOpenAiSse(tagged, effectiveModel)
})

export default app.fetch
