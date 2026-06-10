import { createProviderApp } from '../lib/provider-core'
import { buildOpenAiCompatibleChatBody, chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'
import { normalizeMistralToolCallIds } from '../lib/provider-quirks'

export const models = [{ capabilities: { documents: true, images: false, tools: true }, id: 'codestral-latest', name: 'Codestral Latest' }]

const app = createProviderApp({
  providerId: 'codestral',
  basePath: '/codestral',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'Mistral Codestral',
        chatUrl: process.env.CODESTRAL_CHAT_URL || 'https://codestral.mistral.ai/v1/chat/completions',
        apiKeyEnv: 'CODESTRAL_API_KEY',
        // A API da Mistral só aceita tool call IDs no formato [A-Za-z0-9]{9}.
        bodyTransform: (input) => normalizeMistralToolCallIds(buildOpenAiCompatibleChatBody(input)),
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://codestral.mistral.ai/v1/models',
    apiKeyEnv: 'CODESTRAL_API_KEY',
    providerName: 'Mistral Codestral',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://codestral.mistral.ai/v1/models', apiKeyEnv: 'CODESTRAL_API_KEY', providerName: 'Mistral Codestral' },
      credentials,
    ),
})

export default app.fetch

