import {
  createProviderApp,
  fetchWithTimeout,
  internalProviderErrorResponse,
  type ChatMessage,
  type ProviderModel,
} from '../lib/provider-core'
import { toVercelStreamFromOpenAiSse } from '../lib/provider-core'

const POLLINATIONS_BASE = 'https://text.pollinations.ai/openai'
const POLLINATIONS_MODELS_URL = 'https://text.pollinations.ai/models'
const TIMEOUT_MS = 60000

export const POLLINATIONS_MODELS: ProviderModel[] = [
  { capabilities: { documents: true, images: false }, id: 'openai', name: 'GPT-OSS 20B (Pollinations)' },
  { capabilities: { documents: true, images: false }, id: 'openai-fast', name: 'GPT-OSS Fast (Pollinations)' },
  { capabilities: { documents: true, images: true }, id: 'openai-large', name: 'OpenAI Large (Pollinations)' },
  { capabilities: { documents: true, images: false }, id: 'mistral', name: 'Mistral (Pollinations)' },
  { capabilities: { documents: true, images: false }, id: 'mistral-large', name: 'Mistral Large (Pollinations)' },
  { capabilities: { documents: true, images: true }, id: 'searchgpt', name: 'SearchGPT (Pollinations)' },
  { capabilities: { documents: true, images: true }, id: 'qwen', name: 'Qwen (Pollinations)' },
  { capabilities: { documents: true, images: false }, id: 'deepseek', name: 'DeepSeek (Pollinations)' },
  { capabilities: { documents: true, images: false }, id: 'deepseek-r1', name: 'DeepSeek R1 (Pollinations)' },
  { capabilities: { documents: true, images: false }, id: 'llama', name: 'Llama (Pollinations)' },
  { capabilities: { documents: true, images: false }, id: 'llama-33', name: 'Llama 3.3 (Pollinations)' },
  { capabilities: { documents: true, images: false }, id: 'gemini', name: 'Gemini (Pollinations)' },
]

export async function fetchPollinationsModels(): Promise<ProviderModel[]> {
  try {
    const response = await fetchWithTimeout(POLLINATIONS_MODELS_URL, { method: 'GET' }, 10000)
    if (!response.ok) return [...POLLINATIONS_MODELS]

    const data = (await response.json()) as Array<{
      name?: string
      description?: string
      input_modalities?: string[]
      output_modalities?: string[]
      vision?: boolean
      reasoning?: boolean
      tier?: string
      aliases?: string[]
    }>

    if (!Array.isArray(data) || data.length === 0) return [...POLLINATIONS_MODELS]

    const merged: ProviderModel[] = []
    const seen = new Set<string>()

    for (const m of data) {
      if (!m.name || typeof m.name !== 'string') continue
      const id = m.name.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)

      const hasImages = m.vision === true || (Array.isArray(m.input_modalities) && m.input_modalities.some((im) => im.toLowerCase() === 'image'))

      merged.push({
        capabilities: { documents: true, images: hasImages, tools: true },
        id,
        name: m.description || id,
      })
    }

    for (const m of POLLINATIONS_MODELS) {
      if (!seen.has(m.id)) {
        merged.push({ ...m })
        seen.add(m.id)
      }
    }

    return merged.length > 0 ? merged : [...POLLINATIONS_MODELS]
  } catch {
    return [...POLLINATIONS_MODELS]
  }
}

function toOpenAiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((msg) => {
    const out: Record<string, unknown> = { role: msg.role }
    if (typeof msg.content === 'string') {
      out.content = msg.content
    } else if (Array.isArray(msg.content)) {
      out.content = msg.content.map((part) => {
        if (part.type === 'text') return { type: 'text', text: part.text }
        if (part.type === 'image_url') return { type: 'image_url', image_url: part.image_url }
        return part
      })
    }
    return out
  })
}

const app = createProviderApp({
  providerId: 'pollinations',
  basePath: '/pollinations',
  models: POLLINATIONS_MODELS,
  defaultModel: 'openai',
  fetchModels: fetchPollinationsModels,
  chat: async (messages, modelId, rawBody) => {
    const openAiMessages = toOpenAiMessages(messages)

    const hasSystemMessage = openAiMessages.some((m) => m.role === 'system')
    if (!hasSystemMessage) {
      openAiMessages.unshift({
        role: 'system',
        content:
          'Format all responses using proper Markdown. For code, ALWAYS use fenced code blocks with the language identifier (e.g. ```python). Never collapse multiple lines of code onto a single line.',
      })
    }

    const body: Record<string, unknown> = {
      model: modelId,
      messages: openAiMessages,
      stream: true,
    }

    const passthroughFields = ['temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed', 'tools', 'tool_choice', 'response_format', 'reasoning_effort'] as const
    for (const field of passthroughFields) {
      if (rawBody[field] !== undefined) {
        body[field] = rawBody[field]
      }
    }

    try {
      const response = await fetchWithTimeout(
        POLLINATIONS_BASE + '/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        TIMEOUT_MS,
      )

      if (response.ok) {
        const contentType = response.headers.get('Content-Type') || ''
        if (contentType.includes('text/event-stream')) {
          return toVercelStreamFromOpenAiSse(response)
        }
        return new Response(response.body, {
          status: response.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' },
        })
      }

      const errorText = await response.text().catch(() => '')
      return new Response(errorText, {
        status: response.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' },
      })
    } catch (error) {
      return internalProviderErrorResponse('Pollinations AI', error)
    }
  },
})

export default app.fetch