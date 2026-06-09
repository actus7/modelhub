import { prisma } from './db'

// Cache em memória de 60s para evitar DB hit por request
const budgetCache = new Map<string, { limitUsd: number | null; blocksRequests: boolean; expiresAt: number }>()
const BUDGET_CACHE_TTL_MS = 60_000

export async function checkBudget(
  userId: string,
): Promise<{ allowed: boolean; periodSpendUsd: number; limitUsd: number | null }> {
  const cached = budgetCache.get(userId)
  let limitUsd: number | null = null
  let blocksRequests = false

  if (cached && cached.expiresAt > Date.now()) {
    limitUsd = cached.limitUsd
    blocksRequests = cached.blocksRequests
  } else {
    const budget = await prisma.userBudget.findUnique({ where: { userId } })
    if (!budget || !budget.limitUsd) {
      budgetCache.set(userId, { limitUsd: null, blocksRequests: false, expiresAt: Date.now() + BUDGET_CACHE_TTL_MS })
      return { allowed: true, periodSpendUsd: 0, limitUsd: null }
    }
    limitUsd = budget.limitUsd
    blocksRequests = budget.blocksRequests
    budgetCache.set(userId, { limitUsd, blocksRequests, expiresAt: Date.now() + BUDGET_CACHE_TTL_MS })
  }

  if (!limitUsd) return { allowed: true, periodSpendUsd: 0, limitUsd: null }

  const budget = await prisma.userBudget.findUnique({ where: { userId } })
  const periodStart = getPeriodStart(budget?.periodType ?? 'monthly')

  const agg = await prisma.usageLog.aggregate({
    where: { userId, createdAt: { gte: periodStart }, costUsd: { not: null } },
    _sum: { costUsd: true },
  })
  const periodSpendUsd = agg._sum.costUsd ?? 0

  if (blocksRequests && periodSpendUsd >= limitUsd) {
    return { allowed: false, periodSpendUsd, limitUsd }
  }

  return { allowed: true, periodSpendUsd, limitUsd }
}

export function invalidateBudgetCache(userId: string): void {
  budgetCache.delete(userId)
}

export function getPeriodStart(periodType: string): Date {
  const now = new Date()
  if (periodType === 'daily') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }
  if (periodType === 'weekly') {
    const day = now.getUTCDay()
    const diff = day === 0 ? 6 : day - 1 // Segunda-feira como início
    const start = new Date(now)
    start.setUTCDate(now.getUTCDate() - diff)
    start.setUTCHours(0, 0, 0, 0)
    return start
  }
  // monthly (default)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}
