import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  apiKey: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  cloudConnection: { count: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  cloudDeployment: { count: vi.fn(), create: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
};

type MockOpenClawInfoInput = {
  allowedOrigins?: string[];
  model: string;
  modelhubApiUrl: string;
  provider: string;
  serviceUrl: string;
};

const mockRender = {
  buildOpenClawInfo: vi.fn((input: MockOpenClawInfoInput) => {
    const serviceUrl = input.serviceUrl.replace(/\/$/, "");
    return {
      allowedOrigins: Array.from(new Set([serviceUrl, "https://modelhub.test", ...(input.allowedOrigins ?? [])])),
      controlUiUrl: serviceUrl,
      healthUrl: `${serviceUrl}/healthz`,
      model: input.model,
      modelhubApiUrl: input.modelhubApiUrl,
      provider: input.provider,
      readyUrl: `${serviceUrl}/readyz`,
      webSocketUrl: serviceUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:"),
    };
  }),
  createRenderOpenClawDeployment: vi.fn(),
  createRenderSpikeDeployment: vi.fn(),
  deleteRenderService: vi.fn(),
  isRenderFreeTierError: vi.fn(),
  refreshRenderDeployment: vi.fn(),
  updateRenderOpenClawDeployment: vi.fn(),
  validateRenderToken: vi.fn(),
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));
vi.mock("../lib/crypto", () => ({
  decryptCredential: vi.fn((value: string) => value.replace(/^enc:/, "")),
  encryptCredential: vi.fn((value: string) => `enc:${value}`),
  generateApiKey: vi.fn(() => ({ hash: "hash:sk-test", prefix: "sk-test1234", raw: "sk-test-full-key" })),
  hashApiKey: vi.fn((value: string) => `hash:${value}`),
}));
vi.mock("../lib/cloud/render", () => ({
  RENDER_OPENCLAW_PLAN: "free",
  RENDER_OPENCLAW_PORT: 10000,
  RENDER_OPENCLAW_REGION: "oregon",
  RENDER_OPENCLAW_IMAGE: "ghcr.io/openclaw/openclaw:latest",
  RENDER_PROVIDER: "render",
  RENDER_SPIKE_PLAN: "free",
  RENDER_SPIKE_PORT: 80,
  RENDER_SPIKE_REGION: "oregon",
  RENDER_SPIKE_REPO: "https://github.com/traefik/whoami",
  ...mockRender,
}));

import { Hono } from "hono";
const { default: cloudFetch } = await import("../routes/cloud");

const UID = "test-user-123";
const AUTH = { Authorization: "Bearer sk-test" };
const NOW = new Date("2026-05-31T12:00:00.000Z");

const mkApp = () => {
  const app = new Hono();
  app.use("/user/cloud/*", async (c) => await cloudFetch(c.req.raw));
  return app;
};

function connectionRow(overrides = {}) {
  return {
    createdAt: NOW,
    externalOrganizationName: "Acme",
    externalUserEmail: "dev@example.com",
    id: "conn_1",
    label: "Render",
    provider: "render",
    token: "enc:rnd_token",
    updatedAt: NOW,
    userId: UID,
    ...overrides,
  };
}

function deploymentRow(overrides = {}) {
  return {
    connectionId: "conn_1",
    createdAt: NOW,
    error: null,
    externalAppId: "usr-1",
    externalAppName: "Acme",
    externalDeploymentId: "dep-1",
    externalServiceId: "srv-1",
    id: "row_1",
    image: "https://github.com/traefik/whoami",
    instanceType: "free",
    name: "modelhub-spike-abc12345",
    port: 80,
    provider: "render",
    publicUrl: "https://modelhub-spike-abc.onrender.com",
    region: "oregon",
    status: "provisioning",
    updatedAt: NOW,
    userId: UID,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.apiKey.findFirst.mockResolvedValue({ expiresAt: null, id: "key_1", userId: UID });
  mockPrisma.apiKey.update.mockResolvedValue({});
  mockRender.isRenderFreeTierError.mockReturnValue(false);
});

describe("cloud routes auth", () => {
  it("returns 401 without a valid API key", async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValue(null);
    const res = await mkApp().request("/user/cloud/connections");
    expect(res.status).toBe(401);
  });
});

describe("POST /user/cloud/connections/render", () => {
  it("validates and stores the token without returning it", async () => {
    mockRender.validateRenderToken.mockResolvedValue({
      ownerEmail: "dev@example.com",
      ownerId: "usr-1",
      ownerName: "Acme",
    });
    mockPrisma.cloudConnection.upsert.mockResolvedValue(connectionRow());

    const res = await mkApp().request("/user/cloud/connections/render", {
      body: JSON.stringify({ token: "rnd_token" }),
      headers: { ...AUTH, "Content-Type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(201);
    expect(mockRender.validateRenderToken).toHaveBeenCalledWith("rnd_token");
    expect(mockPrisma.cloudConnection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ token: "enc:rnd_token" }),
      update: expect.objectContaining({ token: "enc:rnd_token" }),
    }));
    const body = await res.json();
    expect(body.connection).toMatchObject({ externalOrganizationName: "Acme", provider: "render" });
    expect(JSON.stringify(body)).not.toContain("rnd_token");
  });
});

describe("DELETE /user/cloud/connections/:id", () => {
  it("blocks disconnecting while deployments still exist", async () => {
    mockPrisma.cloudConnection.findFirst.mockResolvedValue({ id: "conn_1" });
    mockPrisma.cloudDeployment.count.mockResolvedValue(1);

    const res = await mkApp().request("/user/cloud/connections/conn_1", {
      headers: AUTH,
      method: "DELETE",
    });

    expect(res.status).toBe(400);
    expect(mockPrisma.cloudConnection.delete).not.toHaveBeenCalled();
  });
});

describe("POST /user/cloud/deployments/render", () => {
  it("creates a deployment with the saved connection token", async () => {
    mockPrisma.cloudConnection.findFirst.mockResolvedValue(connectionRow());
    mockPrisma.cloudDeployment.count.mockResolvedValue(0);
    mockRender.createRenderSpikeDeployment.mockResolvedValue({
      deployId: "dep-1",
      error: null,
      ownerId: "usr-1",
      ownerName: "Acme",
      publicUrl: "https://modelhub-spike-abc.onrender.com",
      serviceId: "srv-1",
      serviceName: "modelhub-spike-abc12345",
      status: "provisioning",
    });
    mockPrisma.cloudDeployment.create.mockImplementation(async ({ data }) => deploymentRow(data));

    const res = await mkApp().request("/user/cloud/deployments/render", {
      headers: AUTH,
      method: "POST",
    });

    expect(res.status).toBe(201);
    expect(mockRender.createRenderSpikeDeployment).toHaveBeenCalledWith("rnd_token", UID);
    const body = await res.json();
    expect(body.deployment).toMatchObject({
      externalServiceId: "srv-1",
      image: "https://github.com/traefik/whoami",
      instanceType: "free",
      publicUrl: "https://modelhub-spike-abc.onrender.com",
      status: "provisioning",
    });
  });
});

describe("POST /user/cloud/deployments/:id/refresh", () => {
  it("refreshes status using the owning connection", async () => {
    mockPrisma.cloudDeployment.findFirst.mockResolvedValue({
      ...deploymentRow(),
      connection: connectionRow(),
    });
    mockRender.refreshRenderDeployment.mockResolvedValue({
      deployId: "dep-2",
      error: null,
      missing: false,
      publicUrl: "https://modelhub-spike-abc.onrender.com",
      status: "healthy",
    });
    mockPrisma.cloudDeployment.update.mockResolvedValue(deploymentRow({
      externalDeploymentId: "dep-2",
      status: "healthy",
    }));

    const res = await mkApp().request("/user/cloud/deployments/row_1/refresh", {
      headers: AUTH,
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(mockRender.refreshRenderDeployment).toHaveBeenCalledWith("rnd_token", "srv-1", "dep-1");
    expect((await res.json()).deployment.status).toBe("healthy");
  });
});

describe("DELETE /user/cloud/deployments/:id", () => {
  it("deletes local row when Render reports the service missing", async () => {
    mockPrisma.cloudDeployment.findFirst.mockResolvedValue({
      ...deploymentRow(),
      connection: connectionRow(),
    });
    mockPrisma.cloudDeployment.update.mockResolvedValue(deploymentRow({ status: "deleting" }));
    mockRender.deleteRenderService.mockResolvedValue("missing");
    mockPrisma.cloudDeployment.delete.mockResolvedValue({});

    const res = await mkApp().request("/user/cloud/deployments/row_1", {
      headers: AUTH,
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(mockRender.deleteRenderService).toHaveBeenCalledWith("rnd_token", "srv-1");
    expect(mockPrisma.cloudDeployment.delete).toHaveBeenCalledWith({ where: { id: "row_1" } });
  });
});

describe("POST /user/cloud/deployments/render/openclaw", () => {
  it("returns 400 when provider and model are missing", async () => {
    const res = await mkApp().request("/user/cloud/deployments/render/openclaw", {
      body: JSON.stringify({}),
      headers: { ...AUTH, "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  it("generates API key once and stores encrypted, passes provider+model to Render", async () => {
    mockPrisma.cloudConnection.findFirst.mockResolvedValue(connectionRow({ modelhubApiKey: null }));
    mockPrisma.cloudDeployment.count.mockResolvedValue(0);
    mockPrisma.apiKey.create.mockResolvedValue({});
    mockPrisma.cloudConnection.update.mockResolvedValue({});
    mockRender.createRenderOpenClawDeployment.mockResolvedValue({
      deployId: "dep-oc-1",
      error: null,
      gatewayToken: "abc123token",
      openclaw: {
        allowedOrigins: ["https://modelhub-openclaw-abc.onrender.com", "https://modelhub.test"],
        controlUiUrl: "https://modelhub-openclaw-abc.onrender.com",
        healthUrl: "https://modelhub-openclaw-abc.onrender.com/healthz",
        model: "groq/llama-3.3-70b-versatile",
        modelhubApiUrl: "http://localhost/v1",
        provider: "groq",
        readyUrl: "https://modelhub-openclaw-abc.onrender.com/readyz",
        webSocketUrl: "wss://modelhub-openclaw-abc.onrender.com",
      },
      ownerId: "usr-1",
      ownerName: "Acme",
      publicUrl: "https://modelhub-openclaw-abc.onrender.com",
      serviceId: "srv-oc-1",
      serviceName: "modelhub-openclaw-abc12345",
      status: "provisioning",
    });
    mockPrisma.cloudDeployment.create.mockImplementation(async ({ data }) => ({
      ...deploymentRow({ ...data, externalServiceId: "srv-oc-1", port: 10000 }),
    }));

    const res = await mkApp().request("/user/cloud/deployments/render/openclaw", {
      body: JSON.stringify({ model: "groq/llama-3.3-70b-versatile", provider: "groq" }),
      headers: { ...AUTH, "Content-Type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.gatewayToken).toBe("abc123token");
    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ label: "openclaw-byoc", userId: UID }) }),
    );
    expect(mockPrisma.cloudConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ modelhubApiKey: expect.stringContaining("enc:") }) }),
    );
    expect(mockRender.createRenderOpenClawDeployment).toHaveBeenCalledWith(
      "rnd_token",
      UID,
      "http://localhost/v1",
      "sk-test-full-key",
      expect.objectContaining({
        allowedOrigins: ["http://localhost"],
        model: "groq/llama-3.3-70b-versatile",
        provider: "groq",
      }),
    );
    expect(mockPrisma.cloudDeployment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          config: expect.objectContaining({
            gatewayToken: "enc:abc123token",
            allowedOrigins: ["https://modelhub-openclaw-abc.onrender.com", "https://modelhub.test"],
            model: "groq/llama-3.3-70b-versatile",
            provider: "groq",
          }),
        }),
      }),
    );
  });

  it("reuses existing API key without generating a new one", async () => {
    mockPrisma.cloudConnection.findFirst.mockResolvedValue(
      connectionRow({ modelhubApiKey: "enc:existing-raw-key" }),
    );
    mockPrisma.cloudDeployment.count.mockResolvedValue(0);
    mockRender.createRenderOpenClawDeployment.mockResolvedValue({
      deployId: null,
      error: null,
      gatewayToken: "tok123",
      openclaw: {
        allowedOrigins: ["https://modelhub-openclaw-abc.onrender.com", "https://modelhub.test"],
        controlUiUrl: "https://modelhub-openclaw-abc.onrender.com",
        healthUrl: "https://modelhub-openclaw-abc.onrender.com/healthz",
        model: "groq/llama-3.3-70b-versatile",
        modelhubApiUrl: "http://localhost/v1",
        provider: "groq",
        readyUrl: "https://modelhub-openclaw-abc.onrender.com/readyz",
        webSocketUrl: "wss://modelhub-openclaw-abc.onrender.com",
      },
      ownerId: "usr-1",
      ownerName: "Acme",
      publicUrl: null,
      serviceId: "srv-oc-2",
      serviceName: "modelhub-openclaw-abc12345",
      status: "provisioning",
    });
    mockPrisma.cloudDeployment.create.mockImplementation(async ({ data }) => deploymentRow(data));

    await mkApp().request("/user/cloud/deployments/render/openclaw", {
      body: JSON.stringify({ model: "groq/llama-3.3-70b-versatile", provider: "groq" }),
      headers: { ...AUTH, "Content-Type": "application/json" },
      method: "POST",
    });

    expect(mockPrisma.apiKey.create).not.toHaveBeenCalled();
    expect(mockPrisma.cloudConnection.update).not.toHaveBeenCalled();
    expect(mockRender.createRenderOpenClawDeployment).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      "existing-raw-key",
      expect.objectContaining({ model: "groq/llama-3.3-70b-versatile", provider: "groq" }),
    );
  });
});

describe("PATCH /user/cloud/deployments/:id/openclaw", () => {
  it("updates OpenClaw config, redeploys, and stores non-secret details", async () => {
    mockPrisma.cloudDeployment.findFirst.mockResolvedValue({
      ...deploymentRow({
        config: {
          allowedOrigins: ["https://old.example.com"],
          controlUiUrl: "https://modelhub-openclaw-abc.onrender.com",
          gatewayToken: "enc:old-gateway-token",
          model: "groq/old-model",
          modelhubApiUrl: "http://localhost/v1",
          provider: "groq",
        },
        image: "ghcr.io/openclaw/openclaw:latest",
        publicUrl: "https://modelhub-openclaw-abc.onrender.com",
      }),
      connection: connectionRow({ modelhubApiKey: "enc:existing-raw-key" }),
    });
    mockRender.updateRenderOpenClawDeployment.mockResolvedValue({
      deployId: "dep-updated",
      openclaw: {
        allowedOrigins: ["https://modelhub-openclaw-abc.onrender.com", "https://app.modelhub.example.com"],
        controlUiUrl: "https://modelhub-openclaw-abc.onrender.com",
        healthUrl: "https://modelhub-openclaw-abc.onrender.com/healthz",
        model: "openrouter/openai/gpt-5.5",
        modelhubApiUrl: "http://localhost/v1",
        provider: "openrouter",
        readyUrl: "https://modelhub-openclaw-abc.onrender.com/readyz",
        webSocketUrl: "wss://modelhub-openclaw-abc.onrender.com",
      },
    });
    mockPrisma.cloudDeployment.update.mockImplementation(async ({ data }) => deploymentRow({
      ...data,
      config: data.config,
      externalServiceId: "srv-1",
      image: "ghcr.io/openclaw/openclaw:latest",
      port: 10000,
      publicUrl: "https://modelhub-openclaw-abc.onrender.com",
    }));

    const res = await mkApp().request("/user/cloud/deployments/row_1/openclaw", {
      body: JSON.stringify({
        allowedOrigins: ["https://app.modelhub.example.com"],
        model: "openrouter/openai/gpt-5.5",
        provider: "openrouter",
      }),
      headers: { ...AUTH, "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(res.status).toBe(200);
    expect(mockRender.updateRenderOpenClawDeployment).toHaveBeenCalledWith(
      "rnd_token",
      "srv-1",
      "old-gateway-token",
      "http://localhost/v1",
      "existing-raw-key",
      expect.objectContaining({
        allowedOrigins: ["https://app.modelhub.example.com"],
        model: "openrouter/openai/gpt-5.5",
        provider: "openrouter",
        serviceUrl: "https://modelhub-openclaw-abc.onrender.com",
      }),
    );
    expect(mockPrisma.cloudDeployment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        config: expect.objectContaining({
          allowedOrigins: ["https://modelhub-openclaw-abc.onrender.com", "https://app.modelhub.example.com"],
          gatewayToken: "enc:old-gateway-token",
          model: "openrouter/openai/gpt-5.5",
          provider: "openrouter",
        }),
        externalDeploymentId: "dep-updated",
        status: "provisioning",
      }),
    }));
    const body = await res.json();
    expect(body.deployment.openclaw).toMatchObject({
      model: "openrouter/openai/gpt-5.5",
      provider: "openrouter",
      webSocketUrl: "wss://modelhub-openclaw-abc.onrender.com",
    });
    expect(JSON.stringify(body)).not.toContain("old-gateway-token");
  });
});

describe("POST /user/cloud/deployments/:id/api/chat (OpenClaw chat proxy)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  function openclawDeploymentRow(overrides = {}) {
    return deploymentRow({
      config: { gatewayToken: "enc:gw-secret-token", model: "groq/llama", provider: "groq" },
      externalServiceId: "srv-oc-1",
      image: "ghcr.io/openclaw/openclaw:latest",
      port: 10000,
      publicUrl: "https://modelhub-openclaw-abc.onrender.com",
      status: "healthy",
      ...overrides,
    });
  }

  it("forwards chat to the OpenClaw /v1/chat/completions with the gateway token", async () => {
    mockPrisma.cloudDeployment.findFirst.mockResolvedValue(openclawDeploymentRow());
    fetchMock.mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"oi"}}]}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }),
    );

    const res = await mkApp().request("/user/cloud/deployments/row_1/api/chat", {
      body: JSON.stringify({
        messages: [{ parts: [{ text: "Olá OpenClaw", type: "text" }], role: "user" }],
        modelId: "nvidianim/nvidia/nemotron-3-super-120b-a12b",
      }),
      headers: { ...AUTH, "Content-Type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(200);
    const chatCall = fetchMock.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].endsWith("/v1/chat/completions"),
    );
    expect(chatCall).toBeDefined();
    expect(chatCall![0]).toBe("https://modelhub-openclaw-abc.onrender.com/v1/chat/completions");
    const requestInit = chatCall![1] as RequestInit;
    expect((requestInit.headers as Record<string, string>).authorization).toBe("Bearer gw-secret-token");
    const sentBody = JSON.parse(String(requestInit.body));
    expect(sentBody).toMatchObject({
      messages: [{ content: "Olá OpenClaw", role: "user" }],
      model: "openclaw",
      stream: true,
    });
  });

  it("returns 409 when the deployment has no public URL yet", async () => {
    mockPrisma.cloudDeployment.findFirst.mockResolvedValue(openclawDeploymentRow({ publicUrl: null }));

    const res = await mkApp().request("/user/cloud/deployments/row_1/api/chat", {
      body: JSON.stringify({ messages: [{ parts: [{ text: "oi", type: "text" }], role: "user" }] }),
      headers: { ...AUTH, "Content-Type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(409);
  });

  it("returns 400 when there are no usable messages", async () => {
    mockPrisma.cloudDeployment.findFirst.mockResolvedValue(openclawDeploymentRow());

    const res = await mkApp().request("/user/cloud/deployments/row_1/api/chat", {
      body: JSON.stringify({ messages: [] }),
      headers: { ...AUTH, "Content-Type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(400);
  });

  it("never leaks the gateway token in an upstream error response", async () => {
    mockPrisma.cloudDeployment.findFirst.mockResolvedValue(openclawDeploymentRow());
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));

    const res = await mkApp().request("/user/cloud/deployments/row_1/api/chat", {
      body: JSON.stringify({ messages: [{ parts: [{ text: "oi", type: "text" }], role: "user" }] }),
      headers: { ...AUTH, "Content-Type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("gw-secret-token");
  });
});
