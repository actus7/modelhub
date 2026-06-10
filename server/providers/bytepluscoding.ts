import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

const BYTEPLUS_CODING_API_KEY = 'BYTEPLUS_CODING_API_KEY'
const BYTEPLUS_CODING_BASE_URL = process.env.BYTEPLUS_CODING_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/coding'
const BYTEPLUS_CODING_CHAT_URL = process.env.BYTEPLUS_CODING_CHAT_URL || `${BYTEPLUS_CODING_BASE_URL}/v3/chat/completions`
const BYTEPLUS_CODING_MODELS_URL = process.env.BYTEPLUS_CODING_MODELS_URL || `${BYTEPLUS_CODING_BASE_URL}/v3/models`

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'ark-code-latest', name: 'Ark Code Latest (ModelArk Coding Plan)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'bytedance-seed-code', name: 'ByteDance Seed Code (ModelArk Coding Plan)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'glm-5.1', name: 'GLM-5.1 (ModelArk Coding Plan)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'deepseek-v3.2', name: 'DeepSeek V3.2 (ModelArk Coding Plan)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'kimi-k2.5', name: 'Kimi K2.5 (ModelArk Coding Plan)' },
]

/** Exportado para o registry usar a mesma config (URLs/env) deste arquivo. */
export const fetchModels = createOpenAiFetchModels({
  modelsUrl: BYTEPLUS_CODING_MODELS_URL,
  apiKeyEnv: BYTEPLUS_CODING_API_KEY,
  providerName: 'BytePlus ModelArk Coding Plan',
})

const app = createProviderApp({
  providerId: 'bytepluscoding',
  basePath: '/bytepluscoding',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'BytePlus ModelArk Coding Plan', chatUrl: BYTEPLUS_CODING_CHAT_URL, apiKeyEnv: BYTEPLUS_CODING_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: BYTEPLUS_CODING_MODELS_URL, apiKeyEnv: BYTEPLUS_CODING_API_KEY, providerName: 'BytePlus ModelArk Coding Plan' },
      credentials,
    ),
})

export default app.fetch
