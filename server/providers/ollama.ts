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

export default app.fetch
