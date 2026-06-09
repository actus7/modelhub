import type { RoutingTier } from './complexity-scorer'

const TTL_MS = 30 * 60 * 1000 // 30 minutos
const MAX_HISTORY = 5
const MAX_STORE_SIZE = 10_000
const BIAS_THRESHOLD = 0.6 // 60% das últimas 5 devem ser o mesmo tier

interface MomentumEntry {
  history: RoutingTier[]
  lastAt: number
}

const store = new Map<string, MomentumEntry>()

export function getRecentTiers(userId: string): RoutingTier[] {
  const entry = store.get(userId)
  if (!entry) return []
  if (Date.now() - entry.lastAt > TTL_MS) {
    store.delete(userId)
    return []
  }
  return entry.history
}

export function getMomentumBias(userId: string): RoutingTier | null {
  const history = getRecentTiers(userId)
  if (history.length < 3) return null

  const counts: Record<string, number> = {}
  for (const tier of history) {
    counts[tier] = (counts[tier] ?? 0) + 1
  }

  for (const [tier, count] of Object.entries(counts)) {
    if (count / history.length >= BIAS_THRESHOLD) {
      return tier as RoutingTier
    }
  }

  return null
}

export function recordTierAssignment(userId: string, tier: RoutingTier): void {
  if (store.size >= MAX_STORE_SIZE) {
    pruneExpiredEntries()
  }

  const existing = store.get(userId)
  const now = Date.now()

  if (existing && now - existing.lastAt <= TTL_MS) {
    const history = [...existing.history, tier].slice(-MAX_HISTORY)
    store.set(userId, { history, lastAt: now })
  } else {
    store.set(userId, { history: [tier], lastAt: now })
  }
}

function pruneExpiredEntries(): void {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (now - entry.lastAt > TTL_MS) {
      store.delete(key)
    }
  }
}
