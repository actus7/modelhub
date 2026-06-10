import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

const COMMAND_CODE_API_KEY = 'COMMAND_CODE_API_KEY'
const COMMAND_CODE_BASE_URL = process.env.COMMAND_CODE_BASE_URL || 'https://api.commandcode.ai/provider'
const COMMAND_CODE_CHAT_URL = process.env.COMMAND_CODE_CHAT_URL || `${COMMAND_CODE_BASE_URL}/v1/chat/completions`
const COMMAND_CODE_MODELS_URL = process.env.COMMAND_CODE_MODELS_URL || `${COMMAND_CODE_BASE_URL}/v1/models`

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (Command Code)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'gpt-5.4', name: 'GPT-5.4 (Command Code)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'kimi-k2.5', name: 'Kimi K2.5 (Command Code)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'deepseek-v3.2', name: 'DeepSeek V3.2 (Command Code)' },
]

/** Exportado para o registry usar a mesma config (URLs/env) deste arquivo. */
export const fetchModels = createOpenAiFetchModels({
  modelsUrl: COMMAND_CODE_MODELS_URL,
  apiKeyEnv: COMMAND_CODE_API_KEY,
  providerName: 'Command Code',
})

const app = createProviderApp({
  providerId: 'commandcode',
  basePath: '/commandcode',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Command Code', chatUrl: COMMAND_CODE_CHAT_URL, apiKeyEnv: COMMAND_CODE_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: COMMAND_CODE_MODELS_URL, apiKeyEnv: COMMAND_CODE_API_KEY, providerName: 'Command Code' },
      credentials,
    ),
})

export default app.fetch
