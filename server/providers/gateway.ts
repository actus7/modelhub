import { chatViaOpenAiCompatible, testViaOpenAiModels } from '../lib/openai-compatible'
import {
  createProviderApp,
  fetchWithTimeout,
  internalProviderErrorResponse,
  jsonErrorResponse,
  type ChatMessage,
  type ProviderModel,
} from '../lib/provider-core'

const GATEWAY_BASE =
  process.env.GATEWAY_LABS_BASE_URL?.trim() || 'https://ai-sdk-gateway-demo.labs.vercel.dev'

function hasVercelAiGatewayKey(credentials?: Record<string, string>): boolean {
  const fromCred = credentials?.VERCEL_AI_GATEWAY_API_KEY
  const fromEnv = process.env.VERCEL_AI_GATEWAY_API_KEY
  return Boolean(
    (typeof fromCred === 'string' && fromCred.trim().length > 0) ||
      (typeof fromEnv === 'string' && fromEnv.trim().length > 0),
  )
}

export const GATEWAY_MODELS: ProviderModel[] = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'amazon/nova-lite', name: 'Nova Lite' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'amazon/nova-micro', name: 'Nova Micro' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'google/gemini-3-flash', name: 'Gemini 3 Flash' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'meta/llama-3.1-8b', name: 'Llama 3.1 8B Instruct' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'openai/gpt-5-mini', name: 'GPT-5 mini' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'openai/gpt-5-nano', name: 'GPT-5 nano' },
]

export async function fetchGatewayModels(): Promise<ProviderModel[]> {
  try {
    const response = await fetchWithTimeout(`${GATEWAY_BASE}/api/models`, { method: 'GET' }, 10000)
    if (!response.ok) return [...GATEWAY_MODELS]

    const data = (await response.json()) as {
      models?: Array<{ capabilities?: { documents?: boolean; images?: boolean }; id: string; name: string }>
    }
    if (!data.models?.length) return [...GATEWAY_MODELS]

    const mapped = data.models
      .filter((m) => typeof m?.id === 'string' && typeof m?.name === 'string')
      .map((m) => ({
        capabilities: {
          documents: m.capabilities?.documents ?? true,
          images: m.capabilities?.images ?? false,
          tools: true,
        },
        id: m.id,
        name: m.name,
      }))

    return mapped.length > 0 ? mapped : [...GATEWAY_MODELS]
  } catch {
    return [...GATEWAY_MODELS]
  }
}

const app = createProviderApp({
  providerId: 'gateway',
  basePath: '/gateway',
  models: GATEWAY_MODELS,
  defaultModel: GATEWAY_MODELS[0].id,
  fetchModels: fetchGatewayModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      {
        modelsUrl: 'https://ai-gateway.vercel.sh/v1/models',
        apiKeyEnv: 'VERCEL_AI_GATEWAY_API_KEY',
        providerName: 'Vercel AI Gateway',
      },
      credentials,
    ),
  chat: async (
    messages: ChatMessage[],
    modelId: string,
    rawBody: Record<string, unknown>,
    credentials: Record<string, string>,
  ) => {
    // AI Gateway oficial (chave em VERCEL_AI_GATEWAY_API_KEY ou credenciais do provider).
    if (hasVercelAiGatewayKey(credentials)) {
      return chatViaOpenAiCompatible(
        {
          providerName: 'Gateway (Chat)',
          chatUrl:
            process.env.VERCEL_AI_GATEWAY_CHAT_URL ||
            'https://ai-gateway.vercel.sh/v1/chat/completions',
          apiKeyEnv: 'VERCEL_AI_GATEWAY_API_KEY',
        },
        { messages, modelId, rawBody },
        credentials,
      )
    }

    try {
      const response = await fetchWithTimeout(
        `${GATEWAY_BASE}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...rawBody, messages, modelId }),
        },
        60000,
      )

      if (response.ok) {
        return new Response(response.body, {
          status: response.status,
          headers: {
            'Content-Type': response.headers.get('Content-Type') || 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
          },
        })
      }

      const errorText = await response.text().catch(() => '')
      if (response.status === 500 && !errorText.trim()) {
        return jsonErrorResponse(
          503,
          'O demo público do Vercel AI Gateway (labs) está indisponível. Defina VERCEL_AI_GATEWAY_API_KEY no ambiente para usar o AI Gateway direto (grátis em vercel.com/docs/ai-gateway).',
        )
      }

      return new Response(errorText, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (error) {
      return internalProviderErrorResponse('Gateway', error)
    }
  },
})

export default app.fetch
