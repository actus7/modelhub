import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  apiKey: { findFirst: vi.fn(), update: vi.fn().mockReturnValue({ catch: vi.fn() }) },
  conversation: { create: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  providerCredential: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  usageLog: { count: vi.fn(), create: vi.fn().mockReturnValue({ catch: vi.fn() }), findMany: vi.fn(), groupBy: vi.fn() },
  user: { findUnique: vi.fn(), upsert: vi.fn() },
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));
vi.mock("../lib/crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/crypto")>();
  return {
    ...original,
    hashApiKey: vi.fn((value: string) => `hash:${value}`),
  };
});

const { createApiApp } = await import("../app");

const originalAllowedProxyDomains = process.env.ALLOWED_PROXY_DOMAINS;
const originalRequireAuth = process.env.REQUIRE_AUTH;

describe("custom model proxy", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_PROXY_DOMAINS;
    process.env.REQUIRE_AUTH = "false";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.ALLOWED_PROXY_DOMAINS = originalAllowedProxyDomains;
    process.env.REQUIRE_AUTH = originalRequireAuth;
  });

  it("returns 503 when the custom proxy is not configured", async () => {
    const app = createApiApp();

    const response = await app.request("/custom-model-proxy?url=https://example.com", {
      body: "{}",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Custom proxy is not configured" });
  });
});
