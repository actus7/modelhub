export type ModelPrice = {
  inputPer1M: number
  outputPer1M: number
}

// Preços em USD por 1M tokens (input/output).
// Fonte: páginas de pricing públicas dos providers (junho 2025).
const PRICING: Record<string, Record<string, ModelPrice>> = {
  openai: {
    'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
    'gpt-4o-2024-11-20': { inputPer1M: 2.5, outputPer1M: 10 },
    'gpt-4o-2024-08-06': { inputPer1M: 2.5, outputPer1M: 10 },
    'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'gpt-4o-mini-2024-07-18': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'gpt-4-turbo': { inputPer1M: 10, outputPer1M: 30 },
    'gpt-4-turbo-preview': { inputPer1M: 10, outputPer1M: 30 },
    'gpt-4': { inputPer1M: 30, outputPer1M: 60 },
    'gpt-3.5-turbo': { inputPer1M: 0.5, outputPer1M: 1.5 },
    'o1': { inputPer1M: 15, outputPer1M: 60 },
    'o1-preview': { inputPer1M: 15, outputPer1M: 60 },
    'o1-mini': { inputPer1M: 3, outputPer1M: 12 },
    'o3': { inputPer1M: 10, outputPer1M: 40 },
    'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
    'o4-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
    'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
    'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
    'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
    'gpt-5': { inputPer1M: 10, outputPer1M: 40 },
  },
  anthropic: {
    'claude-opus-4-5': { inputPer1M: 15, outputPer1M: 75 },
    'claude-opus-4-8': { inputPer1M: 15, outputPer1M: 75 },
    'claude-opus-4': { inputPer1M: 15, outputPer1M: 75 },
    'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15 },
    'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
    'claude-sonnet-4': { inputPer1M: 3, outputPer1M: 15 },
    'claude-haiku-4-5': { inputPer1M: 0.8, outputPer1M: 4 },
    'claude-haiku-4': { inputPer1M: 0.8, outputPer1M: 4 },
    'claude-3-5-sonnet-20241022': { inputPer1M: 3, outputPer1M: 15 },
    'claude-3-5-sonnet-20240620': { inputPer1M: 3, outputPer1M: 15 },
    'claude-3-5-haiku-20241022': { inputPer1M: 0.8, outputPer1M: 4 },
    'claude-3-opus-20240229': { inputPer1M: 15, outputPer1M: 75 },
    'claude-3-sonnet-20240229': { inputPer1M: 3, outputPer1M: 15 },
    'claude-3-haiku-20240307': { inputPer1M: 0.25, outputPer1M: 1.25 },
  },
  google: {
    'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
    'gemini-2.5-pro-preview-05-06': { inputPer1M: 1.25, outputPer1M: 10 },
    'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'gemini-2.5-flash-preview-04-17': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
    'gemini-2.0-flash-exp': { inputPer1M: 0.1, outputPer1M: 0.4 },
    'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5 },
    'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
    'gemini-1.5-flash-8b': { inputPer1M: 0.0375, outputPer1M: 0.15 },
  },
  groq: {
    'llama-3.3-70b-versatile': { inputPer1M: 0.59, outputPer1M: 0.79 },
    'llama-3.1-70b-versatile': { inputPer1M: 0.59, outputPer1M: 0.79 },
    'llama-3.1-8b-instant': { inputPer1M: 0.05, outputPer1M: 0.08 },
    'llama3-70b-8192': { inputPer1M: 0.59, outputPer1M: 0.79 },
    'llama3-8b-8192': { inputPer1M: 0.05, outputPer1M: 0.08 },
    'mixtral-8x7b-32768': { inputPer1M: 0.24, outputPer1M: 0.24 },
    'gemma2-9b-it': { inputPer1M: 0.2, outputPer1M: 0.2 },
    'deepseek-r1-distill-llama-70b': { inputPer1M: 0.75, outputPer1M: 0.99 },
    'llama-3.3-70b-specdec': { inputPer1M: 0.59, outputPer1M: 0.99 },
  },
  mistral: {
    'mistral-large-latest': { inputPer1M: 2, outputPer1M: 6 },
    'mistral-medium-latest': { inputPer1M: 0.4, outputPer1M: 2 },
    'mistral-small-latest': { inputPer1M: 0.1, outputPer1M: 0.3 },
    'mistral-tiny': { inputPer1M: 0.25, outputPer1M: 0.25 },
    'open-mistral-7b': { inputPer1M: 0.25, outputPer1M: 0.25 },
    'open-mixtral-8x7b': { inputPer1M: 0.7, outputPer1M: 0.7 },
    'open-mixtral-8x22b': { inputPer1M: 2, outputPer1M: 6 },
    'codestral-latest': { inputPer1M: 0.3, outputPer1M: 0.9 },
    'pixtral-large-latest': { inputPer1M: 2, outputPer1M: 6 },
  },
  deepseek: {
    'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1 },
    'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },
    'deepseek-coder': { inputPer1M: 0.14, outputPer1M: 0.28 },
  },
  cohere: {
    'command-r-plus': { inputPer1M: 2.5, outputPer1M: 10 },
    'command-r': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'command': { inputPer1M: 1, outputPer1M: 2 },
    'command-light': { inputPer1M: 0.3, outputPer1M: 0.6 },
    'command-r-plus-08-2024': { inputPer1M: 2.5, outputPer1M: 10 },
    'command-r-08-2024': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'command-a-03-2025': { inputPer1M: 2.5, outputPer1M: 10 },
  },
  perplexity: {
    'sonar-pro': { inputPer1M: 3, outputPer1M: 15 },
    'sonar': { inputPer1M: 1, outputPer1M: 1 },
    'sonar-reasoning-pro': { inputPer1M: 2, outputPer1M: 8 },
    'sonar-reasoning': { inputPer1M: 1, outputPer1M: 5 },
    'sonar-deep-research': { inputPer1M: 2, outputPer1M: 8 },
    'llama-3.1-sonar-large-128k-online': { inputPer1M: 1, outputPer1M: 1 },
    'llama-3.1-sonar-small-128k-online': { inputPer1M: 0.2, outputPer1M: 0.2 },
  },
  together: {
    'meta-llama/Llama-3.3-70B-Instruct-Turbo': { inputPer1M: 0.88, outputPer1M: 0.88 },
    'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo': { inputPer1M: 0.88, outputPer1M: 0.88 },
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo': { inputPer1M: 0.18, outputPer1M: 0.18 },
    'mistralai/Mixtral-8x7B-Instruct-v0.1': { inputPer1M: 0.6, outputPer1M: 0.6 },
    'mistralai/Mistral-7B-Instruct-v0.3': { inputPer1M: 0.2, outputPer1M: 0.2 },
    'Qwen/Qwen2.5-72B-Instruct-Turbo': { inputPer1M: 1.2, outputPer1M: 1.2 },
  },
  fireworks: {
    'accounts/fireworks/models/llama-v3p3-70b-instruct': { inputPer1M: 0.9, outputPer1M: 0.9 },
    'accounts/fireworks/models/llama-v3p1-70b-instruct': { inputPer1M: 0.9, outputPer1M: 0.9 },
    'accounts/fireworks/models/llama-v3p1-8b-instruct': { inputPer1M: 0.2, outputPer1M: 0.2 },
    'accounts/fireworks/models/mixtral-8x7b-instruct': { inputPer1M: 0.5, outputPer1M: 0.5 },
    'accounts/fireworks/models/qwen2p5-72b-instruct': { inputPer1M: 0.9, outputPer1M: 0.9 },
    'accounts/fireworks/models/deepseek-r1': { inputPer1M: 3, outputPer1M: 8 },
  },
  openrouter: {
    'openai/gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
    'openai/gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'anthropic/claude-opus-4': { inputPer1M: 15, outputPer1M: 75 },
    'anthropic/claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15 },
    'google/gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
    'google/gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'meta-llama/llama-3.3-70b-instruct': { inputPer1M: 0.59, outputPer1M: 0.79 },
    'deepseek/deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1 },
    'deepseek/deepseek-r1': { inputPer1M: 0.55, outputPer1M: 2.19 },
    'mistralai/mistral-large': { inputPer1M: 2, outputPer1M: 6 },
  },
  'github-models': {
    'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
    'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'Meta-Llama-3.1-70B-Instruct': { inputPer1M: 0.59, outputPer1M: 0.79 },
    'Meta-Llama-3.1-8B-Instruct': { inputPer1M: 0.05, outputPer1M: 0.08 },
    'Mistral-large': { inputPer1M: 2, outputPer1M: 6 },
    'Mistral-small': { inputPer1M: 0.1, outputPer1M: 0.3 },
    'Phi-3.5-mini-instruct': { inputPer1M: 0.13, outputPer1M: 0.52 },
  },
  cerebras: {
    'llama3.1-8b': { inputPer1M: 0.1, outputPer1M: 0.1 },
    'llama3.1-70b': { inputPer1M: 0.6, outputPer1M: 0.6 },
    'llama-3.3-70b': { inputPer1M: 0.6, outputPer1M: 0.6 },
    'qwen-3-32b': { inputPer1M: 0.4, outputPer1M: 0.4 },
  },
  nvidia: {
    'meta/llama-3.1-70b-instruct': { inputPer1M: 0.35, outputPer1M: 0.4 },
    'meta/llama-3.3-70b-instruct': { inputPer1M: 0.35, outputPer1M: 0.4 },
    'meta/llama-3.1-8b-instruct': { inputPer1M: 0.1, outputPer1M: 0.1 },
    'mistralai/mistral-7b-instruct-v0.3': { inputPer1M: 0.15, outputPer1M: 0.15 },
    'deepseek-ai/deepseek-r1': { inputPer1M: 0.55, outputPer1M: 2.19 },
  },
  huggingface: {
    'meta-llama/Meta-Llama-3.1-70B-Instruct': { inputPer1M: 0.59, outputPer1M: 0.79 },
    'meta-llama/Meta-Llama-3.1-8B-Instruct': { inputPer1M: 0.05, outputPer1M: 0.08 },
    'mistralai/Mistral-7B-Instruct-v0.3': { inputPer1M: 0.2, outputPer1M: 0.2 },
    'Qwen/Qwen2.5-72B-Instruct': { inputPer1M: 1.2, outputPer1M: 1.2 },
  },
  ollama: {
    // Modelos locais são gratuitos
  },
}

export function getModelPrice(providerId: string, modelId: string): ModelPrice | null {
  const providerPricing = PRICING[providerId]
  if (!providerPricing) return null

  // Tentativa exata
  if (providerPricing[modelId]) return providerPricing[modelId]

  // Tentativa por prefixo: e.g. "claude-3-5-sonnet-20241022" → "claude-3-5-sonnet"
  for (const key of Object.keys(providerPricing)) {
    if (modelId.startsWith(key) || key.startsWith(modelId)) {
      return providerPricing[key]
    }
  }

  return null
}

export function calculateCostUsd(
  providerId: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = getModelPrice(providerId, modelId)
  if (!price) return null
  return (inputTokens * price.inputPer1M + outputTokens * price.outputPer1M) / 1_000_000
}
