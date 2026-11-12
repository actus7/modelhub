import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({
  prisma: {
    conversationAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
    usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
  },
}));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));

const { chatViaOpenAiCompatible, createOpenAiFetchModels, isChatModelId, testViaOpenAiModels } = await import(
  "../lib/openai-compatible"
);

const provider = { label: "Example", baseUrl: "https://api.example.com/v1", apiKeyEnv: "EXAMPLE_API_KEY" };
const credentials = { EXAMPLE_API_KEY: "sk-test" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

describe("OpenAI-compatible provider standard", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts to baseUrl/chat/completions with Bearer auth and passthrough fields only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: "oi" } }] }));
    globalThis.fetch = fetchMock;

    const response = await chatViaOpenAiCompatible(
      provider,
      {
        messages: [{ role: "user", content: "olá" }],
        modelId: "model-a",
        rawBody: { temperature: 0.2, unknown_field: true },
      },
      credentials,
    );

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "model-a", temperature: 0.2, stream: true });
    expect(body.unknown_field).toBeUndefined();
    expect(body.messages).toEqual([{ role: "user", content: "olá" }]);
  });

  it("returns the upstream error without retrying another model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "model_not_found" } }, 404));
    globalThis.fetch = fetchMock;

    const response = await chatViaOpenAiCompatible(
      provider,
      { messages: [{ role: "user", content: "olá" }], modelId: "missing", rawBody: {} },
      credentials,
    );

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lists chat models from /models, deduplicating and dropping non-chat models", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "chat-a", supported_parameters: ["tools"] },
          { id: "chat-a" },
          { id: "chat-b", supported_parameters: ["temperature"] },
          { id: "text-embedding-3-small" },
          { id: "whisper-1" },
        ],
      }),
    );

    const models = await createOpenAiFetchModels(provider)(credentials);

    expect(models.map((model) => [model.id, model.capabilities.tools])).toEqual([
      ["chat-a", true],
      ["chat-b", false],
    ]);
  });

  it("classifies non-chat model ids", () => {
    expect(isChatModelId("gpt-4.1-mini")).toBe(true);
    expect(isChatModelId("nvidia/nv-embed-v1")).toBe(false);
    expect(isChatModelId("tts-1-hd")).toBe(false);
  });

  it("validates credentials against /models", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(testViaOpenAiModels(provider, credentials)).resolves.toEqual({
      ok: false,
      error: "Chave inválida ou sem permissão (401).",
    });
  });
});
