import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'kimi-k2-0711-preview', name: 'Kimi K2' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'moonshot-v1-128k', name: 'Moonshot v1 128k' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'moonshot-v1-32k', name: 'Moonshot v1 32k' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'moonshot-v1-8k', name: 'Moonshot v1 8k' },
]

// Endpoint internacional (.ai). Para contas China use MOONSHOT_CHAT_URL=https://api.moonshot.cn/v1/chat/completions
const MOONSHOT_CHAT_URL = process.env.MOONSHOT_CHAT_URL || 'https://api.moonshot.ai/v1/chat/completions'
const MOONSHOT_MODELS_URL = process.env.MOONSHOT_MODELS_URL || 'https://api.moonshot.ai/v1/models'
const MOONSHOT_API_KEY = 'MOONSHOT_API_KEY'

const app = createProviderApp({
  providerId: 'moonshot',
  basePath: '/moonshot',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Moonshot', chatUrl: MOONSHOT_CHAT_URL, apiKeyEnv: MOONSHOT_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({ modelsUrl: MOONSHOT_MODELS_URL, apiKeyEnv: MOONSHOT_API_KEY, providerName: 'Moonshot' }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: MOONSHOT_MODELS_URL, apiKeyEnv: MOONSHOT_API_KEY, providerName: 'Moonshot' }, credentials),
})

export default app.fetch
