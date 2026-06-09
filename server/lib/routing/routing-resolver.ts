import { prisma } from '../db'
import { scoreComplexity, type RoutingTier } from './complexity-scorer'
import { detectTaskCategory, type TaskCategory } from './task-detector'
import { getMomentumBias, recordTierAssignment } from './session-momentum'

export interface TierConfig {
  providerId: string
  modelId: string
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
  /// Modelos alternativos (outros tiers configurados) tentados em ordem se o primário falhar.
  fallbacks: RoutingCandidate[]
}

// Coleta os modelos configurados nos tiers como pool de fallback, ordenados do
// mais capaz (reasoning) ao mais simples, deduplicados por provider/modelo.
function collectCandidates(config: RoutingConfigData): RoutingCandidate[] {
  const order: Array<RoutingTier | 'default'> = ['reasoning', 'complex', 'standard', 'simple', 'default']
  const seen = new Set<string>()
  const out: RoutingCandidate[] = []
  for (const tier of order) {
    const cfg = config.tiers[tier]
    if (!cfg || !cfg.providerId || !cfg.modelId) continue
    const key = `${cfg.providerId}/${cfg.modelId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ providerId: cfg.providerId, modelId: cfg.modelId, tier })
  }
  return out
}

function withFallbacks(result: Omit<RoutingResult, 'fallbacks'>, config: RoutingConfigData): RoutingResult {
  const primaryKey = `${result.providerId.toLowerCase()}/${result.modelId.toLowerCase()}`
  const fallbacks = collectCandidates(config).filter(
    (c) => `${c.providerId.toLowerCase()}/${c.modelId.toLowerCase()}` !== primaryKey,
  )
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

  const data: RoutingConfigData = {
    complexityEnabled: row.complexityEnabled,
    taskRoutingEnabled: row.taskRoutingEnabled,
    tiers: (row.tiers as unknown as Record<string, TierConfig>) ?? {},
    taskOverrides: (row.taskOverrides as unknown as Record<string, TierConfig>) ?? {},
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
      }, config)
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
        }, config)
      }
    }
  }

  // 3. Complexity routing
  if (config.complexityEnabled) {
    const scored = scoreComplexity(textMessages)

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
      }, config)
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
    }, config)
  }

  return null
}
