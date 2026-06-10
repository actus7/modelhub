import {
  createProviderApp,
  fetchWithTimeout,
  internalProviderErrorResponse,
  messageContentAsText,
  postJsonWithTimeout,
  resolveEnv,
  toVercelSingleTextResponse,
  upstreamErrorResponse,
  type ProviderModel,
} from '../lib/provider-core'
import { testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false }, id: 'command-r7b-12-2024', name: 'Command R7B (Cohere)' },
  { capabilities: { documents: true, images: false }, id: 'command-r-plus-08-2024', name: 'Command R+ (Cohere)' },
]

const app = createProviderApp({
  providerId: 'cohere',
  basePath: '/cohere',
  models,
  defaultModel: models[0].id,
  fetchModels: fetchCohereModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://api.cohere.com/v2/models', apiKeyEnv: 'COHERE_API_KEY', providerName: 'Cohere' },
      credentials,
    ),
  chat: async (messages, modelId, _rawBody, credentials) => {
    try {
      const apiKey = resolveEnv('COHERE_API_KEY', credentials)
      const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${messageContentAsText(m)}`).join('\n\n')

      const response = await postJsonWithTimeout(
        process.env.COHERE_CHAT_URL || 'https://api.cohere.com/v2/chat',
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: {
            model: modelId,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          },
          timeoutMs: 60000,
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        return upstreamErrorResponse('Cohere', response.status, errorText)
      }

      const json = (await response.json().catch(() => null)) as
        | {
            message?: {
              content?: Array<{ text?: string }>
            }
            text?: string
          }
        | null
      const content =
        json?.message?.content?.map((item) => item.text || '').join('') || json?.text || ''

      return toVercelSingleTextResponse(String(content))
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
        throw error
      }

      return internalProviderErrorResponse('Cohere', error)
    }
  },
})

export async function fetchCohereModels(credentials?: Record<string, string>): Promise<ProviderModel[]> {
  const apiKey = resolveEnv('COHERE_API_KEY', credentials)
  const response = await fetchWithTimeout(
    'https://api.cohere.com/v2/models',
    { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
    15000,
  )
  if (!response.ok) throw new Error(`Cohere models API returned ${response.status}`)

  const json = (await response.json()) as {
    models?: Array<{ name: string; endpoints?: string[] }>
  }
  if (!json.models?.length) throw new Error('Empty models response from Cohere')

  // Filter only models that support chat
  const chatModels = json.models.filter((m) =>
    m.endpoints?.some((e) => e.toLowerCase() === 'chat'),
  )

  return chatModels.map((m) => ({
    capabilities: { documents: true, images: false },
    id: m.name,
    name: `${m.name} (Cohere)`,
  }))
}

export default app.fetch
