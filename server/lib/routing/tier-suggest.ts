// Sugestão automática de modelos por tier de complexidade.
// Inspirado no Manifest (tier-auto-assign): em vez de exigir que o usuário
// configure manualmente cada tier, rankeamos os modelos disponíveis por
// "capacidade" (preço de output como proxy + heurísticas de nome) e
// distribuímos do mais barato/simples ao mais capaz.

import { getModelPrice } from '../model-pricing'
import type { RoutingProviderSource } from './provider-readiness'

export interface ModelCandidate {
  providerId: string
  modelId: string
  score: number
  isReasoning: boolean
}

export interface SuggestedTiers {
  simple?: { providerId: string; modelId: string }
  standard?: { providerId: string; modelId: string }
  complex?: { providerId: string; modelId: string }
  reasoning?: { providerId: string; modelId: string }
}

export type SuggestTierAssignmentsOptions = {
  sources?: RoutingProviderSource[]
}

// Modelos de raciocínio explícito (o-series, R1, reasoner, thinking, QwQ…).
const REASONING_RE = /(^|[-_/])(o1|o3|o4|r1|reasoner|reasoning|thinking|qwq)([-_/]|$)/i
// Sinais de modelo "grande"/topo de linha.
const BIG_RE = /(opus|gpt-5|pro|large|ultra|405b|70b|72b|65b)/i
// Sinais de modelo pequeno/rápido/barato.
const SMALL_RE = /(mini|nano|flash|haiku|lite|small|tiny|instant|8b|7b|9b|3b|2b|1b|gemma)/i

export function capabilityScore(providerId: string, modelId: string): number {
  const price = getModelPrice(providerId, modelId)
  // Preço de output (USD/1M) é um bom proxy de capacidade; sem preço assume mid.
  let score = price ? price.outputPer1M : 5
  const id = modelId.toLowerCase()
  if (REASONING_RE.test(id)) score += 50
  if (BIG_RE.test(id)) score += 8
  if (SMALL_RE.test(id)) score -= 4
  return score
}

// Dada a lista de candidatos, escolhe um modelo por tier. Pública para teste.
export function pickTiers(candidates: ModelCandidate[]): SuggestedTiers {
  if (candidates.length === 0) return {}

  const sorted = [...candidates].sort((a, b) => a.score - b.score)
  const n = sorted.length
  const pick = (frac: number): ModelCandidate => sorted[Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))))]
  const toAssign = (c: ModelCandidate) => ({ providerId: c.providerId, modelId: c.modelId })

  // Reasoning prefere um modelo de raciocínio explícito; senão o mais capaz.
  const reasoningModel = [...sorted].reverse().find((c) => c.isReasoning) ?? sorted[n - 1]

  return {
    simple: toAssign(pick(0)),
    standard: toAssign(pick(0.4)),
    complex: toAssign(pick(0.75)),
    reasoning: toAssign(reasoningModel),
  }
}

export async function suggestTierAssignments(options: SuggestTierAssignmentsOptions = {}): Promise<SuggestedTiers> {
  // Imports dinâmicos: a cadeia do registry puxa o cliente Prisma, que não deve
  // ser avaliada ao importar as funções puras (capabilityScore/pickTiers) em testes.
  const { getProviderModels, isProviderAvailableViaExternalApi, providerRegistry } = await import(
    '../../providers/registry'
  )
  const { isProviderEnabled } = await import('../catalog')
  // Aquece o cache de preços do OpenRouter para o ranking refletir custos atuais.
  const { ensureOpenRouterPricingFresh } = await import('../openrouter-pricing')
  await ensureOpenRouterPricingFresh()

  const sources = options.sources ?? Object.keys(providerRegistry)
    .filter((id) => isProviderEnabled(id) && isProviderAvailableViaExternalApi(id))
    .map((providerId) => ({ providerId, credentials: {}, cacheKeySuffix: 'env' }))

  const results = await Promise.allSettled(
    sources.map(async ({ cacheKeySuffix, credentials, providerId }) => {
      const models = await getProviderModels(providerId, { cacheKeySuffix, credentials })
      return models.map((m) => ({
        providerId,
        modelId: m.id,
        score: capabilityScore(providerId, m.id),
        isReasoning: REASONING_RE.test(m.id.toLowerCase()),
      }))
    }),
  )

  const candidates: ModelCandidate[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') candidates.push(...r.value)
  }

  return pickTiers(candidates)
}
