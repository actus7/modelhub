import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false, tools: true, fast: true }, id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)' },
  { capabilities: { documents: true, images: false, tools: true, fast: true }, id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B (Groq)' },
]

const app = createProviderApp({
  providerId: 'groq',
  basePath: '/groq',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'Groq',
        chatUrl: process.env.GROQ_CHAT_URL || 'https://api.groq.com/openai/v1/chat/completions',
        apiKeyEnv: 'GROQ_API_KEY',
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    apiKeyEnv: 'GROQ_API_KEY',
    providerName: 'Groq',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://api.groq.com/openai/v1/models', apiKeyEnv: 'GROQ_API_KEY', providerName: 'Groq' },
      credentials,
    ),
})

export default app.fetch

