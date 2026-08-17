import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({
  prisma: {
    providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
    usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
  },
}));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));

const ollamaFetch = (await import("../providers/ollama")).default;
const { fetchOllamaStatus } = await import("../providers/ollama");

function ollamaFetchMock(models: unknown[], version?: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/version")) {
      return new Response(JSON.stringify({ version: version ?? "0.12.6" }), { status: 200 });
    }
    return new Response(JSON.stringify({ models }), { status: 200 });
  });
}

describe("Ollama provider", () => {
  const originalFetch = globalThis.fetch;
  const originalRequireAuth = process.env.REQUIRE_AUTH;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.REQUIRE_AUTH = originalRequireAuth;
    vi.unstubAllEnvs();
  });

  it("GET /ollama/api/status reporta online com versao e contagem de modelos", async () => {
    process.env.REQUIRE_AUTH = "false";
    globalThis.fetch = ollamaFetchMock([{ name: "llama3.2" }, { name: "qwen2.5-coder" }], "0.12.6");

    const response = await ollamaFetch(
      new Request("https://modelhub.test/ollama/api/status?force=1"),
    );

    await expect(response.json()).resolves.toEqual({
      baseUrl: "http://localhost:11434",
      modelCount: 2,
      online: true,
      version: "0.12.6",
    });
  });

  it("GET /ollama/api/status reporta offline quando o servidor nao responde", async () => {
    process.env.REQUIRE_AUTH = "false";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await ollamaFetch(
      new Request("https://modelhub.test/ollama/api/status?force=1"),
    );

    await expect(response.json()).resolves.toEqual({
      baseUrl: "http://localhost:11434",
      modelCount: null,
      online: false,
      version: null,
    });
  });

  it("cacheia o status por 15s para aguentar polling da UI", async () => {
    globalThis.fetch = ollamaFetchMock([{ name: "llama3.2" }]);

    const fresh = await fetchOllamaStatus(true);
    expect(fresh.online).toBe(true);
    expect(fresh.modelCount).toBe(1);

    // Servidor cai logo apos: sem force, o snapshot em cache continua valido.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("down"));
    const cached = await fetchOllamaStatus();
    expect(cached.online).toBe(true);

    // force=1 ignora o cache e refaz a verificacao.
    const forced = await fetchOllamaStatus(true);
    expect(forced.online).toBe(false);
  });
});
