/**
 * Saúde observada por (provedor, modelo), derivada do tráfego real do usuário.
 *
 * Fecha o laço que faltava: até aqui "melhor modelo" era um palpite sobre a
 * nomenclatura do ID. Aqui vira número medido — taxa de erro e latência do que
 * de fato aconteceu nas requisições dele.
 *
 * Deriva de `UsageLog` em vez de uma tabela nova de cooldown por dois motivos:
 * o log já registra `statusCode`, `durationMs` e `createdAt` por requisição
 * (nenhuma migration necessária), e por vir do banco ele é compartilhado entre
 * instâncias — ao contrário do `Map` em memória de `rate-limit-cooldown.ts`,
 * que morre no cold start do serverless e só enxerga a própria instância.
 */

export type ModelHealth = {
  /** Requisições observadas na janela. */
  total: number
  errors: number
  /** 0–1. */
  errorRate: number
  avgDurationMs: number | null
  /** Epoch ms do erro mais recente; null se não houve erro na janela. */
  lastErrorAt: number | null
}

/** Chave `provider/modelo` em minúsculas, igual à usada no resolver. */
export type ModelHealthMap = Map<string, ModelHealth>

export const HEALTH_WINDOW_DAYS = 7

/**
 * Abaixo disso a amostra não sustenta conclusão: um modelo com 1 requisição e
 * 1 erro não é "100% quebrado", é desconhecido. Mantém o score heurístico.
 */
export const MIN_SAMPLE = 5

/** Acima disso o modelo é considerado quebrado e sai da cadeia de roteamento. */
export const UNHEALTHY_ERROR_RATE = 0.5

export function healthKey(providerId: string, modelId: string): string {
  return `${providerId.toLowerCase()}/${modelId.toLowerCase()}`
}

const cache = new Map<string, { data: ModelHealthMap; expiresAt: number }>()
const CACHE_TTL_MS = 60_000

export function invalidateModelHealth(userId: string): void {
  cache.delete(userId)
}

export function clearModelHealthCache(): void {
  cache.clear()
}

export async function getModelHealth(userId: string): Promise<ModelHealthMap> {
  const cached = cache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  // Import dinâmico: `healthKey`/`healthAdjustment`/`isUnhealthy` são puras e
  // consumidas pelo ranking de sugestão, que não deve arrastar o cliente Prisma.
  const { prisma } = await import("../db")

  const since = new Date(Date.now() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const where = { userId, createdAt: { gte: since }, modelId: { not: null } }

  // Duas agregações em vez de SQL cru: o Prisma não expressa contagem
  // condicional num groupBy só, e raw SQL aqui custaria portabilidade.
  const [totals, failures] = await Promise.all([
    prisma.usageLog.groupBy({
      by: ["providerId", "modelId"],
      where,
      _count: { id: true },
      _avg: { durationMs: true },
    }),
    prisma.usageLog.groupBy({
      by: ["providerId", "modelId"],
      where: { ...where, statusCode: { gte: 400 } },
      _count: { id: true },
      _max: { createdAt: true },
    }),
  ])

  type FailureRow = {
    providerId: string
    modelId: string | null
    _count: { id: number }
    _max: { createdAt: Date | null }
  }
  type TotalRow = {
    providerId: string
    modelId: string | null
    _count: { id: number }
    _avg: { durationMs: number | null }
  }

  const failureByKey = new Map<string, FailureRow>()
  for (const row of failures as FailureRow[]) {
    if (!row.modelId) continue
    failureByKey.set(healthKey(row.providerId, row.modelId), row)
  }

  const health: ModelHealthMap = new Map()
  for (const row of totals as TotalRow[]) {
    if (!row.modelId) continue
    const key = healthKey(row.providerId, row.modelId)
    const failure = failureByKey.get(key)
    const total = row._count.id
    const errors = failure?._count.id ?? 0

    health.set(key, {
      total,
      errors,
      errorRate: total > 0 ? errors / total : 0,
      avgDurationMs: row._avg.durationMs,
      lastErrorAt: failure?._max.createdAt?.getTime() ?? null,
    })
  }

  cache.set(userId, { data: health, expiresAt: Date.now() + CACHE_TTL_MS })
  return health
}

/**
 * Um modelo só é declarado insalubre com amostra suficiente. Sem dados ele
 * segue elegível — nunca sabotamos um modelo novo por falta de histórico.
 */
export function isUnhealthy(health: ModelHealth | undefined): boolean {
  if (!health) return false
  if (health.total < MIN_SAMPLE) return false
  return health.errorRate >= UNHEALTHY_ERROR_RATE
}

export type HealthAdjustment = {
  /** Somado ao score heurístico de capacidade. */
  delta: number
  /** Explicação exibida no preview de sugestão. */
  signal: string
}

/**
 * Converte saúde observada em ajuste de ranking. Modelo sem histórico fica
 * neutro e é rotulado como tal, para o preview não fingir confiança que não tem.
 */
export function healthAdjustment(
  health: ModelHealth | undefined,
): HealthAdjustment {
  if (!health || health.total < MIN_SAMPLE) {
    return { delta: 0, signal: "sem dados de uso" }
  }

  const percent = Math.round(health.errorRate * 100)
  const label = `${percent}% de erro em ${health.total} req`

  if (health.errorRate >= UNHEALTHY_ERROR_RATE)
    return { delta: -40, signal: label }
  if (health.errorRate >= 0.2) return { delta: -20, signal: label }
  if (health.errorRate >= 0.05) return { delta: -8, signal: label }
  return { delta: 5, signal: label }
}
