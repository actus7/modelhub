import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));
vi.mock("../lib/db", () => ({
  prisma: {
    conversationAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
    usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
  },
}));

const { fetchGoogleAiStudioModels, models } = await import("../providers/googleaistudio");

describe("Google AI Studio provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            {
              displayName: "Gemini 2.5 Flash",
              name: "models/gemini-2.5-flash",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exposes static Gemini models as tool-capable", () => {
    expect(models.every((model) => model.capabilities.tools === true)).toBe(true);
  });

  it("maps fetched Gemini models as tool-capable", async () => {
    const fetched = await fetchGoogleAiStudioModels({
      GOOGLE_AI_STUDIO_API_KEY: "AIza-test",
    });

    expect(fetched).toEqual([
      {
        capabilities: { documents: true, images: true, tools: true },
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash (Google AI Studio)",
      },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("key=AIza-test"),
      expect.objectContaining({ method: "GET" }),
    );
  });
});
