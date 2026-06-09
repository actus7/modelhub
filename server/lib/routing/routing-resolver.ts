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

export interface RoutingResult {
  providerId: string
  modelId: string
  tier: RoutingTier | 'default'
  reason: 'header_override' | 'task_specific' | 'scored' | 'momentum_bias' | 'config_default'
  taskCategory: TaskCategory | null
  complexityScore?: number
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
      return {
        providerId: tierConfig.providerId,
        modelId: tierConfig.modelId,
        tier: forcedTier,
        reason: 'header_override',
        taskCategory: null,
      }
    }
  }

  // 2. Task-specific routing
  if (config.taskRoutingEnabled) {
    const taskResult = detectTaskCategory(messages as Array<{ role: string; content: unknown }>, toolNames)
    if (taskResult && taskResult.confidence >= 0.4) {
      const taskConfig = config.taskOverrides[taskResult.category]
      if (taskConfig) {
        return {
          providerId: taskConfig.providerId,
          modelId: taskConfig.modelId,
          tier: 'default',
          reason: 'task_specific',
          taskCategory: taskResult.category,
        }
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
      return {
        providerId: tierConfig.providerId,
        modelId: tierConfig.modelId,
        tier: resolvedTier,
        reason,
        taskCategory: null,
        complexityScore: scored.rawScore,
      }
    }
  }

  // 4. Default tier
  const defaultConfig = config.tiers['default']
  if (defaultConfig) {
    return {
      providerId: defaultConfig.providerId,
      modelId: defaultConfig.modelId,
      tier: 'default',
      reason: 'config_default',
      taskCategory: null,
    }
  }

  return null
}
