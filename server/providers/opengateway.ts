import { createProviderApp, resolveEnv } from '../lib/provider-core'
import { chatViaOpenAiCompatible, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'mimo-v2.5-pro', name: 'Mimo v2.5 Pro' },
]

const OPENGATEWAY_BASE_URL = process.env.OPENGATEWAY_BASE_URL || 'https://opengateway.gitlawb.com/v1'
const OPENGATEWAY_CHAT_URL = `${OPENGATEWAY_BASE_URL}/chat/completions`
const OPENGATEWAY_API_KEY = 'OPENGATEWAY_API_KEY'

const app = createProviderApp({
  providerId: 'opengateway',
  basePath: '/opengateway',
  models,
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
  testCredentials: async (credentials) => {
    try {
      const apiKey = resolveEnv(OPENGATEWAY_API_KEY, credentials)
      if (!apiKey) return { ok: false, error: 'Chave de API ausente' }

      const response = await fetch(OPENGATEWAY_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'accept-encoding': 'identity'
        },
        body: JSON.stringify({
          model: 'mimo-v2.5-pro',
          messages: [{ role: 'user', content: 'hello' }],
          max_tokens: 1
        })
      })
      if (!response.ok) {
        return { ok: false, error: `Erro HTTP ${response.status}: ${await response.text()}` }
      }
      return { ok: true }
    } catch (err: unknown) {
      if (err instanceof Error) {
        return { ok: false, error: err.message }
      }
      return { ok: false, error: String(err) }
    }
  },
})

export default app.fetch
