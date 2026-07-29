// Sugestão automática de modelos por tier de complexidade.
//
// A versão anterior usava preço de saída como proxy de capacidade. Só que
// `getModelPrice` conhece uma tabela hardcoded de ~20 providers por ID exato:
// para catálogos como Cloudflare (`@cf/…`), Duck.ai, Pollinations ou os IDs
// reais da Cerebras ela devolve null, e praticamente todo modelo caía no mesmo
// score default. Com a distribuição degenerada, a seleção por percentil
// retornava posições arbitrárias — a ordem de iteração dos providers, não
// qualidade.
//
// Agora o ranking sai de sinais presentes no próprio ID (contagem de
// parâmetros e família), que existem em 100% dos catálogos. Preço entra apenas
// como desempate quando conhecido.

import { getModelPrice } from "../model-pricing"
import type { RoutingTier } from "./complexity-scorer"
import {
  healthAdjustment,
  healthKey,
  type ModelHealthMap,
} from "./model-health"
import type { RoutingProviderSource } from "./provider-readiness"

export type SuggestedSlot = {
  providerId: string
  modelId: string
  /** Sinal dominante que colocou o modelo nessa posição — exibido no preview. */
  reason: string
}

export type SuggestedTiers = Partial<Record<RoutingTier, SuggestedSlot[]>>

export interface ModelCandidate {
  providerId: string
  modelId: string
  /** 0–100: estimativa de capacidade derivada do ID. */
  score: number
  isReasoning: boolean
  /** USD por 1M de saída quando conhecido; só desempata. */
  outputPer1M: number | null
  signals: string[]
}

export type SuggestTierAssignmentsOptions = {
  sources?: RoutingProviderSource[]
  /** Modelos por lane: 1 principal + (n-1) fallbacks. */
  slotsPerTier?: number
  /**
   * Saúde observada por (provedor, modelo). Quando presente, taxa de erro real
   * ajusta o score heurístico — é o que troca palpite sobre o nome do modelo
   * por número medido no tráfego do próprio usuário.
   */
  health?: ModelHealthMap
}

export const DEFAULT_SLOTS_PER_TIER = 5

/**
 * Modelos que não atendem chat completions. Sugerir um classificador de
 * segurança ou um adaptador LoRA como modelo de rota é um erro silencioso:
 * a rota existe, responde, e devolve lixo.
 */
// Dividido em dois: uma alternação única com todos os termos estoura o limite
// de complexidade do analisador sem ganhar nada em clareza.
const NON_CHAT_RES = [
  /(guard|lora|embed|rerank|moderation|classif)/i,
  /(whisper|[-_/]tts|stable-diffusion|sdxl|flux|bge-|m2m100|resnet|detr|distilbert|ocr|upscal)/i,
]

/** Raciocínio explícito (o-series, R1, reasoner, thinking, QwQ…). */
const REASONING_RE =
  /(^|[-_/])(o1|o3|o4|r1|reasoner|reasoning|thinking|qwq)([-_/.]|$)/i

/** Topo de linha. `pro`/`max`/`large` ancorados para não casar com "prompt"/"maximum". */
const FLAGSHIP_RE =
  /(opus|gpt-5|gpt-4\.1|gpt-4o|sonnet|[-_/](pro|max|ultra|large)([-_/.]|$))/i

/** Família pequena/rápida. */
const SMALL_RE = /(mini|nano|flash|haiku|lite|small|tiny|instant|gemma|phi-)/i

const UNKNOWN_SCORE = 50

/**
 * Maior contagem de parâmetros citada no ID (`405b`, `70b`, `8b`, `2b`).
 * É o sinal de capacidade mais confiável e mais difundido nesses catálogos.
 */
export function paramBillions(modelId: string): number | null {
  // Sem `\s*` antes do `b`: IDs de modelo não têm espaço ali e o quantificador
  // opcional criava backtracking superlinear.
  // Quantificadores limitados: contagem de parâmetros nunca passa de 4 dígitos,
  // e o limite elimina o backtracking do `\d+` aninhado.
  const matches = [
    ...modelId.matchAll(/(\d{1,4}(?:\.\d{1,2})?)b(?![a-z0-9])/gi),
  ]
  if (matches.length === 0) return null
  const values = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value))
  return values.length > 0 ? Math.max(...values) : null
}

function scoreFromParams(billions: number): number {
  if (billions >= 200) return 92
  if (billions >= 100) return 86
  if (billions >= 60) return 80
  if (billions >= 30) return 72
  if (billions >= 13) return 60
  if (billions >= 7) return 48
  if (billions >= 3) return 34
  if (billions >= 1) return 22
  return 15
}

export function isChatModel(modelId: string): boolean {
  return !NON_CHAT_RES.some((pattern) => pattern.test(modelId))
}

export function scoreModel(
  providerId: string,
  modelId: string,
): { score: number; isReasoning: boolean; signals: string[] } {
  const id = modelId.toLowerCase()
  const signals: string[] = []

  const billions = paramBillions(id)
  let score: number
  if (billions !== null) {
    score = scoreFromParams(billions)
    signals.push(`${billions}B parâmetros`)
  } else if (SMALL_RE.test(id)) {
    // Antes de FLAGSHIP_RE: "gpt-4o-mini" contém "gpt-4o" mas é a variante
    // pequena da família, não o topo de linha.
    score = 30
    signals.push("família compacta")
  } else if (FLAGSHIP_RE.test(id)) {
    score = 85
    signals.push("família topo de linha")
  } else {
    score = UNKNOWN_SCORE
    signals.push("sem sinal no identificador")
  }

  const isReasoning = REASONING_RE.test(id)
  if (isReasoning) {
    score += 18
    signals.push("raciocínio explícito")
  }
  // Ajustes de família por cima do sinal de parâmetros: separa
  // "gpt-oss-120b" de "llama-3.3-70b-instruct-fp8-fast".
  if (billions !== null && FLAGSHIP_RE.test(id)) score += 8
  if (billions !== null && SMALL_RE.test(id)) score -= 10

  const price = getModelPrice(providerId, modelId)
  if (price) signals.push(`$${price.outputPer1M}/1M saída`)

  return {
    score: Math.max(0, Math.min(100, score)),
    isReasoning,
    signals,
  }
}

type Band = { tier: RoutingTier; min: number; max: number }

// Faixas absolutas em vez de percentis: se nada se qualifica para um tier, a
// lane fica vazia em vez de receber um modelo arbitrário com ar de escolhido.
const BANDS: Band[] = [
  { tier: "simple", min: 0, max: 40 },
  { tier: "standard", min: 40, max: 62 },
  { tier: "complex", min: 62, max: 82 },
  { tier: "reasoning", min: 82, max: 101 },
]

function bandCenter(band: Band): number {
  return (band.min + Math.min(band.max, 100)) / 2
}

/** Melhor primeiro: score desc, e entre empates o mais barato conhecido. */
function byQuality(a: ModelCandidate, b: ModelCandidate): number {
  if (b.score !== a.score) return b.score - a.score
  return (a.outputPer1M ?? Infinity) - (b.outputPer1M ?? Infinity)
}

/**
 * Preenche a lane priorizando providers distintos: um fallback no mesmo
 * provider não protege do cenário mais comum, que é o provider inteiro cair.
 */
export function fillLane(
  pool: ModelCandidate[],
  limit: number,
): ModelCandidate[] {
  const out: ModelCandidate[] = []
  const usedProviders = new Set<string>()

  for (const candidate of pool) {
    if (out.length >= limit) break
    if (usedProviders.has(candidate.providerId)) continue
    usedProviders.add(candidate.providerId)
    out.push(candidate)
  }

  const chosen = new Set(out)
  for (const candidate of pool) {
    if (out.length >= limit) break
    if (chosen.has(candidate)) continue
    out.push(candidate)
  }

  return out
}

function toSlot(candidate: ModelCandidate): SuggestedSlot {
  return {
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    reason: candidate.signals.join(" · "),
  }
}

export function pickTiers(
  candidates: ModelCandidate[],
  slotsPerTier: number = DEFAULT_SLOTS_PER_TIER,
): SuggestedTiers {
  if (candidates.length === 0) return {}

  const sorted = [...candidates].sort(byQuality)
  const tiers: SuggestedTiers = {}

  for (const band of BANDS) {
    let pool =
      band.tier === "reasoning"
        ? sorted.filter(
            (candidate) => candidate.isReasoning || candidate.score >= band.min,
          )
        : sorted.filter(
            (candidate) =>
              candidate.score >= band.min && candidate.score < band.max,
          )

    // Catálogo pequeno: sem ninguém na faixa, usa os mais próximos do centro
    // dela em vez de deixar a lane vazia.
    if (pool.length === 0) {
      const center = bandCenter(band)
      pool = [...sorted].sort(
        (a, b) =>
          Math.abs(a.score - center) - Math.abs(b.score - center) ||
          byQuality(a, b),
      )
    }

    const lane = fillLane(pool, slotsPerTier)
    if (lane.length > 0) tiers[band.tier] = lane.map(toSlot)
  }

  return tiers
}

export async function suggestTierAssignments(
  options: SuggestTierAssignmentsOptions = {},
): Promise<SuggestedTiers> {
  // Imports dinâmicos: a cadeia do registry puxa o cliente Prisma, que não deve
  // ser avaliada ao importar as funções puras (scoreModel/pickTiers) em testes.
  const {
    getProviderModels,
    isProviderAvailableViaExternalApi,
    providerRegistry,
  } = await import("../../providers/registry")
  const { isProviderEnabled } = await import("../catalog")
  // Aquece o cache de preços do OpenRouter para o desempate refletir custos atuais.
  const { ensureOpenRouterPricingFresh } = await import("../openrouter-pricing")
  await ensureOpenRouterPricingFresh()

  const sources =
    options.sources ??
    Object.keys(providerRegistry)
      .filter(
        (id) => isProviderEnabled(id) && isProviderAvailableViaExternalApi(id),
      )
      .map((providerId) => ({
        providerId,
        credentials: {},
        cacheKeySuffix: "env",
      }))

  const results = await Promise.allSettled(
    sources.map(async ({ cacheKeySuffix, credentials, providerId }) => {
      const models = await getProviderModels(providerId, {
        cacheKeySuffix,
        credentials,
      })
      return models
        .filter((model) => isChatModel(model.id))
        .map((model) => {
          const { score, isReasoning, signals } = scoreModel(
            providerId,
            model.id,
          )
          // Taxa de erro real corrige o palpite feito sobre o nome do modelo.
          const adjustment = healthAdjustment(
            options.health?.get(healthKey(providerId, model.id)),
          )
          return {
            providerId,
            modelId: model.id,
            score: Math.max(0, Math.min(100, score + adjustment.delta)),
            isReasoning,
            outputPer1M:
              getModelPrice(providerId, model.id)?.outputPer1M ?? null,
            signals: [...signals, adjustment.signal],
          }
        })
    }),
  )

  const candidates: ModelCandidate[] = []
  for (const result of results) {
    if (result.status === "fulfilled") candidates.push(...result.value)
  }

  return pickTiers(candidates, options.slotsPerTier ?? DEFAULT_SLOTS_PER_TIER)
}
