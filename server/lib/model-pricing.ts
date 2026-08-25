import { getOpenRouterPrice } from './openrouter-pricing'
import { matchPattern } from './model-capabilities'

export type ModelPrice = {
  inputPer1M: number
  outputPer1M: number
}

// ---------------------------------------------------------------------------
// 9router pricing types — richer model pricing with cached/reasoning rates
// ---------------------------------------------------------------------------

export interface ModelPricing9R {
  input: number      // $/1M tokens
  output: number     // $/1M tokens
  cached?: number    // $/1M tokens (cache hit)
  reasoning?: number // $/1M tokens (reasoning/thinking tokens)
  cache_creation?: number // $/1M tokens (cache write)
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
  xai: {
    'grok-4': { inputPer1M: 3, outputPer1M: 15 },
    'grok-3': { inputPer1M: 3, outputPer1M: 15 },
    'grok-3-mini': { inputPer1M: 0.3, outputPer1M: 0.5 },
    'grok-code-fast-1': { inputPer1M: 0.2, outputPer1M: 1.5 },
    'grok-2-vision': { inputPer1M: 2, outputPer1M: 10 },
  },
  moonshot: {
    'kimi-k2-0711-preview': { inputPer1M: 0.6, outputPer1M: 2.5 },
    'moonshot-v1-128k': { inputPer1M: 2, outputPer1M: 5 },
    'moonshot-v1-32k': { inputPer1M: 1, outputPer1M: 3 },
    'moonshot-v1-8k': { inputPer1M: 0.2, outputPer1M: 2 },
  },
  qwen: {
    'qwen-max': { inputPer1M: 1.6, outputPer1M: 6.4 },
    'qwen-plus': { inputPer1M: 0.4, outputPer1M: 1.2 },
    'qwen-turbo': { inputPer1M: 0.05, outputPer1M: 0.2 },
    'qwen3-coder-plus': { inputPer1M: 1, outputPer1M: 5 },
    'qwq-32b': { inputPer1M: 0.2, outputPer1M: 0.6 },
  },
  zai: {
    'glm-4.6': { inputPer1M: 0.6, outputPer1M: 2.2 },
    'glm-4.5': { inputPer1M: 0.6, outputPer1M: 2.2 },
    'glm-4.5-air': { inputPer1M: 0.2, outputPer1M: 1.1 },
    'glm-4-flash': { inputPer1M: 0, outputPer1M: 0 },
  },
  zaicoding: {
    // Assinatura (GLM Coding Plan) — tarifa fixa, custo marginal $0 por chamada.
    'glm-4.6': { inputPer1M: 0, outputPer1M: 0 },
    'glm-4.5': { inputPer1M: 0, outputPer1M: 0 },
    'glm-4.5-air': { inputPer1M: 0, outputPer1M: 0 },
  },
  ollama: {
    // Modelos locais são gratuitos
  },
}

export function getModelPrice(providerId: string, modelId: string): ModelPrice | null {
  const providerPricing = PRICING[providerId]
  if (providerPricing) {
    // Tentativa exata
    if (providerPricing[modelId]) return providerPricing[modelId]

    // Tentativa por prefixo — chaves mais longas têm prioridade para evitar "o1" engolir "o1-mini"
    const sortedKeys = Object.keys(providerPricing).sort((a, b) => b.length - a.length)
    for (const key of sortedKeys) {
      if (modelId.startsWith(key) || key.startsWith(modelId)) {
        return providerPricing[key]
      }
    }
  }

  // Fallback: cache dinâmico do OpenRouter (preenchido sob demanda).
  return getOpenRouterPrice(providerId, modelId)
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

// ===========================================================================
// 9router pricing system — canonical model pricing with pattern fallback
// Ported from 9router open-sse/providers/pricing.js
// ===========================================================================

/**
 * Canonical model pricing — provider-agnostic. All rates in $/1M tokens.
 */
export const MODEL_PRICING: Record<string, ModelPricing9R> = {
  // === Anthropic / Claude ===
  'claude-opus-4-6':              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  'claude-opus-4-5-20251101':     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  'claude-sonnet-4-6':            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  'claude-sonnet-4-5-20250929':   { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  'claude-haiku-4-5-20251001':    { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  },
  'claude-sonnet-4-20250514':     { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  'claude-opus-4-20250514':       { input: 15.00, output: 25.00, cached: 7.50,  reasoning: 112.50, cache_creation: 15.00 },
  'claude-3-5-sonnet-20241022':   { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  'claude-haiku-4.5':             { input: 0.50,  output: 2.50,  cached: 0.05,  reasoning: 3.75,   cache_creation: 0.50  },
  'claude-opus-4.1':              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  'claude-opus-4.5':              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  'claude-opus-4.6':              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  'claude-sonnet-4':              { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  'claude-sonnet-4.5':            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  'claude-sonnet-4.6':            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  'claude-opus-4-5-thinking':     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  'claude-opus-4-6-thinking':     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  'claude-fable-5':               { input: 10.00, output: 50.00, cached: 1.00,  reasoning: 50.00,  cache_creation: 12.50 },

  // === OpenAI / GPT ===
  'gpt-3.5-turbo':                { input: 0.50,  output: 1.50,  cached: 0.25,  reasoning: 2.25,   cache_creation: 0.50  },
  'gpt-4':                        { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  'gpt-4-turbo':                  { input: 10.00, output: 30.00, cached: 5.00,  reasoning: 45.00,  cache_creation: 10.00 },
  'gpt-4o':                       { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  'gpt-4o-mini':                  { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90,   cache_creation: 0.15  },
  'gpt-4.1':                      { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  },
  'gpt-5':                        { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  },
  'gpt-5-mini':                   { input: 0.25,  output: 2.00,  cached: 0.125, reasoning: 2.00,   cache_creation: 0.25  },
  'gpt-5-codex':                  { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  },
  'gpt-5.1':                      { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  },
  'gpt-5.1-codex':                { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  },
  'gpt-5.1-codex-mini':           { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  'gpt-5.1-codex-mini-high':      { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },
  'gpt-5.1-codex-max':            { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  'gpt-5.2':                      { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  'gpt-5.2-codex':                { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  'gpt-5.3-codex':                { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  'gpt-5.3-codex-spark':         { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  },
  'gpt-5.6':                      { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 2.50  },
  'gpt-5.6-luna':                 { input: 1.00,  output: 6.00,  cached: 0.10,  reasoning: 6.00,   cache_creation: 1.00  },
  'gpt-5.6-terra':                { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 2.50  },
  'gpt-5.6-sol':                  { input: 5.00,  output: 30.00, cached: 0.50,  reasoning: 30.00,  cache_creation: 5.00  },
  o1:                             { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00,  cache_creation: 15.00 },
  'o1-mini':                      { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  },

  // === Gemini ===
  'gemini-3.7-flash':              { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  'gemini-3.7-flash-high':         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  'gemini-3.7-flash-medium':       { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  'gemini-3.7-flash-low':          { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  'gemini-3.6-flash':              { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  'gemini-3.6-flash-high':         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  'gemini-3.6-flash-medium':       { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  'gemini-3.6-flash-low':          { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  'gemini-3.5-flash-lite':         { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.375 },
  'gemini-3.5-flash-high':         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  'gemini-3-flash-preview':        { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  'gemini-3-pro-preview':         { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  'gemini-3.1-pro-low':           { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  'gemini-3.1-pro-high':          { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  'gemini-pro-agent':             { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  'gemini-3-flash-agent':         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  'gemini-3.5-flash-low':         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  'gemini-3.5-flash-extra-low':   { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  'gemini-3-flash':               { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  'gemini-2.5-pro':               { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  'gemini-2.5-flash':             { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  },
  'gemini-2.5-flash-lite':        { input: 0.15,  output: 1.25,  cached: 0.015, reasoning: 1.875,  cache_creation: 0.15  },

  // === Qwen ===
  'qwen3-coder-plus':             { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  'qwen3-coder-flash':            { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  // === Kimi ===
  'kimi-k3':                      { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  },
  k3:                             { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  },
  'kimi-k2.7-code':               { input: 0.95,  output: 4.00,  cached: 0.19,  reasoning: 4.00,   cache_creation: 0.95  },
  'kimi-k2.7-code-highspeed':     { input: 1.90,  output: 8.00,  cached: 0.38,  reasoning: 8.00,   cache_creation: 1.90  },
  'kimi-for-coding':              { input: 0.95,  output: 4.00,  cached: 0.19,  reasoning: 4.00,   cache_creation: 0.95  },
  'kimi-for-coding-highspeed':    { input: 1.90,  output: 8.00,  cached: 0.38,  reasoning: 8.00,   cache_creation: 1.90  },
  'kimi-k2':                      { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  'kimi-k2-thinking':             { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  'kimi-k2.5':                    { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  },
  'kimi-k2.5-thinking':           { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  },
  'kimi-k2.6':                    { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  'kimi-latest':                  { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },

  // === DeepSeek ===
  'deepseek-chat':                { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
  'deepseek-reasoner':            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
  'deepseek-r1':                  { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
  'deepseek-v3.2-chat':           { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
  'deepseek-v3.2-reasoner':       { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
  'deepseek-v4-flash':            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
  'deepseek-v4-pro':              { input: 0.435, output: 0.87,  cached: 0.003625, reasoning: 0.87, cache_creation: 0.435 },

  // === GLM ===
  'glm-4.6':                      { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  'glm-4.6v':                     { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  },
  'glm-4.7':                      { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  },
  'glm-5':                        { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },

  // === MiniMax ===
  'MiniMax-M3':                   { input: 0.30,  output: 1.20,  cached: 0.06,  reasoning: 1.80,   cache_creation: 0.30  },
  'MiniMax-M2.1':                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  'MiniMax-M2.5':                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  'MiniMax-M2.7':                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  'minimax-m2.1':                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  'minimax-m2.5':                 { input: 0.60,  output: 2.40,  cached: 0.30,  reasoning: 3.60,   cache_creation: 0.60  },

  // === Grok ===
  'grok-code-fast-1':             { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  // === OpenRouter fallback ===
  auto:                           { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },

  // === Misc ===
  'oswe-vscode-prime':            { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  'gpt-oss-120b-medium':          { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  'vision-model':                 { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  'coder-model':                  { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
}

/**
 * Provider-specific pricing overrides (only entries where price DIFFERS from MODEL_PRICING).
 */
export const PROVIDER_PRICING: Record<string, Record<string, ModelPricing9R>> = {
  gh: {
    'gpt-5.3-codex': { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 },
  },
  tokenrouter: {
    'MiniMax-M3': { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    'anthropic/claude-fable-5': { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    'anthropic/claude-haiku-4.5': { input: 1.0, output: 5.0, cached: 0.1, cache_creation: 1.25, reasoning: 5.0 },
    'anthropic/claude-opus-4.5': { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    'anthropic/claude-opus-4.6': { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    'anthropic/claude-opus-4.7': { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    'anthropic/claude-opus-4.7-fast': { input: 30, output: 150, cached: 3.0, reasoning: 150 },
    'anthropic/claude-opus-4.8': { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    'anthropic/claude-opus-4.8-fast': { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    'anthropic/claude-opus-5': { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    'anthropic/claude-opus-5-fast': { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    'anthropic/claude-sonnet-4': { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    'anthropic/claude-sonnet-4.5': { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    'anthropic/claude-sonnet-4.6': { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    'anthropic/claude-sonnet-5': { input: 2, output: 10, cached: 0.2, reasoning: 10 },
    'claude-opus-4-8-m-aws': { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    'deepseek/deepseek-v3.2': { input: 0.26, output: 0.38, cached: 0.13, reasoning: 0.38 },
    'deepseek/deepseek-v4-flash': { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    'deepseek/deepseek-v4-flash-0731': { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    'deepseek/deepseek-v4-pro': { input: 0.435, output: 0.87, cached: 0.003625, reasoning: 0.87 },
    'ex/gpt-5.4': { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    'google/gemini-2.5-flash-image': { input: 0.3, output: 2.5, reasoning: 2.5 },
    'google/gemini-3-flash-preview': { input: 0.5, output: 3.0, cached: 0.05, cache_creation: 0.08333, reasoning: 3.0 },
    'google/gemini-3-pro-image-preview': { input: 2, output: 12, reasoning: 12 },
    'google/gemini-3.1-flash-image-preview': { input: 0.5, output: 3.0, reasoning: 3.0 },
    'google/gemini-3.1-flash-lite-image': { input: 0.25, output: 1.5, reasoning: 1.5 },
    'google/gemini-3.1-pro-preview': { input: 2, output: 12, cached: 0.2, cache_creation: 0.375, reasoning: 12 },
    'google/gemini-3.5-flash': { input: 1.5, output: 9.0, cached: 0.15, cache_creation: 0.08333, reasoning: 9.0 },
    'google/gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cached: 0.03, cache_creation: 0.08333, reasoning: 2.5 },
    'google/gemini-3.6-flash': { input: 1.5, output: 7.5, cached: 0.15, cache_creation: 0.08333, reasoning: 7.5 },
    'google/gemini-embedding-2': { input: 1.0, output: 6.0, cached: 0.1, reasoning: 6.0 },
    'google/gemma-4-26b-a4b-it': { input: 0.06, output: 0.33, reasoning: 0.33 },
    'kling-3.0-turbo': { input: 2.1, output: 2.1, reasoning: 2.1 },
    'microsoft/mai-image-2.5': { input: 5.0, output: 47.0, reasoning: 47.0 },
    'minimax/minimax-m2-her': { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    'minimax/minimax-m2.1': { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    'minimax/minimax-m2.1-highspeed': { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    'minimax/minimax-m2.5': { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    'minimax/minimax-m2.7': { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    'minimax/minimax-m2.7-highspeed': { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    'miromind/mirothinker-1-7-deepresearch': { input: 4, output: 25.0, reasoning: 25.0 },
    'miromind/mirothinker-1-7-deepresearch-mini': { input: 1.25, output: 10.0, reasoning: 10.0 },
    'mistralai/devstral-2512': { input: 0.4, output: 2.0, cached: 0.04, reasoning: 2.0 },
    'mistralai/mistral-medium-3-5': { input: 1.5, output: 7.5, reasoning: 7.5 },
    'mistralai/mistral-small-2603': { input: 0.15, output: 0.6, cached: 0.015, reasoning: 0.6 },
    'mistralai/voxtral-small-24b-2507': { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    'moonshotai/kimi-k2.5': { input: 0.6, output: 3.0, cached: 0.1, reasoning: 3.0 },
    'moonshotai/kimi-k2.6': { input: 0.95, output: 4.0, cached: 0.16, reasoning: 4.0 },
    'moonshotai/kimi-k2.7-code': { input: 0.9286, output: 3.8571, cached: 0.1857, reasoning: 3.8571 },
    'moonshotai/kimi-k3': { input: 3.0, output: 15.0, cached: 0.3, reasoning: 15.0 },
    'nvidia/nemotron-3-super-120b-a12b': { input: 0.3, output: 0.9, cached: 0.1, reasoning: 0.9 },
    'openai/gpt-4o-mini': { input: 0.15, output: 0.6, cached: 0.075, reasoning: 0.6 },
    'openai/gpt-5': { input: 1.25, output: 10.0, cached: 0.125, reasoning: 10.0 },
    'openai/gpt-5-image': { input: 10, output: 40, cached: 2.5, reasoning: 40 },
    'openai/gpt-5-image-mini': { input: 2.5, output: 8.0, cached: 0.25, reasoning: 8.0 },
    'openai/gpt-5-mini': { input: 0.25, output: 2.0, cached: 0.025, reasoning: 2.0 },
    'openai/gpt-5.2': { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    'openai/gpt-5.3-codex': { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    'openai/gpt-5.4': { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    'openai/gpt-5.4-image-2': { input: 8, output: 30.0, cached: 2.0, reasoning: 30.0 },
    'openai/gpt-5.4-mini': { input: 0.75, output: 4.5, cached: 0.075, reasoning: 4.5 },
    'openai/gpt-5.4-nano': { input: 0.2, output: 1.25, cached: 0.02, reasoning: 1.25 },
    'openai/gpt-5.4-pro': { input: 30, output: 180, reasoning: 180 },
    'openai/gpt-5.5': { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    'openai/gpt-5.5-pro': { input: 30, output: 180, reasoning: 180 },
    'openai/gpt-5.6-luna': { input: 0.2, output: 1.2, cached: 0.02, cache_creation: 0.25, reasoning: 1.2 },
    'openai/gpt-5.6-sol': { input: 5.0, output: 30.0, cached: 0.5, cache_creation: 6.25, reasoning: 30.0 },
    'openai/gpt-5.6-terra': { input: 2, output: 12, cached: 0.2, cache_creation: 2.5, reasoning: 12 },
    'openai/gpt-audio': { input: 2.5, output: 10.0, reasoning: 10.0 },
    'openai/gpt-audio-mini': { input: 0.6, output: 2.4, reasoning: 2.4 },
    'openai/gpt-oss-120b': { input: 0.039, output: 0.18, reasoning: 0.18 },
    'qwen/qwen3-coder-next': { input: 0.12, output: 0.75, cached: 0.06, reasoning: 0.75 },
    'qwen/qwen3.5-122b-a10b': { input: 0.26, output: 2.08, reasoning: 2.08 },
    'qwen/qwen3.5-35b-a3b': { input: 0.1625, output: 1.3, reasoning: 1.3 },
    'qwen/qwen3.5-397b-a17b': { input: 0.39, output: 2.34, reasoning: 2.34 },
    'qwen/qwen3.5-9b': { input: 0.1, output: 0.15, reasoning: 0.15 },
    'qwen/qwen3.5-flash': { input: 0.1048, output: 0.4194, reasoning: 0.4194 },
    'qwen/qwen3.5-plus-02-15': { input: 0.26, output: 1.56, reasoning: 1.56 },
    'qwen/qwen3.6-plus': { input: 0.54, output: 3.21, reasoning: 3.21 },
    'qwen/qwen3.7-max': { input: 1.25, output: 3.75, cached: 0.25, reasoning: 3.75 },
    'qwen/qwen3.7-plus': { input: 0.4, output: 1.6, cached: 0.08, reasoning: 1.6 },
    'qwen/qwen3.8-max': { input: 2, output: 6, cached: 0.25, cache_creation: 2.5, reasoning: 6 },
    'qwen3.5-omni-plus': { input: 1.0, output: 5.7143, reasoning: 5.7143 },
    'qwen3.6-flash': { input: 0.171, output: 1.029, cached: 0.017, cache_creation: 0.214, reasoning: 1.029 },
    'sakana/fugu-ultra': { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    'seed-2-0-code-preview-260328': { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    'seed-2-0-lite-260428': { input: 0.5, output: 4.0, cached: 0.1, cache_creation: 0.008333, reasoning: 4.0 },
    'seed-2-0-mini-260428': { input: 0.2, output: 0.8, cached: 0.04, cache_creation: 0.00833, reasoning: 0.8 },
    'seed-2-0-pro-260328': { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    'stepfun/step-3.5-flash': { input: 0.1, output: 0.3, cached: 0.02, reasoning: 0.3 },
    'stepfun/step-3.7-flash': { input: 0.2, output: 1.15, cached: 0.04, reasoning: 1.15 },
    'tencent/hy3-preview': { input: 0.066, output: 0.26, cached: 0.029, reasoning: 0.26 },
    'x-ai/grok-4.1-fast': { input: 0.2, output: 0.5, cached: 0.05, reasoning: 0.5 },
    'x-ai/grok-4.20-beta': { input: 2, output: 6, cached: 0.2, reasoning: 6 },
    'x-ai/grok-4.3': { input: 1.25, output: 2.5, cached: 0.2, reasoning: 2.5 },
    'x-ai/grok-4.5': { input: 2, output: 6, cached: 0.5, reasoning: 6 },
    'x-ai/grok-build-0.1': { input: 1.0, output: 2.0, cached: 0.2, reasoning: 2.0 },
    'xiaomi/mimo-v2-flash': { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    'xiaomi/mimo-v2-omni': { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    'xiaomi/mimo-v2-pro': { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    'xiaomi/mimo-v2.5': { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    'xiaomi/mimo-v2.5-pro': { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    'z-ai/glm-4.5-air': { input: 0.13, output: 0.85, cached: 0.025, reasoning: 0.85 },
    'z-ai/glm-4.6': { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    'z-ai/glm-4.6v': { input: 0.3, output: 0.9, reasoning: 0.9 },
    'z-ai/glm-4.7': { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    'z-ai/glm-5': { input: 1.0, output: 3.2, cached: 0.2, reasoning: 3.2 },
    'z-ai/glm-5-turbo': { input: 1.2, output: 4.0, cached: 0.24, reasoning: 4.0 },
    'z-ai/glm-5.1': { input: 1.05, output: 3.5, cached: 0.525, reasoning: 3.5 },
    'z-ai/glm-5.2': { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
  },
}

interface PatternPricingEntry {
  pattern: string
  pricing: ModelPricing9R
}

/**
 * Pattern-based pricing fallback — matched when no exact model entry found.
 * First match wins — order matters.
 */
export const PATTERN_PRICING: PatternPricingEntry[] = [
  // --- Codex variants ---
  { pattern: '*-codex-xhigh',   pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: '*-codex-high',    pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: '*-codex-max',     pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: '*-codex-mini-*',  pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: '*-codex-mini',    pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: '*-codex-low',     pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: '*-codex-none',    pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: '*-codex-spark',   pricing: { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  } },
  { pattern: 'codex-*',         pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: '*-codex',         pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },

  // --- Claude ---
  { pattern: 'claude-opus-*',   pricing: { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  } },
  { pattern: 'claude-sonnet-*', pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },
  { pattern: 'claude-haiku-*',  pricing: { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  } },
  { pattern: 'claude-*',        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },

  // --- Gemini ---
  { pattern: 'gemini-*-flash-lite', pricing: { input: 0.15, output: 1.25, cached: 0.015, reasoning: 1.875, cache_creation: 0.15 } },
  { pattern: 'gemini-*-flash',  pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: 'gemini-*-pro',    pricing: { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  } },
  { pattern: 'gemini-3-*',      pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },
  { pattern: 'gemini-2.5-*',    pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: 'gemini-*',        pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },

  // --- GPT ---
  { pattern: 'gpt-5.6-*',       pricing: { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: 'gpt-5.3-*',       pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: 'gpt-5.2-*',       pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: 'gpt-5.1-*',       pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: 'gpt-5-*',         pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: 'gpt-5*',          pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: 'gpt-4o-*',        pricing: { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90,   cache_creation: 0.15  } },
  { pattern: 'gpt-4o',          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: 'gpt-4*',          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },

  // --- o1 / o-series ---
  { pattern: 'o1-*',            pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: 'o1',              pricing: { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00,  cache_creation: 15.00 } },
  { pattern: 'o3-*',            pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: 'o4-*',            pricing: { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  } },

  // --- Qwen ---
  { pattern: 'qwen3-coder-*',   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: 'qwen*-coder-*',   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: 'qwen*',           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Kimi ---
  { pattern: 'kimi-*-thinking',  pricing: { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  } },
  { pattern: 'kimi-k3*',        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  } },
  { pattern: 'kimi-k2*',        pricing: { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  } },
  { pattern: 'kimi-*',          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },

  // --- DeepSeek ---
  { pattern: 'deepseek-*reasoner*', pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },
  { pattern: 'deepseek-r*',     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: 'deepseek-v*',     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: 'deepseek-*',      pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },

  // --- GLM ---
  { pattern: 'glm-5*',          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: 'glm-4*',          pricing: { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  } },
  { pattern: 'glm-*',           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- MiniMax ---
  { pattern: 'MiniMax-*',       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: 'minimax-*',       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Grok ---
  { pattern: 'grok-code-*',     pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: 'grok-*',          pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
]

/**
 * Resolve pricing for a model using the 3-step fallback chain:
 *   1. PROVIDER_PRICING[provider][model]
 *   2. MODEL_PRICING[model]
 *   3. PATTERN_PRICING (glob match)
 *
 * @returns pricing object or null if no match
 */
export function getPricing(
  modelId: string,
  providerId?: string,
): ModelPricing9R | null {
  if (!modelId) return null

  // 1. Provider-specific override
  if (providerId && PROVIDER_PRICING[providerId]?.[modelId]) {
    return PROVIDER_PRICING[providerId][modelId]
  }

  // 2. Canonical model pricing (strip vendor prefix if needed)
  const baseModel = modelId.includes('/') ? modelId.split('/').pop()! : modelId
  if (MODEL_PRICING[baseModel]) return MODEL_PRICING[baseModel]
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId]

  // 3. Pattern match
  for (const { pattern, pricing } of PATTERN_PRICING) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, modelId)) {
      return pricing
    }
  }

  return null
}

/**
 * Calculate cost from token counts using 9router pricing.
 */
export function calculateCostFromTokens(
  tokens: {
    prompt_tokens?: number
    input_tokens?: number
    cached_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    completion_tokens?: number
    output_tokens?: number
    reasoning_tokens?: number
  },
  pricing: ModelPricing9R,
): number {
  if (!tokens || !pricing) return 0

  let cost = 0

  const inputTokens = tokens.prompt_tokens ?? tokens.input_tokens ?? 0
  const cachedTokens = tokens.cached_tokens ?? tokens.cache_read_input_tokens ?? 0
  const cacheCreationTokens = tokens.cache_creation_input_tokens ?? 0
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens - cacheCreationTokens)

  cost += nonCachedInput * (pricing.input / 1_000_000)

  if (cachedTokens > 0) {
    cost += cachedTokens * ((pricing.cached ?? pricing.input) / 1_000_000)
  }

  const outputTokens = tokens.completion_tokens ?? tokens.output_tokens ?? 0
  cost += outputTokens * (pricing.output / 1_000_000)

  const reasoningTokens = tokens.reasoning_tokens ?? 0
  if (reasoningTokens > 0) {
    cost += reasoningTokens * ((pricing.reasoning ?? pricing.output) / 1_000_000)
  }

  if (cacheCreationTokens > 0) {
    cost += cacheCreationTokens * ((pricing.cache_creation ?? pricing.input) / 1_000_000)
  }

  return cost
}

/**
 * Format cost for display.
 */
export function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined || isNaN(cost)) return '$0.00'
  return `$${cost.toFixed(2)}`
}
