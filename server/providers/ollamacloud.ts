import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

const OLLAMA_CLOUD_API_KEY = 'OLLAMA_CLOUD_API_KEY'
const OLLAMA_CLOUD_MODELS_URL = process.env.OLLAMA_CLOUD_MODELS_URL || 'https://ollama.com/v1/models'

export const models = [
  { capabilities: { documents: true, images: false, tools: false }, id: 'gpt-oss:120b', name: 'GPT OSS 120B (Ollama Cloud)' },
  { capabilities: { documents: true, images: false, tools: false }, id: 'llama3.3:70b', name: 'Llama 3.3 70B (Ollama Cloud)' },
  { capabilities: { documents: true, images: false, tools: false }, id: 'qwen3-coder:latest', name: 'Qwen3 Coder (Ollama Cloud)' },
]

/** Exportado para o registry usar a mesma config (URLs/env) deste arquivo. */
export const fetchModels = createOpenAiFetchModels({
  modelsUrl: OLLAMA_CLOUD_MODELS_URL,
  apiKeyEnv: OLLAMA_CLOUD_API_KEY,
  providerName: 'Ollama Cloud',
})

const app = createProviderApp({
  providerId: 'ollamacloud',
  basePath: '/ollamacloud',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'Ollama Cloud',
        chatUrl: process.env.OLLAMA_CLOUD_CHAT_URL || 'https://ollama.com/v1/chat/completions',
        apiKeyEnv: OLLAMA_CLOUD_API_KEY,
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      {
        modelsUrl: OLLAMA_CLOUD_MODELS_URL,
        apiKeyEnv: OLLAMA_CLOUD_API_KEY,
        providerName: 'Ollama Cloud',
      },
      credentials,
    ),
})

export default app.fetch
