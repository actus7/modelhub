import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({
  prisma: {
    conversationAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
    usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
  },
}));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));

const cloudflareFetch = (await import("../providers/cloudflareworkersai")).default;
const { fetchCloudflareModels } = await import("../providers/cloudflareworkersai");

describe("Cloudflare Workers AI provider", () => {
  const originalFetch = globalThis.fetch;
  const originalRequireAuth = process.env.REQUIRE_AUTH;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.REQUIRE_AUTH = originalRequireAuth;
    vi.unstubAllEnvs();
  });

  it("validates credentials with token verification only", async () => {
    process.env.REQUIRE_AUTH = "false";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { id: "token-id", status: "active" },
      success: true,
    }), { status: 200 }));
    globalThis.fetch = fetchMock;
    const credentials = btoa(JSON.stringify({ CLOUDFLARE_API_TOKEN: "cf-token" }));

    const response = await cloudflareFetch(new Request("https://modelhub.test/cloudflareworkersai/api/test", {
      headers: { "x-provider-credentials": credentials },
      method: "POST",
    }));

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      expect.objectContaining({
        headers: { Authorization: "Bearer cf-token" },
        method: "GET",
      }),
    );
  });

  it("discovers an account before fetching models when Account ID is not configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: [{ id: "account-1" }],
        success: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: [{ name: "@cf/openai/gpt-oss-20b" }],
        success: true,
      }), { status: 200 }));
    globalThis.fetch = fetchMock;

    const models = await fetchCloudflareModels({ CLOUDFLARE_API_TOKEN: "cf-token" });

    expect(models.map((model) => model.id)).toEqual(["@cf/openai/gpt-oss-20b"]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.cloudflare.com/client/v4/accounts",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.cloudflare.com/client/v4/accounts/account-1/ai/models/search?task=Text Generation",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
