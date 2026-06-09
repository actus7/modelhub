import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: true, tools: true }, id: 'grok-4', name: 'Grok 4' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'grok-3', name: 'Grok 3' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'grok-3-mini', name: 'Grok 3 mini' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'grok-code-fast-1', name: 'Grok Code Fast' },
]

const XAI_CHAT_URL = process.env.XAI_CHAT_URL || 'https://api.x.ai/v1/chat/completions'
const XAI_MODELS_URL = 'https://api.x.ai/v1/models'
const XAI_API_KEY = 'XAI_API_KEY'

const app = createProviderApp({
  providerId: 'xai',
  basePath: '/xai',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'xAI', chatUrl: XAI_CHAT_URL, apiKeyEnv: XAI_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({ modelsUrl: XAI_MODELS_URL, apiKeyEnv: XAI_API_KEY, providerName: 'xAI' }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: XAI_MODELS_URL, apiKeyEnv: XAI_API_KEY, providerName: 'xAI' }, credentials),
})

export default app.fetch
