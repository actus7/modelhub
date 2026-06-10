import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

const XAI_OAUTH_TOKEN = 'XAI_OAUTH_TOKEN'
const XAI_MODELS_URL = 'https://api.x.ai/v1/models'

export const models = [
  { capabilities: { documents: true, images: true, tools: true, reasoning: true }, id: 'grok-4', name: 'Grok 4 (Grok Subscription)' },
  { capabilities: { documents: true, images: true, tools: true, reasoning: true, fast: true }, id: 'grok-4-fast', name: 'Grok 4 Fast (Grok Subscription)' },
  { capabilities: { documents: true, images: true, tools: true, fast: true }, id: 'grok-code-fast-1', name: 'Grok Code Fast 1 (Grok Subscription)' },
]

const app = createProviderApp({
  providerId: 'xaisubscription',
  basePath: '/xaisubscription',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'xAI Grok Subscription',
        chatUrl: process.env.XAI_SUBSCRIPTION_CHAT_URL || 'https://api.x.ai/v1/chat/completions',
        apiKeyEnv: XAI_OAUTH_TOKEN,
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: XAI_MODELS_URL,
    apiKeyEnv: XAI_OAUTH_TOKEN,
    providerName: 'xAI Grok Subscription',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: XAI_MODELS_URL, apiKeyEnv: XAI_OAUTH_TOKEN, providerName: 'xAI Grok Subscription' },
      credentials,
    ),
})

export default app.fetch
