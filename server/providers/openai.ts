import { createProviderApp } from '../lib/provider-core'
import { buildOpenAiCompatibleChatBody, chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'
import { renameMaxTokensForOpenAi } from '../lib/provider-quirks'

export const models = [
  { capabilities: { documents: true, images: true, tools: true }, id: 'gpt-4o', name: 'GPT-4o' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'gpt-4o-mini', name: 'GPT-4o mini' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'gpt-4.1', name: 'GPT-4.1' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' },
  { capabilities: { documents: true, images: false, tools: true, reasoning: true }, id: 'o3', name: 'o3' },
  { capabilities: { documents: true, images: false, tools: true, reasoning: true }, id: 'o4-mini', name: 'o4-mini' },
]

const OPENAI_CHAT_URL = process.env.OPENAI_CHAT_URL || 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models'
const OPENAI_API_KEY = 'OPENAI_API_KEY'

const app = createProviderApp({
  providerId: 'openai',
  basePath: '/openai',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'OpenAI',
        chatUrl: OPENAI_CHAT_URL,
        apiKeyEnv: OPENAI_API_KEY,
        // o-series e GPT-5+ exigem max_completion_tokens no lugar de max_tokens.
        bodyTransform: (input) => renameMaxTokensForOpenAi(buildOpenAiCompatibleChatBody(input), input.modelId),
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: OPENAI_MODELS_URL,
    apiKeyEnv: OPENAI_API_KEY,
    providerName: 'OpenAI',
    // O catálogo da OpenAI inclui embeddings, tts, whisper, dall-e etc. — filtra só chat (gpt/o-series).
    filter: (m) => /^(gpt-|o\d|chatgpt)/i.test(m.id),
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: OPENAI_MODELS_URL, apiKeyEnv: OPENAI_API_KEY, providerName: 'OpenAI' }, credentials),
})

export default app.fetch
