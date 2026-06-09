import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'glm-4.6', name: 'GLM-4.6' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'glm-4.5', name: 'GLM-4.5' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'glm-4.5-air', name: 'GLM-4.5 Air' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'glm-4-flash', name: 'GLM-4 Flash' },
]

// Z.ai (Zhipu) — endpoint OpenAI-compatível v4. Internacional (api.z.ai).
const ZAI_CHAT_URL = process.env.ZAI_CHAT_URL || 'https://api.z.ai/api/paas/v4/chat/completions'
const ZAI_MODELS_URL = process.env.ZAI_MODELS_URL || 'https://api.z.ai/api/paas/v4/models'
const ZAI_API_KEY = 'ZAI_API_KEY'

const app = createProviderApp({
  providerId: 'zai',
  basePath: '/zai',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Z.ai', chatUrl: ZAI_CHAT_URL, apiKeyEnv: ZAI_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  // Alguns endpoints Zhipu não expõem /models — se falhar, o cache cai na lista estática acima.
  fetchModels: createOpenAiFetchModels({ modelsUrl: ZAI_MODELS_URL, apiKeyEnv: ZAI_API_KEY, providerName: 'Z.ai' }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: ZAI_MODELS_URL, apiKeyEnv: ZAI_API_KEY, providerName: 'Z.ai' }, credentials),
})

export default app.fetch
