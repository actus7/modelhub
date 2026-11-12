import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderModels: vi.fn(),
}));

vi.mock("../lib/catalog", () => ({
  isProviderEnabled: vi.fn(() => true),
}));

vi.mock("../lib/db", () => ({
  prisma: {
    apiKey: { findFirst: vi.fn() },
    providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
    usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
  },
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { getSession: vi.fn().mockResolvedValue({ data: null }) },
}));

vi.mock("../env", () => ({}));

vi.mock("../providers/registry", () => ({
  getProviderModels: mocks.getProviderModels,
  isProviderAvailableViaExternalApi: vi.fn(() => true),
  providerRegistry: {
    demo: {
      handler: vi.fn(),
      models: [],
    },
  },
}));

const v1Fetch = (await import("../routes/v1")).default;

describe("GET /v1/models", () => {
  it("returns dynamic model metadata with capabilities", async () => {
    mocks.getProviderModels.mockResolvedValueOnce([
      {
        capabilities: { documents: true, images: true, tools: false },
        id: "vision-model",
        name: "Vision Model",
      },
    ]);

    const response = await v1Fetch(new Request("https://modelhub.test/v1/models"));
    const body = await response.json() as {
      data: Array<{
        capabilities: { documents: boolean; images: boolean; tools?: boolean };
        id: string;
        name: string;
        object: string;
        owned_by: string;
      }>;
      object: string;
    };

    expect(response.status).toBe(200);
    expect(mocks.getProviderModels).toHaveBeenCalledWith("demo");
    expect(body.object).toBe("list");
    expect(body.data).toEqual([
      expect.objectContaining({
        capabilities: { documents: true, images: true, tools: false },
        id: "demo/vision-model",
        name: "Vision Model",
        object: "model",
        owned_by: "demo",
      }),
    ]);
  });
});
