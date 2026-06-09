import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

// Z.ai GLM Coding Plan — conexão por *assinatura* (não metered).
// O plano usa o modo "token": o usuário cola a chave do Coding Plan e roteamos
// pelo endpoint OpenAI-compatível da Z.ai. Diferente do provider `zai`
// (pay-as-you-go), aqui o custo marginal é tratado como $0 (tarifa fixa).
export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'glm-4.6', name: 'GLM-4.6 (Coding Plan)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'glm-4.5', name: 'GLM-4.5 (Coding Plan)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'glm-4.5-air', name: 'GLM-4.5 Air (Coding Plan)' },
]

// Padrão: endpoint OpenAI-compatível padrão da Z.ai (aceita a chave do Coding Plan).
// Para o caminho dedicado de coding, sobrescreva via ZAI_CODING_CHAT_URL.
const ZAI_CODING_CHAT_URL = process.env.ZAI_CODING_CHAT_URL || 'https://api.z.ai/api/paas/v4/chat/completions'
const ZAI_CODING_MODELS_URL = process.env.ZAI_CODING_MODELS_URL || 'https://api.z.ai/api/paas/v4/models'
const ZAI_CODING_API_KEY = 'ZAI_CODING_API_KEY'

const app = createProviderApp({
  providerId: 'zaicoding',
  basePath: '/zaicoding',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Z.ai GLM Coding Plan', chatUrl: ZAI_CODING_CHAT_URL, apiKeyEnv: ZAI_CODING_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({ modelsUrl: ZAI_CODING_MODELS_URL, apiKeyEnv: ZAI_CODING_API_KEY, providerName: 'Z.ai GLM Coding Plan' }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: ZAI_CODING_MODELS_URL, apiKeyEnv: ZAI_CODING_API_KEY, providerName: 'Z.ai GLM Coding Plan' }, credentials),
})

export default app.fetch
