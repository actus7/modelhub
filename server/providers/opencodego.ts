import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

const OPENCODE_GO_API_KEY = 'OPENCODE_GO_API_KEY'
const OPENCODE_GO_BASE_URL = process.env.OPENCODE_GO_BASE_URL || 'https://opencode.ai/zen/go'
const OPENCODE_GO_MODELS_URL = process.env.OPENCODE_GO_MODELS_URL || `${OPENCODE_GO_BASE_URL}/v1/models`

export const models = [
  { capabilities: { documents: true, images: false, tools: true, reasoning: true }, id: 'glm-5.1', name: 'GLM-5.1 (OpenCode Go)' },
  { capabilities: { documents: true, images: false, tools: true, reasoning: true }, id: 'glm-5', name: 'GLM-5 (OpenCode Go)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'qwen3-coder-next', name: 'Qwen3 Coder Next (OpenCode Go)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'deepseek-v3.2', name: 'DeepSeek V3.2 (OpenCode Go)' },
]

/** Exportado para o registry usar a mesma config (URLs/env) deste arquivo. */
export const fetchModels = createOpenAiFetchModels({
  modelsUrl: OPENCODE_GO_MODELS_URL,
  apiKeyEnv: OPENCODE_GO_API_KEY,
  providerName: 'OpenCode Go',
})

const app = createProviderApp({
  providerId: 'opencodego',
  basePath: '/opencodego',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'OpenCode Go',
        chatUrl: process.env.OPENCODE_GO_CHAT_URL || `${OPENCODE_GO_BASE_URL}/v1/chat/completions`,
        apiKeyEnv: OPENCODE_GO_API_KEY,
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      {
        modelsUrl: OPENCODE_GO_MODELS_URL,
        apiKeyEnv: OPENCODE_GO_API_KEY,
        providerName: 'OpenCode Go',
      },
      credentials,
    ),
})

export default app.fetch
