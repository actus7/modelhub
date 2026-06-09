import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'deepseek-chat', name: 'DeepSeek V3' },
  { capabilities: { documents: true, images: false, tools: false, reasoning: true }, id: 'deepseek-reasoner', name: 'DeepSeek R1' },
]

const DEEPSEEK_CHAT_URL = process.env.DEEPSEEK_CHAT_URL || 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/v1/models'
const DEEPSEEK_API_KEY = 'DEEPSEEK_API_KEY'

const app = createProviderApp({
  providerId: 'deepseek',
  basePath: '/deepseek',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'DeepSeek', chatUrl: DEEPSEEK_CHAT_URL, apiKeyEnv: DEEPSEEK_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({ modelsUrl: DEEPSEEK_MODELS_URL, apiKeyEnv: DEEPSEEK_API_KEY, providerName: 'DeepSeek' }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: DEEPSEEK_MODELS_URL, apiKeyEnv: DEEPSEEK_API_KEY, providerName: 'DeepSeek' }, credentials),
})

export default app.fetch