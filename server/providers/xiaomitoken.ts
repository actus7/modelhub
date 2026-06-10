import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

const XIAOMI_TOKEN_PLAN_API_KEY = 'XIAOMI_TOKEN_PLAN_API_KEY'
const XIAOMI_TOKEN_PLAN_BASE_URL = process.env.XIAOMI_TOKEN_PLAN_BASE_URL || 'https://api.xiaomimimo.com'
const XIAOMI_TOKEN_PLAN_CHAT_URL = process.env.XIAOMI_TOKEN_PLAN_CHAT_URL || `${XIAOMI_TOKEN_PLAN_BASE_URL}/v1/chat/completions`
const XIAOMI_TOKEN_PLAN_MODELS_URL = process.env.XIAOMI_TOKEN_PLAN_MODELS_URL || `${XIAOMI_TOKEN_PLAN_BASE_URL}/v1/models`

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro (Token Plan)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'mimo-v2-pro', name: 'MiMo V2 Pro (Token Plan)' },
  { capabilities: { documents: true, images: false, tools: true, fast: true }, id: 'mimo-v2.5', name: 'MiMo V2.5 (Token Plan)' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'mimo-v2-omni', name: 'MiMo V2 Omni (Token Plan)' },
  { capabilities: { documents: true, images: false, tools: true, fast: true }, id: 'mimo-v2-flash', name: 'MiMo V2 Flash (Token Plan)' },
]

/** Exportado para o registry usar a mesma config (URLs/env) deste arquivo. */
export const fetchModels = createOpenAiFetchModels({
  modelsUrl: XIAOMI_TOKEN_PLAN_MODELS_URL,
  apiKeyEnv: XIAOMI_TOKEN_PLAN_API_KEY,
  providerName: 'Xiaomi MiMo Token Plan',
})

const app = createProviderApp({
  providerId: 'xiaomitoken',
  basePath: '/xiaomitoken',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Xiaomi MiMo Token Plan', chatUrl: XIAOMI_TOKEN_PLAN_CHAT_URL, apiKeyEnv: XIAOMI_TOKEN_PLAN_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: XIAOMI_TOKEN_PLAN_MODELS_URL, apiKeyEnv: XIAOMI_TOKEN_PLAN_API_KEY, providerName: 'Xiaomi MiMo Token Plan' },
      credentials,
    ),
})

export default app.fetch
