// Pricing dinâmico via API pública do OpenRouter (sem chave).
// Inspirado no PricingSyncService do Manifest: em vez de manter preços
// hardcoded que envelhecem, buscamos a tabela do OpenRouter e usamos como
// fallback quando a tabela estática de model-pricing.ts não tem o modelo.
//
// Serverless-friendly: cache em memória por instância, refresh lazy com TTL
// de 24h disparado em contexto async (fire-and-forget) — sem cron.

import type { ModelPrice } from './model-pricing'

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const TTL_MS = 24 * 60 * 60 * 1000

// Vendor prefix do OpenRouter → providerId do ModelHub.
// Permite achar o preço de um modelo direto (ex.: provider "xai", modelo
// "grok-4") na entrada "x-ai/grok-4" do OpenRouter.
const OR_PREFIX_TO_PROVIDER: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'googleaistudio',
  'x-ai': 'xai',
  xai: 'xai',
  deepseek: 'deepseek',
  mistralai: 'mistral',
  moonshotai: 'moonshot',
  qwen: 'qwen',
  alibaba: 'qwen',
  'z-ai': 'zai',
  zhipuai: 'zai',
  'meta-llama': 'groq',
}

// Providers que endereçam modelos pelo id completo "vendor/model" (gateways).
const FULL_ID_PROVIDERS = new Set(['openrouter', 'gateway', 'opengateway'])

// Cache: chave "providerId/modelId" (lowercase) → preço.
const cache = new Map<string, ModelPrice>()
let lastFetch = 0
let inFlight: Promise<void> | null = null

function key(providerId: string, modelId: string): string {
  return `${providerId.toLowerCase()}/${modelId.toLowerCase()}`
}

interface OpenRouterModel {
  id: string
  pricing?: { prompt?: string; completion?: string }
}

function parsePerMillion(value: string | undefined): number | null {
  if (!value) return null
  const perToken = Number(value)
  if (!Number.isFinite(perToken) || perToken < 0) return null
  return perToken * 1_000_000
}

function ingest(models: OpenRouterModel[]): void {
  cache.clear()
  for (const m of models) {
    const input = parsePerMillion(m.pricing?.prompt)
    const output = parsePerMillion(m.pricing?.completion)
    if (input === null || output === null) continue
    const price: ModelPrice = { inputPer1M: input, outputPer1M: output }

    const slash = m.id.indexOf('/')
    if (slash <= 0) continue
    const vendor = m.id.slice(0, slash).toLowerCase()
    const model = m.id.slice(slash + 1).toLowerCase()

    // Sempre indexa pelo id completo para gateways (openrouter/gateway/opengateway).
    for (const gw of FULL_ID_PROVIDERS) cache.set(key(gw, m.id), price)

    // Indexa também sob o providerId direto quando o vendor é conhecido.
    const providerId = OR_PREFIX_TO_PROVIDER[vendor]
    if (providerId) cache.set(key(providerId, model), price)
  }
}

async function refresh(): Promise<void> {
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return
    const json = (await res.json()) as { data?: OpenRouterModel[] }
    if (Array.isArray(json.data) && json.data.length > 0) {
      ingest(json.data)
      lastFetch = Date.now()
    }
  } catch {
    // Falha de rede é tolerável — a tabela estática segue como fonte primária.
  }
}

/**
 * Garante que o cache de preços esteja fresco (TTL 24h). Chame em contexto
 * async (não bloqueia o caminho crítico — pode-se ignorar a Promise).
 */
export async function ensureOpenRouterPricingFresh(now = Date.now()): Promise<void> {
  if (cache.size > 0 && now - lastFetch < TTL_MS) return
  inFlight ??= refresh().finally(() => { inFlight = null })
  await inFlight
}

/** Leitura síncrona do cache. Retorna null se o modelo não estiver no cache. */
export function getOpenRouterPrice(providerId: string, modelId: string): ModelPrice | null {
  if (cache.size === 0) return null

  if (FULL_ID_PROVIDERS.has(providerId.toLowerCase())) {
    return cache.get(key(providerId, modelId)) ?? null
  }

  const direct = cache.get(key(providerId, modelId))
  if (direct) return direct

  // Tentativa por prefixo (modelos versionados): coleta todos os matches e
  // prioriza a chave mais longa para evitar que um prefixo curto (gpt-4)
  // "engula" um modelo mais específico (gpt-4-turbo).
  const wanted = key(providerId, modelId)
  const prefix = `${providerId.toLowerCase()}/`
  const matches: Array<{ k: string; price: ModelPrice }> = []
  for (const [k, price] of cache) {
    if (k.startsWith(prefix) && (wanted.startsWith(k) || k.startsWith(wanted))) {
      matches.push({ k, price })
    }
  }
  if (matches.length === 0) return null
  matches.sort((a, b) => b.k.length - a.k.length)
  return matches[0].price
}

/** Limpa o cache — usado em testes. */
export function clearOpenRouterPricing(): void {
  cache.clear()
  lastFetch = 0
  inFlight = null
}
