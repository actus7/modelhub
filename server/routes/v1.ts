import { Hono } from 'hono'

import { isProviderEnabled } from '../lib/catalog'
import { jsonErrorResponse, vercelStreamToOpenAiSse } from '../lib/provider-core'
import { withProviderMetadata } from '../lib/observability'
import { protectedCors, securityHeaders } from '../lib/security'
import { providerRegistry, getProviderModels, isProviderAvailableViaExternalApi } from '../providers/registry'

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

  const model = body.model
  if (typeof model !== 'string' || !model) {
    return jsonErrorResponse(400, 'Missing or invalid "model" field. Use the format: provider/model-id')
  }

  const parsed = parseProviderAndModel(model)
  if (!parsed) {
    return jsonErrorResponse(400, `Unable to resolve provider from model "${model}". Use the format: provider/model-id (e.g. groq/llama-3.3-70b-versatile)`)
  }

  const { providerId, modelId } = parsed
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

  const internalRequest = new Request(internalUrl.toString(), {
    method: 'POST',
    headers: internalHeaders,
    body: JSON.stringify(proxyBody),
  })

  const response = await entry.handler(internalRequest)
  const tagged = withProviderMetadata(response, providerId)

  // Providers return Vercel AI SDK format — convert to OpenAI SSE for external clients
  return vercelStreamToOpenAiSse(tagged, model)
})

export default app.fetch
