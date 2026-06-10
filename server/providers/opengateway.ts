import { createProviderApp, resolveEnv, fetchWithTimeout } from '../lib/provider-core'
import { chatViaOpenAiCompatible, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'mimo-v2.5-pro', name: 'Mimo v2.5 Pro' },
]

const OPENGATEWAY_BASE_URL = process.env.OPENGATEWAY_BASE_URL || 'https://opengateway.gitlawb.com/v1'
const OPENGATEWAY_CHAT_URL = `${OPENGATEWAY_BASE_URL}/chat/completions`
const OPENGATEWAY_MODELS_URL = `${OPENGATEWAY_BASE_URL}/models`
const OPENGATEWAY_API_KEY = 'OPENGATEWAY_API_KEY'
const STATIC_MODELS_BY_ID = new Map(models.map((model) => [model.id, model] as const))

const app = createProviderApp({
  providerId: 'opengateway',
  basePath: '/opengateway',
  models,
  fetchModels: async (credentials) => {
    try {
      const apiKey = resolveEnv(OPENGATEWAY_API_KEY, credentials)
      if (!apiKey) return models

      const response = await fetchWithTimeout(OPENGATEWAY_MODELS_URL, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'accept-encoding': 'identity'
        }
      }, 15000)

      if (!response.ok) return models

      const payload = await response.json() as { data?: Array<{ id?: string, name?: string }> }
      if (!Array.isArray(payload.data)) return models

      const dynamicModels = payload.data
        .filter((model): model is { id: string, name?: string } => typeof model?.id === 'string' && model.id.length > 0)
        .map((model) => {
          const knownModel = STATIC_MODELS_BY_ID.get(model.id)
          return {
            id: model.id,
            name: knownModel?.name || model.name || model.id,
            capabilities: knownModel?.capabilities || { documents: false, images: false, tools: true },
          }
        })

      return dynamicModels.length > 0 ? dynamicModels : models
    } catch {
      return models
    }
  },
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { 
        providerName: 'OpenGateway', 
        chatUrl: OPENGATEWAY_CHAT_URL, 
        apiKeyEnv: OPENGATEWAY_API_KEY,
        extraHeaders: { 'accept-encoding': 'identity' }
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  // GET /models valida a chave sem gastar tokens (antes disparava um chat completion).
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      {
        modelsUrl: OPENGATEWAY_MODELS_URL,
        apiKeyEnv: OPENGATEWAY_API_KEY,
        providerName: 'OpenGateway',
        extraHeaders: { 'accept-encoding': 'identity' },
      },
      credentials,
    ),
})

export default app.fetch
