/** Registro de uso (UsageLog): gravação fire-and-forget e atualizações de métricas de stream. */

import { prisma } from "./db";
import { logger } from "./logger";

/**
 * Registra uso no banco de dados em background (fire-and-forget).
 * Nunca lança erro — falhas são logadas silenciosamente.
 */
export const MAX_USAGE_LOG_ERROR_CHARS = 8000;

export function logUsage(data: {
  userId: string | undefined;
  apiKeyId: string | undefined;
  providerId: string;
  modelId: string | undefined;
  endpoint: string | undefined;
  statusCode: number;
  errorDetail?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  durationMs?: number | null;
  routingTier?: string | null;
  routingReason?: string | null;
  taskCategory?: string | null;
  baselineModelId?: string | null;
  baselineCostUsd?: number | null;
  conversationId?: string | null;
  messageId?: string | null;
  ttftMs?: number | null;
}): Promise<string | null> {
  if (!data.userId) return Promise.resolve(null);

  const errorDetail =
    data.errorDetail && data.errorDetail.length > 0
      ? data.errorDetail.slice(0, MAX_USAGE_LOG_ERROR_CHARS)
      : null;

  return prisma.usageLog
    .create({
      data: {
        userId: data.userId,
        apiKeyId: data.apiKeyId ?? null,
        providerId: data.providerId,
        modelId: data.modelId ?? null,
        endpoint: data.endpoint ?? null,
        statusCode: data.statusCode,
        errorDetail,
        inputTokens: data.inputTokens ?? null,
        outputTokens: data.outputTokens ?? null,
        costUsd: data.costUsd ?? null,
        durationMs: data.durationMs ?? null,
        routingTier: data.routingTier ?? null,
        routingReason: data.routingReason ?? null,
        taskCategory: data.taskCategory ?? null,
        baselineModelId: data.baselineModelId ?? null,
        baselineCostUsd: data.baselineCostUsd ?? null,
        conversationId: data.conversationId ?? null,
        messageId: data.messageId ?? null,
        ttftMs: data.ttftMs ?? null,
      },
      select: { id: true },
    })
    .then((log) => log.id)
    .catch((err: unknown) => {
      logger.error("usage_log.record_failed", { error: err });
      return null;
    });
}

const MAX_USAGE_CORRELATION_ID_LENGTH = 64;

function sanitizeUsageCorrelationId(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized.length > MAX_USAGE_CORRELATION_ID_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export async function resolveUsageCorrelation(
  userId: string | undefined,
  conversationHeader: string | undefined,
  messageHeader: string | undefined,
): Promise<{ conversationId: string | null; messageId: string | null }> {
  if (!userId) return { conversationId: null, messageId: null };

  const conversationId = sanitizeUsageCorrelationId(conversationHeader);
  const messageId = sanitizeUsageCorrelationId(messageHeader);
  if (!conversationId) return { conversationId: null, messageId: null };

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    return conversation ? { conversationId, messageId } : { conversationId: null, messageId: null };
  } catch (error) {
    logger.warn("usage_log.correlation_failed", { error });
    return { conversationId: null, messageId: null };
  }
}

export async function updateUsageLogTiming(logId: string, ttftMs: number): Promise<void> {
  await prisma.usageLog
    .update({
      where: { id: logId },
      data: { ttftMs },
    })
    .catch((err: unknown) => {
      logger.error("usage_log.ttft_update_failed", { error: err });
    });
}

export async function updateUsageLogDuration(logId: string, durationMs: number): Promise<void> {
  await prisma.usageLog
    .update({
      where: { id: logId },
      data: { durationMs },
    })
    .catch((err: unknown) => {
      logger.error("usage_log.duration_update_failed", { error: err });
    });
}

export async function updateUsageLogTokens(
  logId: string,
  tokens: { inputTokens: number; completionTokens: number },
  providerId: string,
  modelId: string | undefined,
): Promise<void> {
  const { calculateCostUsd } = await import("./model-pricing");
  // Garante que o cache de preços esteja carregado antes de calcular o custo.
  // updateUsageLogTokens já roda em background, então o await é seguro e evita
  // que a primeira chamada de um modelo dinâmico calcule custo como null.
  const { ensureOpenRouterPricingFresh } = await import("./openrouter-pricing");
  await ensureOpenRouterPricingFresh().catch(() => {});
  const costUsd = modelId
    ? calculateCostUsd(providerId, modelId, tokens.inputTokens, tokens.completionTokens)
    : null;

  await prisma.usageLog
    .update({
      where: { id: logId },
      data: {
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.completionTokens,
        costUsd,
      },
    })
    .catch((err: unknown) => {
      logger.error("usage_log.tokens_update_failed", { error: err });
    });
}
