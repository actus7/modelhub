import { prisma } from '../db'
import { scoreComplexity, type RoutingTier } from './complexity-scorer'
import { detectTaskCategory, type TaskCategory } from './task-detector'
import { getMomentumBias, recordTierAssignment } from './session-momentum'
import type { RoutingProviderModelReadiness } from './provider-readiness'

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
  tiers: Partial<Record<RoutingTier | 'default', TierConfig>>
  taskOverrides: Partial<Record<TaskCategory, TierConfig>>
}

export interface RoutingCandidate {
  providerId: string
  modelId: string
  tier: RoutingTier | 'default'
}

export interface RoutingResult {
  providerId: string
  modelId: string
  tier: RoutingTier | 'default'
  reason: 'header_override' | 'task_specific' | 'scored' | 'momentum_bias' | 'config_default'
  taskCategory: TaskCategory | null
  complexityScore?: number
  /** Confiança [0,1] do scoring de complexidade (ausente em overrides/task/default). */
  confidence?: number
  /// Modelos alternativos (outros tiers configurados) tentados em ordem se o primário falhar.
  fallbacks: RoutingCandidate[]
}

function hasProvider(candidate: { providerId?: unknown } | null | undefined): candidate is { providerId: string; modelId?: string } {
  return typeof candidate?.providerId === 'string' && candidate.providerId.length > 0
}

function candidateKey(candidate: { providerId: string; modelId?: string }): string {
  return `${candidate.providerId.toLowerCase()}/${(candidate.modelId ?? '').toLowerCase()}`
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
  candidate: { providerId: string; modelId?: string; tier: RoutingTier | 'default' },
): void {
  const key = candidateKey(candidate)
  if (seen.has(key)) return
  seen.add(key)
  out.push({ providerId: candidate.providerId, modelId: candidate.modelId ?? '', tier: candidate.tier })
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
    return [{ providerId: fallback.providerId, modelId: fallback.modelId ?? '' }]
  })

  const sanitized: TierConfig = {
    providerId: config.providerId,
    modelId: config.modelId ?? '',
  }
  if (fallbacks.length > 0) sanitized.fallbacks = fallbacks
  return sanitized
}

function sanitizeRoutingMap<T extends string>(
  map: Partial<Record<T, TierConfig>>,
  readiness: RoutingProviderModelReadiness,
): Partial<Record<T, TierConfig>> {
  const sanitized: Partial<Record<T, TierConfig>> = {}
  for (const [key, config] of Object.entries(map) as Array<[T, TierConfig | undefined]>) {
    const sanitizedConfig = sanitizeTierConfig(config, readiness)
    if (sanitizedConfig) sanitized[key] = sanitizedConfig
  }
  return sanitized
}

// Coleta os modelos configurados nos tiers como pool de fallback, ordenados do
// mais capaz (reasoning) ao mais simples, deduplicados por provider/modelo.
function collectTierCandidates(config: RoutingConfigData, seen: Set<string>): RoutingCandidate[] {
  const order: Array<RoutingTier | 'default'> = ['reasoning', 'complex', 'standard', 'simple', 'default']
  const out: RoutingCandidate[] = []
  for (const tier of order) {
    const cfg = config.tiers[tier]
    if (!hasProvider(cfg)) continue
    pushCandidate(out, seen, { providerId: cfg.providerId, modelId: cfg.modelId, tier })
  }
  return out
}

function collectExplicitFallbacks(
  assignment: TierConfig | undefined,
  fallbackTier: RoutingTier | 'default',
  seen: Set<string>,
): RoutingCandidate[] {
  const out: RoutingCandidate[] = []
  for (const fallback of assignment?.fallbacks ?? []) {
    if (!hasProvider(fallback)) continue
    pushCandidate(out, seen, { providerId: fallback.providerId, modelId: fallback.modelId, tier: fallbackTier })
  }
  return out
}

function withFallbacks(
  result: Omit<RoutingResult, 'fallbacks'>,
  config: RoutingConfigData,
  assignment?: TierConfig,
): RoutingResult {
  const seen = new Set<string>([candidateKey(result)])
  const fallbacks = [
    ...collectExplicitFallbacks(assignment, result.tier, seen),
    ...collectTierCandidates(config, seen),
  ]
  return { ...result, fallbacks }
}

// Cache simples de configuração por userId (60s TTL) para evitar DB hits por request
const configCache = new Map<string, { data: RoutingConfigData | null; expiresAt: number }>()
const CONFIG_CACHE_TTL_MS = 60_000

export async function getRoutingConfig(userId: string): Promise<RoutingConfigData | null> {
  const cached = configCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const row = await prisma.routingConfig.findUnique({ where: { userId } })
  if (!row) {
    configCache.set(userId, { data: null, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS })
    return null
  }

  const { getConfiguredRoutingProviderModelReadiness } = await import('./provider-readiness')
  const readiness = await getConfiguredRoutingProviderModelReadiness(userId)
  const tiers = sanitizeRoutingMap(
    (row.tiers as unknown as Partial<Record<RoutingTier | 'default', TierConfig>>) ?? {},
    readiness,
  )
  const taskOverrides = sanitizeRoutingMap(
    (row.taskOverrides as unknown as Partial<Record<TaskCategory, TierConfig>>) ?? {},
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

  const textMessages = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }))

  // 1. Header override — tier forçado pelo cliente
  if (forcedTier) {
    const tierConfig = config.tiers[forcedTier] ?? config.tiers['default']
    if (tierConfig) {
      recordTierAssignment(userId, forcedTier)
      return withFallbacks({
        providerId: tierConfig.providerId,
        modelId: tierConfig.modelId,
        tier: forcedTier,
        reason: 'header_override',
        taskCategory: null,
      }, config, tierConfig)
    }
  }

  // 2. Task-specific routing
  if (config.taskRoutingEnabled) {
    const taskResult = detectTaskCategory(messages as Array<{ role: string; content: unknown }>, toolNames)
    if (taskResult && taskResult.confidence >= 0.4) {
      const taskConfig = config.taskOverrides[taskResult.category]
      if (taskConfig) {
        return withFallbacks({
          providerId: taskConfig.providerId,
          modelId: taskConfig.modelId,
          tier: 'default',
          reason: 'task_specific',
          taskCategory: taskResult.category,
        }, config, taskConfig)
      }
    }
  }

  // 3. Complexity routing
  if (config.complexityEnabled) {
    const scored = scoreComplexity(textMessages, { hasTools: (toolNames?.length ?? 0) > 0 })

    // Momentum bias — tenta manter consistência na sessão
    const momentum = getMomentumBias(userId)
    let resolvedTier: RoutingTier = scored.tier
    let reason: RoutingResult['reason'] = 'scored'

    if (momentum && scored.rawScore < 50) {
      // Não faz downgrade de tier quando há momentum de sessão
      const tierOrder: RoutingTier[] = ['simple', 'standard', 'complex', 'reasoning']
      const momentumIdx = tierOrder.indexOf(momentum)
      const scoredIdx = tierOrder.indexOf(scored.tier)
      if (scoredIdx < momentumIdx) {
        resolvedTier = momentum
        reason = 'momentum_bias'
      }
    }

    const tierConfig = config.tiers[resolvedTier] ?? config.tiers['default']
    if (tierConfig) {
      recordTierAssignment(userId, resolvedTier)
      return withFallbacks({
        providerId: tierConfig.providerId,
        modelId: tierConfig.modelId,
        tier: resolvedTier,
        reason,
        taskCategory: null,
        complexityScore: scored.rawScore,
        confidence: scored.confidence,
      }, config, tierConfig)
    }
  }

  // 4. Default tier
  const defaultConfig = config.tiers['default']
  if (defaultConfig) {
    return withFallbacks({
      providerId: defaultConfig.providerId,
      modelId: defaultConfig.modelId,
      tier: 'default',
      reason: 'config_default',
      taskCategory: null,
    }, config, defaultConfig)
  }

  return null
}
