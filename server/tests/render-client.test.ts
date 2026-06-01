import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRenderOpenClawDeployment,
  createRenderSpikeDeployment,
  deleteRenderService,
  getRenderOpenClawServiceName,
  getRenderSpikeServiceName,
  isRenderFreeTierError,
  RENDER_OPENCLAW_DOCKER_COMMAND,
  RENDER_OPENCLAW_IMAGE,
  RENDER_SPIKE_PLAN,
  RENDER_SPIKE_REPO,
  refreshRenderDeployment,
  updateRenderOpenClawDeployment,
  validateRenderToken,
} from "../lib/cloud/render";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("Render client", () => {
  const fetchMock = vi.fn();
  const openClawConfig = {
    allowedOrigins: ["https://app.modelhub.example.com"],
    model: "groq/llama-3.3-70b-versatile",
    provider: "groq",
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates tokens against the owners endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ cursor: "c1", owner: { email: "dev@example.com", id: "usr-1", name: "Acme", type: "user" } }]),
    );

    await expect(validateRenderToken("rnd_token")).resolves.toEqual({
      ownerEmail: "dev@example.com",
      ownerId: "usr-1",
      ownerName: "Acme",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.render.com/v1/owners?limit=1",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("authorization")).toBe("Bearer rnd_token");
  });

  it("creates a free Docker web service from a public repo", async () => {
    const serviceName = getRenderSpikeServiceName("user-123");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([{ cursor: "c1", owner: { email: "dev@example.com", id: "usr-1", name: "Acme" } }]),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({
          deployId: "dep-1",
          service: {
            id: "srv-1",
            name: serviceName,
            serviceDetails: { plan: "free", region: "oregon", url: "https://modelhub-spike-abc.onrender.com" },
          },
        }, 201),
      );

    const deployment = await createRenderSpikeDeployment("rnd_token", "user-123");

    expect(deployment).toMatchObject({
      deployId: "dep-1",
      ownerId: "usr-1",
      publicUrl: "https://modelhub-spike-abc.onrender.com",
      serviceId: "srv-1",
      status: "provisioning",
    });

    const serviceRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(serviceRequest).toMatchObject({
      autoDeploy: "no",
      name: serviceName,
      ownerId: "usr-1",
      repo: RENDER_SPIKE_REPO,
      serviceDetails: {
        plan: RENDER_SPIKE_PLAN,
        region: "oregon",
        runtime: "docker",
      },
      type: "web_service",
    });
  });

  it("adopts an existing service instead of creating a duplicate", async () => {
    const serviceName = getRenderSpikeServiceName("user-123");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([{ cursor: "c1", owner: { email: "dev@example.com", id: "usr-1", name: "Acme" } }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{
          cursor: "c1",
          service: {
            id: "srv-existing",
            name: serviceName,
            serviceDetails: { plan: "free", region: "oregon", url: "https://existing.onrender.com" },
          },
        }]),
      );

    const deployment = await createRenderSpikeDeployment("rnd_token", "user-123");

    expect(deployment).toMatchObject({
      publicUrl: "https://existing.onrender.com",
      serviceId: "srv-existing",
      status: "provisioning",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("detects free-tier quota and payment errors", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([{ cursor: "c1", owner: { email: "dev@example.com", id: "usr-1", name: "Acme" } }]),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({ message: "upgrade your plan to create more services" }, 402),
      );

    try {
      await createRenderSpikeDeployment("rnd_token", "user-123");
      throw new Error("Expected createRenderSpikeDeployment to fail");
    } catch (error) {
      expect(isRenderFreeTierError(error)).toBe(true);
    }
  });

  it("refreshes service and deploy status", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ id: "srv-1", serviceDetails: { url: "https://test.onrender.com" }, suspended: "not_suspended" }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ cursor: "c1", deploy: { id: "dep-2", status: "live" } }]),
      );

    await expect(refreshRenderDeployment("rnd_token", "srv-1", "dep-1")).resolves.toEqual({
      deployId: "dep-2",
      error: null,
      missing: false,
      publicUrl: "https://test.onrender.com",
      status: "healthy",
    });
  });

  it("treats suspended free-tier services as healthy", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ id: "srv-1", serviceDetails: { url: "https://test.onrender.com" }, suspended: "suspended" }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ cursor: "c1", deploy: { id: "dep-1", status: "deactivated" } }]),
      );

    const result = await refreshRenderDeployment("rnd_token", "srv-1", "dep-1");
    expect(result.status).toBe("healthy");
  });

  it("treats missing services as idempotent deletes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404));

    await expect(deleteRenderService("rnd_token", "srv-1")).resolves.toBe("missing");
  });

  it("returns deleted on successful 204 response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(deleteRenderService("rnd_token", "srv-1")).resolves.toBe("deleted");
  });

  it("creates an OpenClaw service with env vars and dockerCommand", async () => {
    const serviceName = getRenderOpenClawServiceName("user-123");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([{ cursor: "c1", owner: { email: "dev@example.com", id: "usr-1", name: "Acme" } }]),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({
          deployId: "dep-1",
          service: {
            id: "srv-oc-1",
            name: serviceName,
            serviceDetails: { plan: "free", region: "oregon", url: "https://modelhub-openclaw-abc.onrender.com" },
          },
        }, 201),
      );

    const deployment = await createRenderOpenClawDeployment(
      "rnd_token",
      "user-123",
      "https://modelhub.example.com/v1",
      "sk-test-key",
      openClawConfig,
    );

    expect(deployment).toMatchObject({
      deployId: "dep-1",
      ownerId: "usr-1",
      publicUrl: "https://modelhub-openclaw-abc.onrender.com",
      serviceId: "srv-oc-1",
      status: "provisioning",
    });
    expect(deployment.gatewayToken).toHaveLength(64);

    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(body.image).toEqual({ imagePath: RENDER_OPENCLAW_IMAGE, ownerId: "usr-1" });
    expect(body.envVars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "OPENCLAW_GATEWAY_PORT", value: "10000" }),
        expect.objectContaining({ key: "OPENCLAW_GATEWAY_TOKEN", value: deployment.gatewayToken }),
        expect.objectContaining({ key: "OPENAI_API_KEY", value: "sk-test-key" }),
        expect.objectContaining({ key: "OPENAI_BASE_URL", value: "https://modelhub.example.com/v1" }),
        expect.objectContaining({ key: "MODELHUB_OPENCLAW_MODEL", value: "groq/llama-3.3-70b-versatile" }),
      ]),
    );
    const configJson = body.envVars.find((env: { key: string }) => env.key === "MODELHUB_OPENCLAW_CONFIG_JSON")?.value;
    const runtimeConfig = JSON.parse(configJson);
    expect(runtimeConfig.gateway.controlUi.allowedOrigins).toEqual(expect.arrayContaining([
      `https://${serviceName}.onrender.com`,
      "https://modelhub.example.com",
      "https://app.modelhub.example.com",
    ]));
    expect(runtimeConfig.agents.defaults.model.primary).toBe("modelhub/groq/llama-3.3-70b-versatile");
    expect(runtimeConfig.models.providers.modelhub.baseUrl).toBe("https://modelhub.example.com/v1");
    // Heavy plugins disabled to fit the free tier; browser kept on purpose.
    expect(runtimeConfig.plugins.entries).toMatchObject({
      "canvas": { enabled: false },
      "phone-control": { enabled: false },
      "talk-voice": { enabled: false },
    });
    expect(runtimeConfig.plugins.entries).not.toHaveProperty("browser");
    // Empty health check path → Render uses TCP port detection (more tolerant).
    expect(body.serviceDetails.healthCheckPath).toBe("");
    expect(body.serviceDetails.envSpecificDetails.dockerCommand).toBe(RENDER_OPENCLAW_DOCKER_COMMAND);
    expect(body.serviceDetails.envSpecificDetails.dockerCommand).toContain("OPENCLAW_CONFIG_PATH");
    expect(body.envVars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "OPENCLAW_CONFIG_PATH", value: "/tmp/openclaw-state/openclaw.json" }),
      ]),
    );
    // Gateway is started via spawnSync (single node -e process, no shell) so it survives
    // Render's whitespace-split exec. The command must contain no spaces in the script body.
    expect(body.serviceDetails.envSpecificDetails.dockerCommand).toContain("'openclaw.mjs','gateway','run'");
    // We must NOT pass --allow-unconfigured: it makes the gateway ignore openclaw.json,
    // so gateway.controlUi.allowedOrigins would never apply. gateway.mode=local in the
    // config satisfies the startup guard instead, and the full config is loaded.
    expect(body.serviceDetails.envSpecificDetails.dockerCommand).not.toContain("--allow-unconfigured");
    expect(body.serviceDetails.envSpecificDetails.dockerCommand).not.toContain("/bin/sh");
    expect(body.serviceDetails.envSpecificDetails.dockerCommand.startsWith("node -e ")).toBe(true);
    // No spaces in the eval script (everything after "node -e ") or Render truncates it.
    expect(body.serviceDetails.envSpecificDetails.dockerCommand.slice("node -e ".length)).not.toContain(" ");
    expect(body.envVars).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "OPENCLAW_GATEWAY_MODE" }),
      ]),
    );
  });

  it("updates an existing OpenClaw service command before redeploying", async () => {
    const serviceName = getRenderOpenClawServiceName("user-123");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([{ cursor: "c1", owner: { email: "dev@example.com", id: "usr-1", name: "Acme" } }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{
          cursor: "c1",
          service: {
            id: "srv-oc-existing",
            name: serviceName,
            serviceDetails: { plan: "free", region: "oregon", url: "https://modelhub-openclaw-existing.onrender.com" },
          },
        }]),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: "srv-oc-existing" }))
      .mockResolvedValueOnce(jsonResponse({ deploy: { id: "dep-redeploy" } }));

    const deployment = await createRenderOpenClawDeployment(
      "rnd_token",
      "user-123",
      "https://modelhub.example.com/v1",
      "sk-test-key",
      openClawConfig,
    );

    expect(deployment).toMatchObject({
      deployId: "dep-redeploy",
      publicUrl: "https://modelhub-openclaw-existing.onrender.com",
      serviceId: "srv-oc-existing",
    });

    const envBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(envBody).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "OPENCLAW_GATEWAY_TOKEN", value: deployment.gatewayToken }),
        expect.objectContaining({ key: "OPENAI_API_KEY", value: "sk-test-key" }),
      ]),
    );

    const patchBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(fetchMock.mock.calls[3]?.[0]).toBe("https://api.render.com/v1/services/srv-oc-existing");
    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({ method: "PATCH" }));
    expect(patchBody).toEqual({
      serviceDetails: {
        envSpecificDetails: {
          dockerCommand: RENDER_OPENCLAW_DOCKER_COMMAND,
        },
        healthCheckPath: "",
        runtime: "image",
      },
    });

    expect(fetchMock.mock.calls[4]?.[0]).toBe("https://api.render.com/v1/services/srv-oc-existing/deploys");
  });

  it("updates OpenClaw env vars, command, and triggers a deploy", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: "srv-oc-existing" }))
      .mockResolvedValueOnce(jsonResponse({ deploy: { id: "dep-redeploy" } }));

    const result = await updateRenderOpenClawDeployment(
      "rnd_token",
      "srv-oc-existing",
      "gateway-token",
      "https://modelhub.example.com/v1",
      "sk-test-key",
      {
        ...openClawConfig,
        modelhubApiUrl: "https://modelhub.example.com/v1",
        serviceUrl: "https://modelhub-openclaw-existing.onrender.com",
      },
    );

    expect(result).toMatchObject({
      deployId: "dep-redeploy",
      openclaw: {
        controlUiUrl: "https://modelhub-openclaw-existing.onrender.com",
        model: "groq/llama-3.3-70b-versatile",
        provider: "groq",
      },
    });

    const envBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(envBody).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "OPENCLAW_GATEWAY_TOKEN", value: "gateway-token" }),
        expect.objectContaining({ key: "MODELHUB_OPENCLAW_MODEL", value: "groq/llama-3.3-70b-versatile" }),
      ]),
    );
    const configJson = envBody.find((env: { key: string }) => env.key === "MODELHUB_OPENCLAW_CONFIG_JSON")?.value;
    expect(JSON.parse(configJson).gateway.controlUi.allowedOrigins).toContain("https://modelhub-openclaw-existing.onrender.com");

    const patchBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.render.com/v1/services/srv-oc-existing");
    expect(patchBody.serviceDetails.envSpecificDetails.dockerCommand).toBe(RENDER_OPENCLAW_DOCKER_COMMAND);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://api.render.com/v1/services/srv-oc-existing/deploys");
  });
});
