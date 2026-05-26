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

const { chatViaOpenAiCompatible, createOpenAiFetchModels } = await import("../lib/openai-compatible");

describe("OpenAI-compatible provider helpers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("falls back when NVIDIA NIM returns function-not-found for a listed model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        detail: "Function '23bd454d-b225-49a3-8118-582a62fc51b8': Not found for account 'acct'",
        status: 404,
        title: "Not Found",
      }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "fallback ok" } }],
      }), { headers: { "content-type": "application/json" }, status: 200 }));
    globalThis.fetch = fetchMock;

    const response = await chatViaOpenAiCompatible(
      {
        apiKeyEnv: "NVIDIA_NIM_API_KEY",
        chatUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
        fallbackModelIds: ["nvidia/nemotron-3-super-120b-a12b"],
        providerName: "NVIDIA NIM",
      },
      {
        messages: [{ content: "Oi", role: "user" }],
        modelId: "01-ai/yi-large",
        rawBody: {},
      },
      { NVIDIA_NIM_API_KEY: "nvapi-test" },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("fallback ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).model).toBe("01-ai/yi-large");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).model).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("deduplicates model IDs returned by OpenAI-compatible model APIs", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "openai/gpt-oss-20b" },
        { id: "openai/gpt-oss-20b" },
        { id: "nvidia/nemotron-3-super-120b-a12b" },
      ],
    }), { headers: { "content-type": "application/json" }, status: 200 }));

    const fetchModels = createOpenAiFetchModels({
      apiKeyEnv: "NVIDIA_NIM_API_KEY",
      modelsUrl: "https://integrate.api.nvidia.com/v1/models",
      providerName: "NVIDIA NIM",
    });

    const models = await fetchModels({ NVIDIA_NIM_API_KEY: "nvapi-test" });

    expect(models.map((model) => model.id)).toEqual([
      "openai/gpt-oss-20b",
      "nvidia/nemotron-3-super-120b-a12b",
    ]);
  });

  it("derives tool capability from OpenAI-compatible model metadata when available", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "tool-model", supported_parameters: ["tools", "temperature"] },
        { id: "text-model", supported_parameters: ["temperature"] },
        { capabilities: { tools: false }, id: "capability-model" },
      ],
    }), { headers: { "content-type": "application/json" }, status: 200 }));

    const fetchModels = createOpenAiFetchModels({
      apiKeyEnv: "OPENROUTER_API_KEY",
      modelsUrl: "https://openrouter.ai/api/v1/models",
      providerName: "OpenRouter",
    });

    const models = await fetchModels({ OPENROUTER_API_KEY: "sk-test" });

    expect(models.map((model) => [model.id, model.capabilities.tools])).toEqual([
      ["tool-model", true],
      ["text-model", false],
      ["capability-model", false],
    ]);
  });
});
