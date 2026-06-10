import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

const QWEN_TOKEN_PLAN_API_KEY = 'QWEN_TOKEN_PLAN_API_KEY'
const QWEN_TOKEN_PLAN_BASE_URL = process.env.QWEN_TOKEN_PLAN_BASE_URL || 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode'
const QWEN_TOKEN_PLAN_CHAT_URL = process.env.QWEN_TOKEN_PLAN_CHAT_URL || `${QWEN_TOKEN_PLAN_BASE_URL}/v1/chat/completions`
const QWEN_TOKEN_PLAN_MODELS_URL = process.env.QWEN_TOKEN_PLAN_MODELS_URL || `${QWEN_TOKEN_PLAN_BASE_URL}/v1/models`

export const models = [
  { capabilities: { documents: true, images: false, tools: true, reasoning: true }, id: 'qwen3.7-max', name: 'Qwen3.7 Max (Token Plan)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus (Token Plan)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'qwen3-coder-flash', name: 'Qwen3 Coder Flash (Token Plan)' },
]

/** Exportado para o registry usar a mesma config (URLs/env) deste arquivo. */
export const fetchModels = createOpenAiFetchModels({
  modelsUrl: QWEN_TOKEN_PLAN_MODELS_URL,
  apiKeyEnv: QWEN_TOKEN_PLAN_API_KEY,
  providerName: 'Qwen Token Plan',
})

const app = createProviderApp({
  providerId: 'qwentoken',
  basePath: '/qwentoken',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Qwen Token Plan', chatUrl: QWEN_TOKEN_PLAN_CHAT_URL, apiKeyEnv: QWEN_TOKEN_PLAN_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: QWEN_TOKEN_PLAN_MODELS_URL, apiKeyEnv: QWEN_TOKEN_PLAN_API_KEY, providerName: 'Qwen Token Plan' },
      credentials,
    ),
})

export default app.fetch
