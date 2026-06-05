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

  const totalRequests = await prisma.usageLog.count({
    where: {
      createdAt: { gte: since },
      userId,
    },
  });

  const byProvider = await prisma.usageLog.groupBy({
    by: ["providerId"],
    where: {
      createdAt: { gte: since },
      userId,
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  const byModel = await prisma.usageLog.groupBy({
    by: ["modelId"],
    where: {
      createdAt: { gte: since },
      modelId: { not: null },
      userId,
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });

  const byStatus = await prisma.usageLog.groupBy({
    by: ["statusCode"],
    where: {
      createdAt: { gte: since },
      userId,
    },
    _count: { id: true },
    orderBy: { statusCode: "asc" },
  });

  const recentLogs = await prisma.usageLog.findMany({
    where: {
      createdAt: { gte: since },
      userId,
    },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const dailyMap = new Map<string, number>();
  for (const log of recentLogs) {
    const day = log.createdAt.toISOString().slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  }

  type StatusRow = { statusCode: number; _count: { id: number } };
  type ModelRow = { modelId: string | null; _count: { id: number } };
  type ProviderRow = { providerId: string; _count: { id: number } };

  const errorCount = (byStatus as StatusRow[])
    .filter((status) => status.statusCode >= 400)
    .reduce((sum, status) => sum + status._count.id, 0);
  const errorRate = totalRequests > 0 ? +(errorCount / totalRequests * 100).toFixed(2) : 0;

  return c.json({
    byModel: (byModel as ModelRow[]).map((entry) => ({ count: entry._count.id, model: entry.modelId })),
    byProvider: (byProvider as ProviderRow[]).map((entry) => ({ count: entry._count.id, provider: entry.providerId })),
    byStatus: (byStatus as StatusRow[]).map((entry) => ({ count: entry._count.id, status: entry.statusCode })),
    daily: Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count })),
    errorRate,
    period: {
      days,
      since: since.toISOString(),
    },
    totalRequests,
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
      apiKey: {
        select: {
          label: true,
          prefix: true,
        },
      },
      createdAt: true,
      endpoint: true,
      errorDetail: true,
      id: true,
      modelId: true,
      providerId: true,
      statusCode: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return c.json({ logs });
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
