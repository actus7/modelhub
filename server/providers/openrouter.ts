import { createProviderApp } from '../lib/provider-core'
import { buildOpenAiCompatibleChatBody, chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'
import { injectOpenRouterCacheControl } from '../lib/provider-quirks'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'openai/gpt-oss-20b:free', name: 'GPT OSS 20B (OpenRouter Free)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (OpenRouter Free)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'google/gemma-3-12b-it:free', name: 'Gemma 3 12B (OpenRouter Free)' },
]

const app = createProviderApp({
  providerId: 'openrouter',
  basePath: '/openrouter',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'OpenRouter',
        chatUrl: process.env.OPENROUTER_CHAT_URL || 'https://openrouter.ai/api/v1/chat/completions',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        extraHeaders: {
          'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://localhost',
          'X-Title': process.env.OPENROUTER_APP_NAME || 'ai-proxy',
        },
        // Modelos anthropic/* via OpenRouter suportam prompt caching transparente.
        bodyTransform: (input) =>
          injectOpenRouterCacheControl(buildOpenAiCompatibleChatBody(input), input.modelId),
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    providerName: 'OpenRouter',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://openrouter.ai/api/v1/models', apiKeyEnv: 'OPENROUTER_API_KEY', providerName: 'OpenRouter' },
      credentials,
    ),
})

export default app.fetch


