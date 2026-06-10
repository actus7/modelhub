import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

const NVIDIA_NIM_MODELS_URL = 'https://integrate.api.nvidia.com/v1/models'
const NON_CHAT_MODEL_RE = /(^|[/-])(embed|embedding|rerank|retrieval|retriever)([/-]|$)|content-safety|guardrail|moderation/i

export function isNvidiaNimChatModel(model: { id: string }): boolean {
  return !NON_CHAT_MODEL_RE.test(model.id)
}

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super 120B A12B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', name: 'Nemotron Super 49B v1.5' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', name: 'Nemotron Ultra 253B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B Instruct' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'nvidia/nemotron-3-nano-30b-a3b', name: 'Nemotron-3 Nano 30B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'nvidia/nemotron-nano-9b-v2', name: 'Nemotron Nano 9B v2' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'nvidia/llama-3.1-nemotron-nano-8b-v1', name: 'Nemotron Nano 8B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'deepseek-ai/deepseek-v3.2', name: 'DeepSeek V3.2' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'deepseek-ai/deepseek-v3.1', name: 'DeepSeek V3.1' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'mistralai/mistral-large-3-675b-instruct-2512', name: 'Mistral Large 3 675B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'mistralai/devstral-2-123b-instruct-2512', name: 'Devstral 2 123B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'mistralai/mistral-small-31-24b-instruct-2503', name: 'Mistral Small 31 24B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2 Instruct' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'google/gemma-3-27b-it', name: 'Gemma 3 27B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B' },
]

const FALLBACK_MODEL_IDS = [
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'nvidia/nemotron-nano-9b-v2',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'meta/llama-3.3-70b-instruct',
]

const app = createProviderApp({
  providerId: 'nvidianim',
  basePath: '/nvidianim',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'NVIDIA NIM',
        chatUrl:
          process.env.NVIDIA_NIM_CHAT_URL || 'https://integrate.api.nvidia.com/v1/chat/completions',
        apiKeyEnv: 'NVIDIA_NIM_API_KEY',
        fallbackModelIds: FALLBACK_MODEL_IDS,
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: NVIDIA_NIM_MODELS_URL,
    apiKeyEnv: 'NVIDIA_NIM_API_KEY',
    providerName: 'NVIDIA NIM',
    filter: isNvidiaNimChatModel,
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: NVIDIA_NIM_MODELS_URL, apiKeyEnv: 'NVIDIA_NIM_API_KEY', providerName: 'NVIDIA NIM' },
      credentials,
    ),
})

export default app.fetch
