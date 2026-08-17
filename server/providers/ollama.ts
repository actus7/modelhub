import { createProviderApp, jsonErrorResponse, toVercelStreamFromOpenAiSse, upstreamErrorResponse } from '../lib/provider-core'
import type { ProviderModel } from '../lib/provider-core'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'

export const models: ProviderModel[] = [
  { capabilities: { documents: true, images: false, tools: false }, id: 'llama3.2', name: 'Llama 3.2 (Ollama)' },
  { capabilities: { documents: true, images: false, tools: false }, id: 'llama3.2:3b', name: 'Llama 3.2 3B (Ollama)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder (Ollama)' },
  { capabilities: { documents: true, images: false, tools: false }, id: 'mistral', name: 'Mistral 7B (Ollama)' },
  { capabilities: { documents: true, images: false, tools: false }, id: 'phi3', name: 'Phi-3 (Ollama)' },
]

export async function fetchOllamaModels(): Promise<ProviderModel[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const json = (await res.json()) as { models?: Array<{ name: string; details?: { family?: string } }> }
    if (!json.models?.length) return []
    return json.models.map((m) => ({
      id: m.name,
      name: `${m.name} (Ollama)`,
      capabilities: { documents: true, images: false, tools: false },
    }))
  } catch {
    return []
  }
}

export type OllamaStatus = {
  baseUrl: string
  modelCount: number | null
  online: boolean
  version: string | null
}

const STATUS_CACHE_TTL_MS = 15_000
let statusCache: { at: number; value: OllamaStatus } | null = null

/**
 * Verifica o servidor Ollama local (GET /api/tags + /api/version) e devolve um
 * snapshot com online/baseUrl/modelCount/version. Resultado é cacheado por 15s
 * para aguentar polling da UI sem martelar o servidor local.
 */
export async function fetchOllamaStatus(force = false): Promise<OllamaStatus> {
  const now = Date.now()
  if (!force && statusCache && now - statusCache.at < STATUS_CACHE_TTL_MS) {
    return statusCache.value
  }

  let value: OllamaStatus
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { models?: unknown[] }

    let version: string | null = null
    try {
      const versionRes = await fetch(`${OLLAMA_BASE_URL}/api/version`, { signal: AbortSignal.timeout(3000) })
      if (versionRes.ok) {
        const versionJson = (await versionRes.json()) as { version?: string }
        version = versionJson.version ?? null
      }
    } catch {
      // /api/version é opcional em builds antigas; segue sem ela.
    }

    value = {
      baseUrl: OLLAMA_BASE_URL,
      modelCount: Array.isArray(json.models) ? json.models.length : null,
      online: true,
      version,
    }
  } catch {
    value = { baseUrl: OLLAMA_BASE_URL, modelCount: null, online: false, version: null }
  }

  statusCache = { at: now, value }
  return value
}

function toOpenAiMessages(messages: Array<{ role: string; content: unknown }>) {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }))
}

const app = createProviderApp({
  providerId: 'ollama',
  basePath: '/ollama',
  models,
  defaultModel: models[0].id,
  fetchModels: fetchOllamaModels,
  chat: async (messages, modelId, rawBody) => {
    let res: Response
    try {
      res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: toOpenAiMessages(messages),
          stream: true,
          stream_options: { include_usage: true },
          ...(rawBody.temperature !== undefined ? { temperature: rawBody.temperature } : {}),
          ...(rawBody.max_tokens !== undefined ? { max_tokens: rawBody.max_tokens } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao conectar com Ollama'
      return jsonErrorResponse(503, `Ollama indisponível: ${msg}`)
    }

    if (!res.ok) {
      const text = await res.text()
      return upstreamErrorResponse('Ollama', res.status, text)
    }

    return toVercelStreamFromOpenAiSse(res)
  },
})

// GET /ollama/api/status — snapshot do servidor local (online, baseUrl,
// modelCount, version) com cache de 15s; `?force=1` ignora o cache.
app.get('/api/status', async (c) => {
  const force = c.req.query('force') === '1'
  const status = await fetchOllamaStatus(force)
  return c.json(status)
})

export default app.fetch
