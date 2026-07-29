import { prisma } from "../db"
import {
  getCooldownRemainingMs,
  rateLimitCooldownKey,
} from "../rate-limit-cooldown"
import {
  getModelHealth,
  healthKey,
  isUnhealthy,
  type ModelHealthMap,
} from "./model-health"
import { scoreComplexity, type RoutingTier } from "./complexity-scorer"
import { detectTaskCategory, type TaskCategory } from "./task-detector"
import { getMomentumBias, recordTierAssignment } from "./session-momentum"
import type { RoutingProviderModelReadiness } from "./provider-readiness"

export interface TierConfig {
  providerId: string
  modelId: string
  fallbacks?: Array<{
    providerId: string
    modelId: string
  }>
}

export interface RoutingConfigData {
  complexityEnabled: boolean
  taskRoutingEnabled: boolean
  tiers: Partial<Record<RoutingTier | "default", TierConfig>>
  taskOverrides: Partial<Record<TaskCategory, TierConfig>>
}

export interface RoutingCandidate {
  providerId: string
  modelId: string
  tier: RoutingTier | "default"
}

export interface RoutingResult {
  providerId: string
  modelId: string
  tier: RoutingTier | "default"
  reason:
    | "header_override"
    | "task_specific"
    | "scored"
    | "momentum_bias"
    | "config_default"
    /** O primário configurado estava em cooldown ou com histórico ruim; promovemos um fallback. */
    | "health_skip"
  taskCategory: TaskCategory | null
  complexityScore?: number
  /** Confiança [0,1] do scoring de complexidade (ausente em overrides/task/default). */
  confidence?: number
  /// Modelos alternativos (outros tiers configurados) tentados em ordem se o primário falhar.
  fallbacks: RoutingCandidate[]
}

function hasProvider(
  candidate: { providerId?: unknown } | null | undefined,
): candidate is { providerId: string; modelId?: string } {
  return (
    typeof candidate?.providerId === "string" && candidate.providerId.length > 0
  )
}

function candidateKey(candidate: {
  providerId: string
  modelId?: string
}): string {
  return `${candidate.providerId.toLowerCase()}/${(candidate.modelId ?? "").toLowerCase()}`
}

function hasReadyModel(
  candidate: { providerId: string; modelId?: string },
  readiness: RoutingProviderModelReadiness,
): boolean {
  if (!readiness.providerIds.has(candidate.providerId)) return false
  if (!candidate.modelId) return true
  return readiness.modelKeys.has(candidateKey(candidate))
}

function pushCandidate(
  out: RoutingCandidate[],
  seen: Set<string>,
  candidate: {
    providerId: string
    modelId?: string
    tier: RoutingTier | "default"
  },
): void {
  const key = candidateKey(candidate)
  if (seen.has(key)) return
  seen.add(key)
  out.push({
    providerId: candidate.providerId,
    modelId: candidate.modelId ?? "",
    tier: candidate.tier,
  })
}

function sanitizeTierConfig(
  config: TierConfig | undefined,
  readiness: RoutingProviderModelReadiness,
): TierConfig | undefined {
  if (!hasProvider(config)) return undefined
  if (!hasReadyModel(config, readiness)) return undefined

  const fallbacks = (config.fallbacks ?? []).flatMap((fallback) => {
    if (!hasProvider(fallback)) return []
    if (!hasReadyModel(fallback, readiness)) return []
    return [
      { providerId: fallback.providerId, modelId: fallback.modelId ?? "" },
    ]
  })

  const sanitized: TierConfig = {
    providerId: config.providerId,
    modelId: config.modelId ?? "",
  }
  if (fallbacks.length > 0) sanitized.fallbacks = fallbacks
  return sanitized
}

function sanitizeRoutingMap<T extends string>(
  map: Partial<Record<T, TierConfig>>,
  readiness: RoutingProviderModelReadiness,
): Partial<Record<T, TierConfig>> {
  const sanitized: Partial<Record<T, TierConfig>> = {}
  for (const [key, config] of Object.entries(map) as Array<
    [T, TierConfig | undefined]
  >) {
    const sanitizedConfig = sanitizeTierConfig(config, readiness)
    if (sanitizedConfig) sanitized[key] = sanitizedConfig
  }
  return sanitized
}

// Coleta os modelos configurados nos tiers como pool de fallback, ordenados do
// mais capaz (reasoning) ao mais simples, deduplicados por provider/modelo.
function collectTierCandidates(
  config: RoutingConfigData,
  seen: Set<string>,
): RoutingCandidate[] {
  const order: Array<RoutingTier | "default"> = [
    "reasoning",
    "complex",
    "standard",
    "simple",
    "default",
  ]
  const out: RoutingCandidate[] = []
  for (const tier of order) {
    const cfg = config.tiers[tier]
    if (!hasProvider(cfg)) continue
    pushCandidate(out, seen, {
      providerId: cfg.providerId,
      modelId: cfg.modelId,
      tier,
    })
  }
  return out
}

function collectExplicitFallbacks(
  assignment: TierConfig | undefined,
  fallbackTier: RoutingTier | "default",
  seen: Set<string>,
): RoutingCandidate[] {
  const out: RoutingCandidate[] = []
  for (const fallback of assignment?.fallbacks ?? []) {
    if (!hasProvider(fallback)) continue
    pushCandidate(out, seen, {
      providerId: fallback.providerId,
      modelId: fallback.modelId,
      tier: fallbackTier,
    })
  }
  return out
}

/**
 * Um candidato está indisponível quando o provedor devolveu 429 recentemente
 * (cooldown em memória, honrando Retry-After) ou quando o histórico de uso
 * mostra maioria de falhas. Antes disso o resolver montava a cadeia às cegas e
 * podia eleger como primário um modelo que o próprio sistema sabia estar fora.
 */
function isCandidateAvailable(
  candidate: { providerId: string; modelId: string },
  health: ModelHealthMap,
): boolean {
  const cooldownKey = rateLimitCooldownKey(
    candidate.providerId,
    candidate.modelId,
  )
  if (getCooldownRemainingMs(cooldownKey) > 0) return false
  return !isUnhealthy(
    health.get(healthKey(candidate.providerId, candidate.modelId)),
  )
}

/**
 * Remove os indisponíveis da cadeia e promove o primeiro que sobrou. Se todos
 * estiverem indisponíveis a cadeia original é mantida: melhor tentar e falhar
 * com o erro real do upstream do que não rotear nada.
 */
function applyAvailability(
  result: RoutingResult,
  health: ModelHealthMap,
): RoutingResult {
  const chain: RoutingCandidate[] = [
    {
      providerId: result.providerId,
      modelId: result.modelId,
      tier: result.tier,
    },
    ...result.fallbacks,
  ]
  const available = chain.filter((candidate) =>
    isCandidateAvailable(candidate, health),
  )

  const [head, ...rest] = available
  if (!head) return result
  if (
    head.providerId === result.providerId &&
    head.modelId === result.modelId
  ) {
    return { ...result, fallbacks: rest }
  }

  return {
    ...result,
    providerId: head.providerId,
    modelId: head.modelId,
    reason: "health_skip",
    fallbacks: rest,
  }
}

function withFallbacks(
  result: Omit<RoutingResult, "fallbacks">,
  config: RoutingConfigData,
  health: ModelHealthMap,
  assignment?: TierConfig,
): RoutingResult {
  const seen = new Set<string>([candidateKey(result)])
  const fallbacks = [
    ...collectExplicitFallbacks(assignment, result.tier, seen),
    ...collectTierCandidates(config, seen),
  ]
  return applyAvailability({ ...result, fallbacks }, health)
}

// Cache simples de configuração por userId (60s TTL) para evitar DB hits por request
const configCache = new Map<
  string,
  { data: RoutingConfigData | null; expiresAt: number }
>()
const CONFIG_CACHE_TTL_MS = 60_000

export async function getRoutingConfig(
  userId: string,
): Promise<RoutingConfigData | null> {
  const cached = configCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const row = await prisma.routingConfig.findUnique({ where: { userId } })
  if (!row) {
    configCache.set(userId, {
      data: null,
      expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
    })
    return null
  }

  const { getConfiguredRoutingProviderModelReadiness } =
    await import("./provider-readiness")
  const readiness = await getConfiguredRoutingProviderModelReadiness(userId)
  const tiers = sanitizeRoutingMap(
    (row.tiers as unknown as Partial<
      Record<RoutingTier | "default", TierConfig>
    >) ?? {},
    readiness,
  )
  const taskOverrides = sanitizeRoutingMap(
    (row.taskOverrides as unknown as Partial<
      Record<TaskCategory, TierConfig>
    >) ?? {},
    readiness,
  )

  const data: RoutingConfigData = {
    complexityEnabled: row.complexityEnabled,
    taskRoutingEnabled: row.taskRoutingEnabled,
    tiers,
    taskOverrides,
  }

  configCache.set(userId, { data, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS })
  return data
}

export function invalidateRoutingCache(userId: string): void {
  configCache.delete(userId)
}

export async function resolveRouting(input: {
  userId: string
  messages: Array<{ role: string; content: unknown }>
  forcedTier?: RoutingTier
  toolNames?: string[]
}): Promise<RoutingResult | null> {
  const { userId, messages, forcedTier, toolNames } = input

  const config = await getRoutingConfig(userId)
  if (!config) return null

  // Depois do early-return: usuários sem routing não pagam a agregação.
  // Falha na agregação nunca derruba o roteamento — sem dados de saúde o
  // resolver volta a decidir só pela configuração, que é o comportamento antigo.
  const health = await getModelHealth(userId).catch((error) => {
    console.warn(
      "Falha ao carregar saúde de modelos; roteando sem esse sinal",
      {
        userId,
        error: error instanceof Error ? error.message : String(error),
      },
    )
    return new Map() as ModelHealthMap
  })

  const textMessages = messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }))

  // 1. Header override — tier forçado pelo cliente
  if (forcedTier) {
    const tierConfig = config.tiers[forcedTier] ?? config.tiers["default"]
    if (tierConfig) {
      recordTierAssignment(userId, forcedTier)
      return withFallbacks(
        {
          providerId: tierConfig.providerId,
          modelId: tierConfig.modelId,
          tier: forcedTier,
          reason: "header_override",
          taskCategory: null,
        },
        config,
        health,
        tierConfig,
      )
    }
  }

  // 2. Task-specific routing
  if (config.taskRoutingEnabled) {
    const taskResult = detectTaskCategory(
      messages as Array<{ role: string; content: unknown }>,
      toolNames,
    )
    if (taskResult && taskResult.confidence >= 0.4) {
      const taskConfig = config.taskOverrides[taskResult.category]
      if (taskConfig) {
        return withFallbacks(
          {
            providerId: taskConfig.providerId,
            modelId: taskConfig.modelId,
            tier: "default",
            reason: "task_specific",
            taskCategory: taskResult.category,
          },
          config,
          health,
          taskConfig,
        )
      }
    }
  }

  // 3. Complexity routing
  if (config.complexityEnabled) {
    const scored = scoreComplexity(textMessages, {
      hasTools: (toolNames?.length ?? 0) > 0,
    })

    // Momentum bias — tenta manter consistência na sessão
    const momentum = getMomentumBias(userId)
    let resolvedTier: RoutingTier = scored.tier
    let reason: RoutingResult["reason"] = "scored"

    if (momentum && scored.rawScore < 50) {
      // Não faz downgrade de tier quando há momentum de sessão
      const tierOrder: RoutingTier[] = [
        "simple",
        "standard",
        "complex",
        "reasoning",
      ]
      const momentumIdx = tierOrder.indexOf(momentum)
      const scoredIdx = tierOrder.indexOf(scored.tier)
      if (scoredIdx < momentumIdx) {
        resolvedTier = momentum
        reason = "momentum_bias"
      }
    }

    const tierConfig = config.tiers[resolvedTier] ?? config.tiers["default"]
    if (tierConfig) {
      recordTierAssignment(userId, resolvedTier)
      return withFallbacks(
        {
          providerId: tierConfig.providerId,
          modelId: tierConfig.modelId,
          tier: resolvedTier,
          reason,
          taskCategory: null,
          complexityScore: scored.rawScore,
          confidence: scored.confidence,
        },
        config,
        health,
        tierConfig,
      )
    }
  }

  // 4. Default tier
  const defaultConfig = config.tiers["default"]
  if (defaultConfig) {
    return withFallbacks(
      {
        providerId: defaultConfig.providerId,
        modelId: defaultConfig.modelId,
        tier: "default",
        reason: "config_default",
        taskCategory: null,
      },
      config,
      health,
      defaultConfig,
    )
  }

  return null
}
