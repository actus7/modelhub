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

export const models = [
  { capabilities: { documents: true, images: false }, id: '@cf/openai/gpt-oss-20b', name: 'GPT OSS 20B (Cloudflare Workers AI)' },
  { capabilities: { documents: true, images: false }, id: '@cf/qwen/qwen3-30b-a3b-fp8', name: 'Qwen 3 30B (Cloudflare Workers AI)' },
]

const app = createProviderApp({
  providerId: 'cloudflareworkersai',
  basePath: '/cloudflareworkersai',
  models,
  defaultModel: models[0].id,
  fetchModels: fetchCloudflareModels,
  testCredentials: async (credentials) => {
    try {
      const token = resolveEnv('CLOUDFLARE_API_TOKEN', credentials)
      const accountId = resolveEnv('CLOUDFLARE_ACCOUNT_ID', credentials)
      const base = process.env.CLOUDFLARE_AI_BASE_URL || 'https://api.cloudflare.com/client/v4'
      const response = await fetchWithTimeout(
        `${base}/accounts/${accountId}/ai/models/search`,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        15000,
      )
      if (response.ok) return { ok: true }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: `Token inválido ou sem permissão (${response.status}).` }
      }
      const errorText = await response.text().catch(() => '')
      return { ok: false, error: `Erro ${response.status}: ${errorText.slice(0, 200)}` }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
        return { ok: false, error: 'Credencial não fornecida.' }
      }
      return { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido.' }
    }
  },
  chat: async (messages, modelId, _rawBody, credentials) => {
    try {
      const token = resolveEnv('CLOUDFLARE_API_TOKEN', credentials)
      const accountId = resolveEnv('CLOUDFLARE_ACCOUNT_ID', credentials)

      const response = await postJsonWithTimeout(
        `${process.env.CLOUDFLARE_AI_BASE_URL || 'https://api.cloudflare.com/client/v4'}/accounts/${accountId}/ai/run/${encodeURIComponent(modelId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: {
            messages: messages.map((message) => ({ role: message.role, content: messageContentAsText(message) })),
          },
          timeoutMs: 60000,
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        return upstreamErrorResponse('Cloudflare Workers AI', response.status, errorText)
      }

      const json = (await response.json().catch(() => null)) as
        | {
            result?: {
              response?: string
              output_text?: string
              text?: string
            }
          }
        | null
      const output = json?.result?.response || json?.result?.output_text || json?.result?.text || ''

      return toVercelSingleTextResponse(String(output))
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
        throw error
      }

      return internalProviderErrorResponse('Cloudflare Workers AI', error)
    }
  },
})

export async function fetchCloudflareModels(credentials?: Record<string, string>): Promise<ProviderModel[]> {
  const token = resolveEnv('CLOUDFLARE_API_TOKEN', credentials)
  const accountId = resolveEnv('CLOUDFLARE_ACCOUNT_ID', credentials)
  const base = process.env.CLOUDFLARE_AI_BASE_URL || 'https://api.cloudflare.com/client/v4'
  const response = await fetchWithTimeout(
    `${base}/accounts/${accountId}/ai/models/search?task=Text Generation`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    15000,
  )
  if (!response.ok) throw new Error(`Cloudflare models API returned ${response.status}`)

  const json = (await response.json()) as {
    result?: Array<{ name: string; description?: string }>
  }
  if (!json.result?.length) throw new Error('Empty models response from Cloudflare')

  return json.result.map((m) => ({
    capabilities: { documents: true, images: false },
    id: m.name,
    name: `${m.name} (Cloudflare Workers AI)`,
  }))
}

export default app.fetch
