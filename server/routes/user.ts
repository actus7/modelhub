import { Hono } from "hono";
import {
  apiKeyLabelSchema,
  providerCredentialSchema,
} from "@/lib/contracts";

import { encryptCredential, generateApiKey } from "../lib/crypto";
import { prisma } from "../lib/db";
import { jsonErrorResponse } from "../lib/provider-core";
import { authenticateAccess, protectedCors, securityHeaders } from "../lib/security";
import { requireAuth } from "./route-helpers";

const app = new Hono().basePath("/user");
app.use("*", securityHeaders);
app.use("*", protectedCors);

app.use("*", async (c, next) => {
  const authError = await authenticateAccess(c);
  if (authError) return authError;
  return next();
});


app.get("/api-keys", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const keys = await prisma.apiKey.findMany({
    where: { isActive: true, userId },
    select: {
      createdAt: true,
      expiresAt: true,
      id: true,
      label: true,
      lastUsedAt: true,
      prefix: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return c.json({ keys });
});

app.post("/api-keys", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const body = await c.req.json().catch(() => ({}));
  const parsed = apiKeyLabelSchema.safeParse(body);
  const label = parsed.success ? parsed.data.label ?? "default" : "default";

  const { hash, prefix, raw } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: {
      key: hash,
      label,
      prefix,
      userId,
    },
    select: {
      createdAt: true,
      id: true,
      label: true,
      prefix: true,
    },
  });

  return c.json({ ...created, apiKey: raw }, 201);
});

app.delete("/api-keys/:id", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const keyId = c.req.param("id");
  const key = await prisma.apiKey.findFirst({ where: { id: keyId, userId } });
  if (!key) return jsonErrorResponse(404, "API key not found");

  const activeCount = await prisma.apiKey.count({
    where: { isActive: true, userId },
  });
  if (activeCount <= 1) {
    return jsonErrorResponse(400, "Cannot revoke your only active API key");
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { isActive: false },
  });

  return c.json({ success: true });
});

app.get("/credentials", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const credentials = await prisma.providerCredential.findMany({
    where: { userId },
    select: {
      createdAt: true,
      credentialKey: true,
      id: true,
      providerId: true,
      updatedAt: true,
    },
    orderBy: [{ providerId: "asc" }, { credentialKey: "asc" }],
  });

  return c.json({ credentials });
});

app.post("/credentials", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const body = await c.req.json().catch(() => null);
  const parsed = providerCredentialSchema.safeParse(body);
  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid input", {
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { credentialKey, credentialValue, providerId } = parsed.data;
  const encrypted = encryptCredential(credentialValue);
  const credential = await prisma.providerCredential.upsert({
    where: {
      userId_providerId_credentialKey: {
        credentialKey,
        providerId,
        userId,
      },
    },
    update: {
      credentialValue: encrypted,
    },
    create: {
      credentialKey,
      credentialValue: encrypted,
      providerId,
      userId,
    },
    select: {
      credentialKey: true,
      id: true,
      providerId: true,
      updatedAt: true,
    },
  });

  return c.json({ credential }, 201);
});

app.delete("/credentials/:id", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const credentialId = c.req.param("id");
  const credential = await prisma.providerCredential.findFirst({
    where: { id: credentialId, userId },
  });
  if (!credential) return jsonErrorResponse(404, "Credential not found");

  await prisma.providerCredential.delete({ where: { id: credentialId } });
  return c.json({ success: true });
});

app.get("/usage", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const daysParam = Number(c.req.query("days") ?? "30");
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [totalRequests, byProvider, byModel, byStatus, aggregates, dailyLogs] = await Promise.all([
    prisma.usageLog.count({ where: { createdAt: { gte: since }, userId } }),
    prisma.usageLog.groupBy({
      by: ["providerId"],
      where: { createdAt: { gte: since }, userId },
      _count: { id: true },
      _sum: { costUsd: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.usageLog.groupBy({
      by: ["modelId"],
      where: { createdAt: { gte: since }, modelId: { not: null }, userId },
      _count: { id: true },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
    prisma.usageLog.groupBy({
      by: ["statusCode"],
      where: { createdAt: { gte: since }, userId },
      _count: { id: true },
      orderBy: { statusCode: "asc" },
    }),
    prisma.usageLog.aggregate({
      where: { createdAt: { gte: since }, userId },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _avg: { durationMs: true },
    }),
    prisma.usageLog.findMany({
      where: { createdAt: { gte: since }, userId },
      select: { createdAt: true, costUsd: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const dailyMap = new Map<string, { count: number; costUsd: number }>();
  for (const log of dailyLogs) {
    const day = log.createdAt.toISOString().slice(0, 10);
    const prev = dailyMap.get(day) ?? { count: 0, costUsd: 0 };
    dailyMap.set(day, { count: prev.count + 1, costUsd: prev.costUsd + (log.costUsd ?? 0) });
  }

  type StatusRow = { statusCode: number; _count: { id: number } };
  type ModelRow = { modelId: string | null; _count: { id: number }; _sum: { costUsd: number | null; inputTokens: number | null; outputTokens: number | null } };
  type ProviderRow = { providerId: string; _count: { id: number }; _sum: { costUsd: number | null } };

  const errorCount = (byStatus as StatusRow[])
    .filter((s) => s.statusCode >= 400)
    .reduce((sum, s) => sum + s._count.id, 0);
  const errorRate = totalRequests > 0 ? +(errorCount / totalRequests * 100).toFixed(2) : 0;

  return c.json({
    byModel: (byModel as ModelRow[]).map((e) => ({
      count: e._count.id,
      model: e.modelId,
      costUsd: e._sum.costUsd ?? 0,
      inputTokens: e._sum.inputTokens ?? 0,
      outputTokens: e._sum.outputTokens ?? 0,
    })),
    byProvider: (byProvider as ProviderRow[]).map((e) => ({
      count: e._count.id,
      provider: e.providerId,
      costUsd: e._sum.costUsd ?? 0,
    })),
    byStatus: (byStatus as StatusRow[]).map((e) => ({ count: e._count.id, status: e.statusCode })),
    daily: Array.from(dailyMap.entries()).map(([date, d]) => ({ date, count: d.count, costUsd: d.costUsd })),
    errorRate,
    period: { days, since: since.toISOString() },
    totalRequests,
    totalCostUsd: aggregates._sum.costUsd ?? 0,
    avgDurationMs: aggregates._avg.durationMs ?? null,
    tokenStats: {
      totalInput: aggregates._sum.inputTokens ?? 0,
      totalOutput: aggregates._sum.outputTokens ?? 0,
    },
  });
});

app.get("/usage/recent", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const limitParam = Number(c.req.query("limit") ?? "50");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

  const logs = await prisma.usageLog.findMany({
    where: { userId },
    select: {
      apiKey: { select: { label: true, prefix: true } },
      createdAt: true,
      endpoint: true,
      errorDetail: true,
      id: true,
      modelId: true,
      providerId: true,
      statusCode: true,
      inputTokens: true,
      outputTokens: true,
      costUsd: true,
      durationMs: true,
      routingTier: true,
      taskCategory: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return c.json({ logs });
});

// GET /user/routing-config
app.get("/routing-config", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const config = await prisma.routingConfig.findUnique({ where: { userId } });
  if (!config) {
    return c.json({ complexityEnabled: false, taskRoutingEnabled: false, tiers: {}, taskOverrides: {} });
  }

  return c.json({
    complexityEnabled: config.complexityEnabled,
    taskRoutingEnabled: config.taskRoutingEnabled,
    tiers: config.tiers,
    taskOverrides: config.taskOverrides,
  });
});

// PUT/PATCH /user/routing-config
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const routingConfigUpdateHandler = async (c: any) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  let body: unknown;
  try { body = await c.req.json() } catch { return c.json({ error: "Invalid JSON" }, 400) }

  const data = body as Record<string, unknown>;
  const config = await prisma.routingConfig.upsert({
    where: { userId },
    create: {
      userId,
      complexityEnabled: Boolean(data.complexityEnabled),
      taskRoutingEnabled: Boolean(data.taskRoutingEnabled),
      tiers: (data.tiers as object) ?? {},
      taskOverrides: (data.taskOverrides as object) ?? {},
    },
    update: {
      complexityEnabled: data.complexityEnabled !== undefined ? Boolean(data.complexityEnabled) : undefined,
      taskRoutingEnabled: data.taskRoutingEnabled !== undefined ? Boolean(data.taskRoutingEnabled) : undefined,
      tiers: data.tiers !== undefined ? (data.tiers as object) : undefined,
      taskOverrides: data.taskOverrides !== undefined ? (data.taskOverrides as object) : undefined,
    },
  });

  // Invalidar cache de roteamento
  const { invalidateRoutingCache } = await import('../lib/routing/routing-resolver');
  invalidateRoutingCache(userId);

  return c.json({
    complexityEnabled: config.complexityEnabled,
    taskRoutingEnabled: config.taskRoutingEnabled,
    tiers: config.tiers,
    taskOverrides: config.taskOverrides,
  });
};

app.put("/routing-config", routingConfigUpdateHandler);
app.patch("/routing-config", routingConfigUpdateHandler);

// GET /user/budget
app.get("/budget", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const { getPeriodStart } = await import('../lib/budget');
  const budget = await prisma.userBudget.findUnique({ where: { userId } });

  const periodType = budget?.periodType ?? "monthly";
  const periodStart = getPeriodStart(periodType);

  const agg = await prisma.usageLog.aggregate({
    where: { userId, createdAt: { gte: periodStart }, costUsd: { not: null } },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
  });
  const currentSpend = agg._sum.costUsd ?? 0;

  // Calcular savings vs baseline model
  let baselineSpend: number | null = null;
  let savings: number | null = null;
  let savingsPct: number | null = null;

  if (budget?.baselineModelId) {
    const { calculateCostUsd } = await import('../lib/model-pricing');
    const baseProviderId = budget.baselineModelId.split('/')[0] ?? '';
    const baseModelId = budget.baselineModelId.split('/').slice(1).join('/') ?? budget.baselineModelId;

    const tokensLogs = await prisma.usageLog.findMany({
      where: { userId, createdAt: { gte: periodStart }, inputTokens: { not: null } },
      select: { inputTokens: true, outputTokens: true },
    });

    baselineSpend = tokensLogs.reduce((sum, log) => {
      const cost = calculateCostUsd(baseProviderId, baseModelId, log.inputTokens ?? 0, log.outputTokens ?? 0);
      return sum + (cost ?? 0);
    }, 0);

    savings = baselineSpend - currentSpend;
    savingsPct = baselineSpend > 0 ? Math.round((savings / baselineSpend) * 100) : null;
  }

  return c.json({
    periodType,
    limitUsd: budget?.limitUsd ?? null,
    alertThreshold: budget?.alertThreshold ?? 0.8,
    blocksRequests: budget?.blocksRequests ?? false,
    baselineModelId: budget?.baselineModelId ?? null,
    currentSpend,
    baselineSpend,
    savings,
    savingsPct,
  });
});

// PATCH /user/budget
app.patch("/budget", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  let body: unknown;
  try { body = await c.req.json() } catch { return c.json({ error: "Invalid JSON" }, 400) }

  const data = body as Record<string, unknown>;
  const budget = await prisma.userBudget.upsert({
    where: { userId },
    create: {
      userId,
      periodType: (data.periodType as string) ?? "monthly",
      limitUsd: data.limitUsd != null ? Number(data.limitUsd) : null,
      alertThreshold: data.alertThreshold != null ? Number(data.alertThreshold) : 0.8,
      blocksRequests: data.blocksRequests != null ? Boolean(data.blocksRequests) : false,
      baselineModelId: (data.baselineModelId as string | null) ?? null,
    },
    update: {
      periodType: data.periodType !== undefined ? (data.periodType as string) : undefined,
      limitUsd: data.limitUsd !== undefined ? (data.limitUsd != null ? Number(data.limitUsd) : null) : undefined,
      alertThreshold: data.alertThreshold !== undefined ? Number(data.alertThreshold) : undefined,
      blocksRequests: data.blocksRequests !== undefined ? Boolean(data.blocksRequests) : undefined,
      baselineModelId: data.baselineModelId !== undefined ? (data.baselineModelId as string | null) : undefined,
    },
  });

  const { invalidateBudgetCache } = await import('../lib/budget');
  invalidateBudgetCache(userId);

  return c.json({ success: true, budget });
});

// --- Custom Instructions (UserSettings) ---

app.get("/settings", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  return c.json({
    settings: settings ?? { customInstructionsAbout: null, customInstructionsStyle: null },
  });
});

app.patch("/settings", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const body = await c.req.json().catch(() => ({})) as {
    customInstructionsAbout?: string | null;
    customInstructionsStyle?: string | null;
  };

  const settings = await prisma.userSettings.upsert({
    where: { userId },
    update: {
      customInstructionsAbout: body.customInstructionsAbout ?? null,
      customInstructionsStyle: body.customInstructionsStyle ?? null,
    },
    create: {
      userId,
      customInstructionsAbout: body.customInstructionsAbout ?? null,
      customInstructionsStyle: body.customInstructionsStyle ?? null,
    },
  });

  return c.json({ settings });
});

// --- User Memory (cross-conversation) ---

app.get("/memories", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const memories = await prisma.userMemory.findMany({
    where: { userId },
    select: { id: true, content: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return c.json({ memories });
});

app.post("/memories", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const body = await c.req.json().catch(() => ({})) as { content?: string };
  if (!body.content?.trim()) return jsonErrorResponse(400, "content is required");

  const memory = await prisma.userMemory.create({
    data: { userId, content: body.content.trim() },
    select: { id: true, content: true, createdAt: true },
  });

  return c.json({ memory }, 201);
});

app.delete("/memories/:id", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const memoryId = c.req.param("id");
  const existing = await prisma.userMemory.findFirst({ where: { id: memoryId, userId } });
  if (!existing) return jsonErrorResponse(404, "Memory not found");

  await prisma.userMemory.delete({ where: { id: memoryId } });
  return c.json({ success: true });
});

app.get("/me", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      _count: {
        select: {
          apiKeys: { where: { isActive: true } },
          providerCredentials: true,
          usageLogs: true,
        },
      },
      createdAt: true,
      email: true,
      id: true,
      isActive: true,
      isAdmin: true,
      name: true,
    },
  });

  if (!user) {
    return jsonErrorResponse(404, "User not found");
  }

  return c.json({
    user: {
      counts: {
        activeApiKeys: user._count.apiKeys,
        providerCredentials: user._count.providerCredentials,
        totalRequests: user._count.usageLogs,
      },
      createdAt: user.createdAt,
      email: user.email,
      id: user.id,
      isActive: user.isActive,
      isAdmin: user.isAdmin,
      name: user.name,
    },
  });
});

export default app.fetch;
