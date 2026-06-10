import { createProviderApp } from '../lib/provider-core'
import { buildOpenAiCompatibleChatBody, chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'
import { normalizeMistralToolCallIds } from '../lib/provider-quirks'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'mistral-small-latest', name: 'Mistral Small Latest' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'ministral-3b-latest', name: 'Ministral 3B Latest' },
]

const app = createProviderApp({
  providerId: 'mistral',
  basePath: '/mistral',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'Mistral',
        chatUrl: process.env.MISTRAL_CHAT_URL || 'https://api.mistral.ai/v1/chat/completions',
        apiKeyEnv: 'MISTRAL_API_KEY',
        // A API da Mistral só aceita tool call IDs no formato [A-Za-z0-9]{9}.
        bodyTransform: (input) => normalizeMistralToolCallIds(buildOpenAiCompatibleChatBody(input)),
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://api.mistral.ai/v1/models',
    apiKeyEnv: 'MISTRAL_API_KEY',
    providerName: 'Mistral',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://api.mistral.ai/v1/models', apiKeyEnv: 'MISTRAL_API_KEY', providerName: 'Mistral' },
      credentials,
    ),
})

export default app.fetch

