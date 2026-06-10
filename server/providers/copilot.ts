import { createProviderApp } from '../lib/provider-core'
import { buildOpenAiCompatibleChatBody, chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'
import { resolveCopilotToken } from '../lib/copilot-token'
import { renameMaxTokensForOpenAi } from '../lib/provider-quirks'

const COPILOT_TOKEN = 'COPILOT_TOKEN'
const COPILOT_HEADERS = {
  'Copilot-Integration-Id': 'vscode-chat',
  'Editor-Plugin-Version': 'copilot/1.300.0',
  'Editor-Version': 'vscode/1.104.0',
}

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'copilot/claude-opus-4.6', name: 'Claude Opus 4.6 (GitHub Copilot)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'copilot/claude-sonnet-4.6', name: 'Claude Sonnet 4.6 (GitHub Copilot)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'copilot/claude-haiku-4.5', name: 'Claude Haiku 4.5 (GitHub Copilot)' },
  { capabilities: { documents: true, images: true, tools: true, reasoning: true }, id: 'copilot/gpt-5.4', name: 'GPT-5.4 (GitHub Copilot)' },
  { capabilities: { documents: true, images: true, tools: true, reasoning: true }, id: 'copilot/gpt-5-mini', name: 'GPT-5 Mini (GitHub Copilot)' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'copilot/gpt-4.1', name: 'GPT-4.1 (GitHub Copilot)' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'copilot/gpt-4o', name: 'GPT-4o (GitHub Copilot)' },
  { capabilities: { documents: true, images: true, tools: true, fast: true }, id: 'copilot/gpt-4o-mini', name: 'GPT-4o Mini (GitHub Copilot)' },
  { capabilities: { documents: true, images: true, tools: true, reasoning: true }, id: 'copilot/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview (GitHub Copilot)' },
  { capabilities: { documents: true, images: false, tools: true, fast: true }, id: 'copilot/grok-code-fast-1', name: 'Grok Code Fast 1 (GitHub Copilot)' },
]

/** Exportado para o registry usar a mesma config (headers/exchange/filtro) deste arquivo. */
export const fetchModels = createOpenAiFetchModels({
  modelsUrl: 'https://api.githubcopilot.com/models',
  apiKeyEnv: COPILOT_TOKEN,
  providerName: 'GitHub Copilot',
  extraHeaders: COPILOT_HEADERS,
  resolveApiKey: resolveCopilotToken,
  filter: (model) => !/embedding|moderation|search/i.test(model.id),
})

const app = createProviderApp({
  providerId: 'copilot',
  basePath: '/copilot',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'GitHub Copilot',
        chatUrl: process.env.COPILOT_CHAT_URL || 'https://api.githubcopilot.com/chat/completions',
        apiKeyEnv: COPILOT_TOKEN,
        extraHeaders: COPILOT_HEADERS,
        // Aceita o token OAuth do GitHub (gho_/ghu_/...) e troca por um token
        // Copilot de curta duração sob demanda (cacheado até perto de expirar).
        resolveApiKey: resolveCopilotToken,
        // Copilot proxia GPT-5+/o-series à OpenAI, que exige max_completion_tokens.
        bodyTransform: (input) => renameMaxTokensForOpenAi(buildOpenAiCompatibleChatBody(input), input.modelId),
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      {
        modelsUrl: 'https://api.githubcopilot.com/models',
        apiKeyEnv: COPILOT_TOKEN,
        providerName: 'GitHub Copilot',
        extraHeaders: COPILOT_HEADERS,
        resolveApiKey: resolveCopilotToken,
      },
      credentials,
    ),
})

export default app.fetch
