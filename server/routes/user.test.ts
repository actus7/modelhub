import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  apiKey: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  providerCredential: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  providerQuota: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  usageLog: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  userSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  userBudget: { upsert: vi.fn() },
  routingConfig: { upsert: vi.fn() },
  userMemory: { create: vi.fn() },
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));
vi.mock("../lib/crypto", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/crypto")>();
  return { ...orig, hashApiKey: vi.fn().mockReturnValue("mocked-hash"), encryptCredential: vi.fn().mockReturnValue("iv:cipher:tag") };
});

import { Hono } from "hono";
const { default: userFetch } = await import("../routes/user");

const UID = "test-user-123";
const AUTH = { Authorization: "Bearer sk-test" };
const mkApp = () => {
  const a = new Hono();
  a.use("/user/*", async (c) => await userFetch(c.req.raw));
  return a;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.apiKey.findFirst.mockResolvedValue({ id: "key-1", userId: UID, expiresAt: null });
  mockPrisma.apiKey.update.mockResolvedValue({});
});

describe("GET /user/me", () => {
  it("returns user profile", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: UID, email: "a@b.com", name: "A", isActive: true, isAdmin: false, createdAt: new Date(),
      _count: { apiKeys: 1, providerCredentials: 2, usageLogs: 10 },
    });
    const res = await mkApp().request("/user/me", { headers: AUTH });
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe("a@b.com");
  });

  it("returns 401 without auth", async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValue(null);
    expect((await mkApp().request("/user/me")).status).toBe(401);
  });
});

describe("GET /user/api-keys", () => {
  it("returns active keys", async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([
      { id: "k1", prefix: "sk-abc", label: "default", createdAt: new Date(), lastUsedAt: null, expiresAt: null },
    ]);
    const res = await mkApp().request("/user/api-keys", { headers: AUTH });
    expect(res.status).toBe(200);
    expect((await res.json()).keys).toHaveLength(1);
  });
});

describe("POST /user/api-keys", () => {
  it("creates a new key", async () => {
    mockPrisma.apiKey.create.mockResolvedValue({ id: "nk", label: "my-key", prefix: "sk-n", createdAt: new Date() });
    const res = await mkApp().request("/user/api-keys", {
      method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "my-key" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.label).toBe("my-key");
    expect(body.apiKey).toBeDefined();
  });
});

describe("DELETE /user/api-keys/:id", () => {
  it("revokes key when multiple exist", async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce({ id: "key-1", userId: UID, expiresAt: null })
      .mockResolvedValueOnce({ id: "kd", userId: UID });
    mockPrisma.apiKey.count.mockResolvedValue(2);
    mockPrisma.apiKey.update.mockResolvedValue({});
    expect((await mkApp().request("/user/api-keys/kd", { method: "DELETE", headers: AUTH })).status).toBe(200);
  });

  it("blocks revoking last key", async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce({ id: "key-1", userId: UID, expiresAt: null })
      .mockResolvedValueOnce({ id: "ko", userId: UID });
    mockPrisma.apiKey.count.mockResolvedValue(1);
    expect((await mkApp().request("/user/api-keys/ko", { method: "DELETE", headers: AUTH })).status).toBe(400);
  });
});

describe("POST /user/credentials", () => {
  it("creates a credential", async () => {
    mockPrisma.providerCredential.upsert.mockResolvedValue({
      id: "c1", providerId: "openrouter", credentialKey: "API_KEY", updatedAt: new Date(),
    });
    const res = await mkApp().request("/user/credentials", {
      method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "openrouter", credentialKey: "API_KEY", credentialValue: "secret" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).credential.providerId).toBe("openrouter");
  });

  it("returns 400 for invalid input", async () => {
    const res = await mkApp().request("/user/credentials", {
      method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /user/credentials/:id", () => {
  it("deletes credential", async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce({ id: "key-1", userId: UID, expiresAt: null });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({ id: "c1", userId: UID });
    mockPrisma.providerCredential.delete.mockResolvedValue({});
    expect((await mkApp().request("/user/credentials/c1", { method: "DELETE", headers: AUTH })).status).toBe(200);
  });

  it("returns 404 for missing credential", async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce({ id: "key-1", userId: UID, expiresAt: null });
    mockPrisma.providerCredential.findFirst.mockResolvedValue(null);
    expect((await mkApp().request("/user/credentials/x", { method: "DELETE", headers: AUTH })).status).toBe(404);
  });
});

describe("GET /user/credentials", () => {
  it("lists credentials without values", async () => {
    mockPrisma.providerCredential.findMany.mockResolvedValue([
      { id: "c1", providerId: "openrouter", credentialKey: "API_KEY", createdAt: new Date(), updatedAt: new Date() },
    ]);
    const res = await mkApp().request("/user/credentials", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credentials).toHaveLength(1);
    expect(body.credentials[0]).not.toHaveProperty("credentialValue");
  });
});

describe("GET /user/usage/recent", () => {
  it("requests logs in descending creation order", async () => {
    mockPrisma.usageLog.findMany.mockResolvedValue([]);

    const res = await mkApp().request("/user/usage/recent", { headers: AUTH });

    expect(res.status).toBe(200);
    expect(mockPrisma.usageLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
  });
});

describe("provider quota routes", () => {
  it("returns configured accounts and observed usage", async () => {
    mockPrisma.providerQuota.findMany.mockResolvedValue([]);
    mockPrisma.providerCredential.findMany.mockResolvedValue([
      { providerId: "groq", updatedAt: new Date("2026-08-20T10:00:00.000Z") },
    ]);
    mockPrisma.usageLog.groupBy.mockResolvedValue([]);

    const res = await mkApp().request("/user/quotas", { headers: AUTH });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accounts[0]).toMatchObject({
      providerId: "groq",
      percentage: null,
      status: "monitoring",
    });
  });

  it("validates and persists a provider quota profile", async () => {
    const now = new Date("2026-08-20T10:00:00.000Z");
    mockPrisma.providerQuota.upsert.mockResolvedValue({
      id: "quota-1",
      userId: UID,
      providerId: "groq",
      label: "Conta principal",
      isEnabled: true,
      windowHours: 24,
      requestLimit: 1000,
      tokenLimit: null,
      costLimitUsd: null,
      createdAt: now,
      updatedAt: now,
    });

    const res = await mkApp().request("/user/quotas/groq", {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Conta principal", requestLimit: 1000, windowHours: 24 }),
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.providerQuota.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_providerId: { providerId: "groq", userId: UID } },
      }),
    );
  });

  it("rejects invalid quota limits", async () => {
    const res = await mkApp().request("/user/quotas/groq", {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ requestLimit: -1 }),
    });

    expect(res.status).toBe(400);
    expect(mockPrisma.providerQuota.upsert).not.toHaveBeenCalled();
  });
});

describe("PATCH /user/settings", () => {
  it("preserva instrucoes omitidas ao atualizar apenas a cor de destaque", async () => {
    mockPrisma.userSettings.upsert.mockResolvedValue({
      accentColor: "violet",
      customInstructionsAbout: "Sobre mim",
      customInstructionsStyle: "Direto",
    });

    const res = await mkApp().request("/user/settings", {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ accentColor: "violet" }),
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.userSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { accentColor: "violet" },
      }),
    );
  });

  it("rejeita tipos invalidos sem gravar configuracoes", async () => {
    const res = await mkApp().request("/user/settings", {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ accentColor: 7 }),
    });

    expect(res.status).toBe(400);
    expect(mockPrisma.userSettings.upsert).not.toHaveBeenCalled();
  });
});

const patchJson = (path: string, body: unknown, method = "PATCH") =>
  mkApp().request(path, {
    body: JSON.stringify(body),
    headers: { ...AUTH, "Content-Type": "application/json" },
    method,
  });

describe("PATCH /user/budget", () => {
  it("accepts a valid budget and persists the parsed values", async () => {
    mockPrisma.userBudget.upsert.mockResolvedValue({ id: "b1" });

    const res = await patchJson("/user/budget", { alertThreshold: 0.5, limitUsd: "25", periodType: "weekly" });

    expect(res.status).toBe(200);
    expect(mockPrisma.userBudget.upsert.mock.calls[0]?.[0].update).toMatchObject({
      alertThreshold: 0.5,
      limitUsd: 25,
      periodType: "weekly",
    });
  });

  it("rejects non-numeric limits, out-of-range thresholds and unknown periods", async () => {
    for (const body of [{ limitUsd: "abc" }, { alertThreshold: 80 }, { periodType: "yearly" }, { limitUsd: -1 }]) {
      expect((await patchJson("/user/budget", body)).status).toBe(400);
    }
    expect(mockPrisma.userBudget.upsert).not.toHaveBeenCalled();
  });
});

describe("PUT /user/routing-config", () => {
  it("rejects payloads whose tiers are not a map of objects", async () => {
    const res = await patchJson("/user/routing-config", { tiers: "simple" }, "PUT");

    expect(res.status).toBe(400);
    expect(mockPrisma.routingConfig.upsert).not.toHaveBeenCalled();
  });

  it("stores a valid configuration", async () => {
    const tiers = { simple: { modelId: "m", providerId: "p" } };
    mockPrisma.routingConfig.upsert.mockResolvedValue({
      complexityEnabled: true, taskRoutingEnabled: false, tiers, taskOverrides: {},
    });

    const res = await patchJson("/user/routing-config", { complexityEnabled: true, tiers }, "PUT");

    expect(res.status).toBe(200);
    expect(mockPrisma.routingConfig.upsert.mock.calls[0]?.[0].update).toMatchObject({ complexityEnabled: true, tiers });
  });
});

describe("POST /user/memories", () => {
  it("rejects blank or oversized content", async () => {
    expect((await patchJson("/user/memories", { content: "   " }, "POST")).status).toBe(400);
    expect((await patchJson("/user/memories", { content: "x".repeat(4001) }, "POST")).status).toBe(400);
    expect(mockPrisma.userMemory.create).not.toHaveBeenCalled();
  });
});

describe("unhandled errors", () => {
  it("returns a JSON 500 without leaking the internal message", async () => {
    mockPrisma.apiKey.findMany.mockRejectedValue(new Error("connection string postgres://secret"));

    const res = await mkApp().request("/user/api-keys", { headers: AUTH });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { message: "Internal server error" } });
  });
});
