import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'qwen-max', name: 'Qwen Max' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'qwen-plus', name: 'Qwen Plus' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'qwen-turbo', name: 'Qwen Turbo' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus' },
  { capabilities: { documents: true, images: false, tools: false, reasoning: true }, id: 'qwq-32b', name: 'QwQ 32B' },
]

// DashScope (Alibaba) modo compatível com OpenAI. Endpoint internacional.
// Para a região China use QWEN_*_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/...
const QWEN_CHAT_URL = process.env.QWEN_CHAT_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'
const QWEN_MODELS_URL = process.env.QWEN_MODELS_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models'
const QWEN_API_KEY = 'DASHSCOPE_API_KEY'

const app = createProviderApp({
  providerId: 'qwen',
  basePath: '/qwen',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Qwen', chatUrl: QWEN_CHAT_URL, apiKeyEnv: QWEN_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({ modelsUrl: QWEN_MODELS_URL, apiKeyEnv: QWEN_API_KEY, providerName: 'Qwen' }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: QWEN_MODELS_URL, apiKeyEnv: QWEN_API_KEY, providerName: 'Qwen' }, credentials),
})

export default app.fetch
