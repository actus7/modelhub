import { createHash, randomBytes } from "node:crypto";

import type { CloudDeploymentStatus } from "@/lib/contracts";

const RENDER_API_BASE = "https://api.render.com/v1";
export const RENDER_PROVIDER = "render" as const;
export const RENDER_SPIKE_REPO = "https://github.com/traefik/whoami";
const RENDER_SPIKE_BRANCH = "master";
export const RENDER_SPIKE_REGION = "oregon";
export const RENDER_SPIKE_PLAN = "free";
export const RENDER_SPIKE_PORT = 80;

// Pre-built image: no TypeScript compilation required, avoids free-tier OOM.
export const RENDER_OPENCLAW_IMAGE = "ghcr.io/openclaw/openclaw:latest";
export const RENDER_OPENCLAW_REGION = "oregon";
export const RENDER_OPENCLAW_PLAN = "free";
export const RENDER_OPENCLAW_PORT = 10000;
export const OPENCLAW_AGENT_TIMEOUT_SECONDS = 310;
export const OPENCLAW_PROVIDER_TIMEOUT_SECONDS = 300;
// Explicit config path. OPENCLAW_CONFIG_PATH has absolute priority for where the
// gateway reads openclaw.json — relying on the ~/.openclaw default proved unreliable
// (the gateway reported "Missing config" even though we wrote there). We set this env
// var AND write the file to the exact same path, removing all ambiguity.
const RENDER_OPENCLAW_CONFIG_PATH = "/tmp/openclaw-state/openclaw.json";
// Render runs the Docker Command by splitting on whitespace and exec'ing directly
// (no shell, no quote handling). So the command must be a single `node -e <script>`
// where the script has NO spaces and uses only single quotes — otherwise Render
// truncates it at the first space ("Unterminated string constant").
// The script writes openclaw.json (from MODELHUB_OPENCLAW_CONFIG_JSON) to
// OPENCLAW_CONFIG_PATH, then starts the gateway in-process via spawnSync since
// `&&`/`exec` need a shell that Render does not provide.
//
// NOTE: we intentionally do NOT pass --allow-unconfigured. That flag makes the gateway
// run in an ephemeral mode that ignores openclaw.json, so our gateway.controlUi.allowedOrigins
// would never apply (Control UI then rejects the browser origin). Our config sets
// gateway.mode="local", which satisfies the startup guard, so the full config is loaded.
const OPENCLAW_BOOTSTRAP_SCRIPT = [
  "require('node:fs').mkdirSync(require('node:path').dirname(process.env.OPENCLAW_CONFIG_PATH),{recursive:true})",
  "require('node:fs').writeFileSync(process.env.OPENCLAW_CONFIG_PATH,process.env.MODELHUB_OPENCLAW_CONFIG_JSON||'{}')",
  "process.exit(require('node:child_process').spawnSync(process.execPath,['openclaw.mjs','gateway','run','--bind','lan'],{stdio:'inherit'}).status||0)",
].join(";");

export const RENDER_OPENCLAW_DOCKER_COMMAND = `node -e ${OPENCLAW_BOOTSTRAP_SCRIPT}`;

type RenderErrorBody = {
  id?: string;
  message?: string;
};

type RenderOwner = {
  email?: string;
  id?: string;
  name?: string;
  type?: string;
};

type RenderServiceDetails = {
  plan?: string;
  region?: string;
  url?: string;
};

type RenderService = {
  id?: string;
  name?: string;
  serviceDetails?: RenderServiceDetails;
  slug?: string;
  suspended?: string;
  type?: string;
};

type RenderDeploy = {
  id?: string;
  status?: string;
};

export type RenderAccountMetadata = {
  ownerEmail: string | null;
  ownerId: string | null;
  ownerName: string | null;
};

export type RenderSpikeDeployment = {
  deployId: string | null;
  error: string | null;
  ownerId: string;
  ownerName: string;
  publicUrl: string | null;
  serviceId: string;
  serviceName: string;
  status: CloudDeploymentStatus;
};

export type RenderDeploymentRefresh = {
  deployId: string | null;
  error: string | null;
  missing: boolean;
  publicUrl: string | null;
  status: CloudDeploymentStatus;
};

class RenderApiError extends Error {
  responseBody: unknown;
  status: number;

  constructor(input: { message: string; responseBody?: unknown; status: number }) {
    super(input.message);
    this.name = "RenderApiError";
    this.responseBody = input.responseBody;
    this.status = input.status;
  }
}

function renderServiceNameForUser(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `modelhub-spike-${hash}`;
}

export function getRenderSpikeServiceName(userId: string): string {
  return renderServiceNameForUser(userId);
}

function extractErrorMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const candidate = body as RenderErrorBody;
    if (candidate.message) return candidate.message;
  }
  return "Render API request failed";
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function renderRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${RENDER_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 204) return null!;

  const body = await parseJson(response);

  if (!response.ok) {
    throw new RenderApiError({
      message: extractErrorMessage(body),
      responseBody: body,
      status: response.status,
    });
  }

  return body as T;
}

function mapRenderDeployStatus(
  deployStatus: string | undefined,
  suspended: string | undefined,
): {
  error: string | null;
  status: CloudDeploymentStatus;
} {
  if (deployStatus === "live") {
    return { error: null, status: "healthy" };
  }
  if (deployStatus === "build_failed" || deployStatus === "update_failed" || deployStatus === "pre_deploy_failed") {
    return { error: "O deploy falhou no Render.", status: "failed" };
  }
  if (deployStatus === "canceled") {
    return { error: "O deploy foi cancelado no Render.", status: "failed" };
  }
  if (deployStatus === "deactivated") {
    if (suspended === "suspended") {
      return { error: null, status: "healthy" };
    }
    return { error: "O servico foi desativado no Render.", status: "failed" };
  }
  return { error: null, status: "provisioning" };
}

export function isRenderFreeTierError(error: unknown): boolean {
  if (!(error instanceof RenderApiError)) return false;
  if (![400, 402, 403, 409, 422].includes(error.status)) return false;

  const text = `${error.message} ${JSON.stringify(error.responseBody ?? "")}`.toLowerCase();
  return (
    text.includes("free") ||
    text.includes("quota") ||
    text.includes("limit") ||
    text.includes("plan") ||
    text.includes("upgrade") ||
    text.includes("payment")
  );
}

export async function validateRenderToken(token: string): Promise<RenderAccountMetadata> {
  type OwnerItem = { cursor?: string; owner?: RenderOwner };
  const items = await renderRequest<OwnerItem[]>(token, "/owners?limit=1");
  const owner = items?.[0]?.owner;

  if (!owner?.id) {
    throw new RenderApiError({
      message: "Token Render valido mas sem workspace acessivel.",
      status: 403,
    });
  }

  return {
    ownerEmail: owner.email ?? null,
    ownerId: owner.id,
    ownerName: owner.name ?? null,
  };
}

async function findExistingService(token: string, name: string): Promise<RenderService | null> {
  try {
    const raw = await renderRequest<unknown>(token, "/services?limit=100");
    const items = Array.isArray(raw) ? raw : [];

    for (const item of items) {
      const record = item as Record<string, unknown>;
      const wrapped = record.service as RenderService | undefined;
      const service: RenderService = wrapped ?? record;
      if (service?.name === name && service?.id) {
        return service;
      }
    }
    return null;
  } catch (error) {
    console.error("[cloud/render] failed to list services for adoption check", error);
    return null;
  }
}

export async function createRenderSpikeDeployment(token: string, userId: string): Promise<RenderSpikeDeployment> {
  type OwnerItem = { cursor?: string; owner?: RenderOwner };
  const items = await renderRequest<OwnerItem[]>(token, "/owners?limit=1");
  const owner = items?.[0]?.owner;
  if (!owner?.id) {
    throw new RenderApiError({
      message: "Nenhum workspace acessivel com este token.",
      status: 403,
    });
  }

  const serviceName = renderServiceNameForUser(userId);

  const existing = await findExistingService(token, serviceName);
  if (existing?.id) {
    return {
      deployId: null,
      error: null,
      ownerId: owner.id,
      ownerName: owner.name ?? serviceName,
      publicUrl: existing.serviceDetails?.url ?? null,
      serviceId: existing.id,
      serviceName: existing.name ?? serviceName,
      status: "provisioning",
    };
  }

  type CreateResponse = { deployId?: string; service?: RenderService };
  const reply = await renderRequest<CreateResponse>(token, "/services", {
    body: JSON.stringify({
      autoDeploy: "no",
      branch: RENDER_SPIKE_BRANCH,
      name: serviceName,
      ownerId: owner.id,
      repo: RENDER_SPIKE_REPO,
      serviceDetails: {
        envSpecificDetails: {
          dockerContext: ".",
          dockerfilePath: "./Dockerfile",
        },
        healthCheckPath: "/",
        plan: RENDER_SPIKE_PLAN,
        region: RENDER_SPIKE_REGION,
        runtime: "docker",
      },
      type: "web_service",
    }),
    method: "POST",
  });

  const service = reply?.service;
  if (!service?.id || !service?.name) {
    throw new RenderApiError({
      message: "Render nao retornou um ID de servico.",
      status: 502,
    });
  }

  return {
    deployId: reply.deployId ?? null,
    error: null,
    ownerId: owner.id,
    ownerName: owner.name ?? serviceName,
    publicUrl: service.serviceDetails?.url ?? null,
    serviceId: service.id,
    serviceName: service.name,
    status: "provisioning",
  };
}

export async function refreshRenderDeployment(
  token: string,
  serviceId: string,
  deployId: string | null,
): Promise<RenderDeploymentRefresh> {
  try {
    const service = await renderRequest<RenderService>(
      token,
      `/services/${encodeURIComponent(serviceId)}`,
    );

    type DeployItem = { cursor?: string; deploy?: RenderDeploy };
    let latestDeploy: RenderDeploy | undefined;
    try {
      const deployItems = await renderRequest<DeployItem[]>(
        token,
        `/services/${encodeURIComponent(serviceId)}/deploys?limit=1`,
      );
      latestDeploy = deployItems?.[0]?.deploy;
    } catch {
      // Deploy list may fail if service was just created
    }

    const nextDeployId = latestDeploy?.id ?? deployId;
    const mapped = mapRenderDeployStatus(latestDeploy?.status, service.suspended);

    return {
      deployId: nextDeployId ?? null,
      error: mapped.error,
      missing: false,
      publicUrl: service.serviceDetails?.url ?? null,
      status: mapped.status,
    };
  } catch (error) {
    if (error instanceof RenderApiError && error.status === 404) {
      return { deployId, error: null, missing: true, publicUrl: null, status: "failed" };
    }
    throw error;
  }
}

function renderOpenClawServiceName(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `modelhub-openclaw-${hash}`;
}

export function getRenderOpenClawServiceName(userId: string): string {
  return renderOpenClawServiceName(userId);
}

export type RenderOpenClawDeployment = RenderSpikeDeployment & {
  gatewayToken: string;
  openclaw: RenderOpenClawInfo;
};

export type RenderOpenClawInfo = {
  allowedOrigins: string[];
  controlUiUrl: string;
  healthUrl: string;
  model: string;
  modelhubApiUrl: string;
  provider: string;
  readyUrl: string;
  webSocketUrl: string;
};

export type OpenClawConfigInput = {
  allowedOrigins?: string[];
  model: string;
  modelhubApiUrl: string;
  provider: string;
  serviceUrl: string;
};

function buildOpenClawEnvVars(
  gatewayToken: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput,
): Array<{ key: string; value: string }> {
  const openclaw = buildOpenClawInfo(config);
  return [
    { key: "OPENCLAW_GATEWAY_PORT", value: String(RENDER_OPENCLAW_PORT) },
    { key: "OPENCLAW_GATEWAY_TOKEN", value: gatewayToken },
    // Standard OpenAI SDK env vars — OpenClaw forwards requests to this base URL
    { key: "OPENAI_API_KEY", value: modelhubApiKey },
    { key: "OPENAI_BASE_URL", value: modelhubApiUrl },
    // Gateway reads its config from this exact path (absolute priority); the bootstrap
    // script writes openclaw.json here too, so write/read paths always match.
    { key: "OPENCLAW_CONFIG_PATH", value: RENDER_OPENCLAW_CONFIG_PATH },
    { key: "OPENCLAW_NO_AUTO_UPDATE", value: "1" },
    { key: "OPENCLAW_STATE_DIR", value: "/tmp/openclaw-state" },
    { key: "OPENCLAW_WORKSPACE_DIR", value: "/tmp/openclaw-workspace" },
    { key: "MODELHUB_OPENCLAW_ALLOWED_ORIGINS", value: openclaw.allowedOrigins.join(",") },
    { key: "MODELHUB_OPENCLAW_CONFIG_JSON", value: JSON.stringify(buildOpenClawRuntimeConfig(openclaw)) },
    { key: "MODELHUB_OPENCLAW_CONTROL_UI_URL", value: openclaw.controlUiUrl },
    { key: "MODELHUB_OPENCLAW_MODEL", value: openclaw.model },
    { key: "MODELHUB_OPENCLAW_PROVIDER", value: openclaw.provider },
    { key: "MODELHUB_OPENCLAW_WEBSOCKET_URL", value: openclaw.webSocketUrl },
  ];
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function uniqueOrigins(origins: string[]): string[] {
  return Array.from(new Set(origins.map(normalizeOrigin).filter((origin): origin is string => !!origin)));
}

function publicUrlForOpenClawServiceName(serviceName: string): string {
  return `https://${serviceName}.onrender.com`;
}

function webSocketUrlFromServiceUrl(serviceUrl: string): string {
  const origin = normalizeOrigin(serviceUrl) ?? serviceUrl;
  return origin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

export function buildOpenClawInfo(input: OpenClawConfigInput): RenderOpenClawInfo {
  const serviceOrigin = normalizeOrigin(input.serviceUrl) ?? input.serviceUrl;
  const modelhubOrigin = normalizeOrigin(input.modelhubApiUrl) ?? input.modelhubApiUrl;
  const allowedOrigins = uniqueOrigins([
    serviceOrigin,
    modelhubOrigin,
    ...(input.allowedOrigins ?? []),
  ]);

  return {
    allowedOrigins,
    controlUiUrl: serviceOrigin,
    healthUrl: `${serviceOrigin}/healthz`,
    model: input.model,
    modelhubApiUrl: input.modelhubApiUrl,
    provider: input.provider,
    readyUrl: `${serviceOrigin}/readyz`,
    webSocketUrl: webSocketUrlFromServiceUrl(serviceOrigin),
  };
}

function buildOpenClawRuntimeConfig(openclaw: RenderOpenClawInfo) {
  const modelReference = `modelhub/${openclaw.model}`;
  return {
    agents: {
      defaults: {
        model: { primary: modelReference },
        models: {
          [modelReference]: { alias: openclaw.model },
        },
        timeoutSeconds: OPENCLAW_AGENT_TIMEOUT_SECONDS,
      },
    },
    gateway: {
      auth: {
        mode: "token",
        token: "${OPENCLAW_GATEWAY_TOKEN}",
      },
      bind: "lan",
      controlUi: {
        allowedOrigins: openclaw.allowedOrigins,
      },
      http: {
        endpoints: {
          // Disabled by default in OpenClaw — required so the ModelHub chat proxy
          // can POST to /v1/chat/completions (otherwise the gateway returns 404).
          chatCompletions: { enabled: true },
        },
      },
      mode: "local",
      port: RENDER_OPENCLAW_PORT,
    },
    models: {
      mode: "merge",
      providers: {
        modelhub: {
          api: "openai-completions",
          apiKey: "${OPENAI_API_KEY}",
          baseUrl: openclaw.modelhubApiUrl,
          timeoutSeconds: OPENCLAW_PROVIDER_TIMEOUT_SECONDS,
          models: [
            {
              contextWindow: 128000,
              id: openclaw.model,
              input: ["text"],
              maxTokens: 32000,
              name: openclaw.model,
            },
          ],
        },
      },
    },
    update: {
      checkOnStart: false,
    },
    // Free-tier footprint reduction: keep the browser plugin but disable the
    // heaviest non-essential ones (canvas/phone/voice) so the 512MB instance
    // doesn't OOM and the event loop stays responsive for health checks.
    plugins: {
      entries: {
        canvas: { enabled: false },
        "phone-control": { enabled: false },
        "talk-voice": { enabled: false },
      },
    },
  };
}

export async function createRenderOpenClawDeployment(
  token: string,
  userId: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  openclawConfig: Pick<OpenClawConfigInput, "allowedOrigins" | "model" | "provider">,
): Promise<RenderOpenClawDeployment> {
  type OwnerItem = { cursor?: string; owner?: RenderOwner };
  const items = await renderRequest<OwnerItem[]>(token, "/owners?limit=1");
  const owner = items?.[0]?.owner;
  if (!owner?.id) {
    throw new RenderApiError({
      message: "Nenhum workspace acessivel com este token.",
      status: 403,
    });
  }

  const serviceName = renderOpenClawServiceName(userId);
  const plannedServiceUrl = publicUrlForOpenClawServiceName(serviceName);
  const gatewayToken = randomBytes(32).toString("hex");
  const configInput: OpenClawConfigInput = {
    ...openclawConfig,
    modelhubApiUrl,
    serviceUrl: plannedServiceUrl,
  };
  const envVars = buildOpenClawEnvVars(gatewayToken, modelhubApiUrl, modelhubApiKey, configInput);
  const openclaw = buildOpenClawInfo(configInput);

  // If service already exists: update its env vars and trigger a new deploy
  const existing = await findExistingService(token, serviceName);
  if (existing?.id) {
    const existingId = encodeURIComponent(existing.id);
    await renderRequest(token, `/services/${existingId}/env-vars`, {
      body: JSON.stringify(envVars),
      method: "PUT",
    });
    await renderRequest(token, `/services/${existingId}`, {
      body: JSON.stringify({
        serviceDetails: {
          envSpecificDetails: {
            dockerCommand: RENDER_OPENCLAW_DOCKER_COMMAND,
          },
          // Empty path = Render falls back to TCP port detection, which is more
          // tolerant of brief event-loop stalls than the 5s HTTP health check.
          healthCheckPath: "",
          runtime: "image",
        },
      }),
      method: "PATCH",
    });
    type DeployResponse = { deploy?: { id?: string } } | { id?: string };
    const deployReply = await renderRequest<DeployResponse>(
      token,
      `/services/${existingId}/deploys`,
      { body: JSON.stringify({ clearCache: "do_not_clear" }), method: "POST" },
    );
    const deployId = ("deploy" in deployReply ? deployReply.deploy?.id : (deployReply as { id?: string }).id) ?? null;
    return {
      deployId,
      error: null,
      gatewayToken,
      openclaw,
      ownerId: owner.id,
      ownerName: owner.name ?? serviceName,
      publicUrl: existing.serviceDetails?.url ?? null,
      serviceId: existing.id,
      serviceName: existing.name ?? serviceName,
      status: "provisioning",
    };
  }

  type CreateResponse = { deployId?: string; service?: RenderService };
  const reply = await renderRequest<CreateResponse>(token, "/services", {
    body: JSON.stringify({
      envVars,
      image: { imagePath: RENDER_OPENCLAW_IMAGE, ownerId: owner.id },
      name: serviceName,
      ownerId: owner.id,
      serviceDetails: {
        envSpecificDetails: {
          dockerCommand: RENDER_OPENCLAW_DOCKER_COMMAND,
        },
        // Empty path = Render falls back to TCP port detection, which is more
        // tolerant of brief event-loop stalls than the 5s HTTP health check.
        healthCheckPath: "",
        plan: RENDER_OPENCLAW_PLAN,
        region: RENDER_OPENCLAW_REGION,
        runtime: "image",
      },
      type: "web_service",
    }),
    method: "POST",
  });

  const service = reply?.service;
  if (!service?.id || !service?.name) {
    throw new RenderApiError({
      message: "Render nao retornou um ID de servico.",
      status: 502,
    });
  }

  return {
    deployId: reply.deployId ?? null,
    error: null,
    gatewayToken,
    openclaw,
    ownerId: owner.id,
    ownerName: owner.name ?? serviceName,
    publicUrl: service.serviceDetails?.url ?? null,
    serviceId: service.id,
    serviceName: service.name,
    status: "provisioning",
  };
}

export async function updateRenderOpenClawDeployment(
  token: string,
  serviceId: string,
  gatewayToken: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput,
): Promise<{ deployId: string | null; openclaw: RenderOpenClawInfo }> {
  const openclaw = buildOpenClawInfo(config);
  const envVars = buildOpenClawEnvVars(gatewayToken, modelhubApiUrl, modelhubApiKey, config);

  await renderRequest(token, `/services/${encodeURIComponent(serviceId)}/env-vars`, {
    body: JSON.stringify(envVars),
    method: "PUT",
  });
  await renderRequest(token, `/services/${encodeURIComponent(serviceId)}`, {
    body: JSON.stringify({
      serviceDetails: {
        envSpecificDetails: {
          dockerCommand: RENDER_OPENCLAW_DOCKER_COMMAND,
        },
        // Empty path = Render falls back to TCP port detection, which is more
        // tolerant of brief event-loop stalls than the 5s HTTP health check.
        healthCheckPath: "",
        runtime: "image",
      },
    }),
    method: "PATCH",
  });

  type DeployResponse = { deploy?: { id?: string } } | { id?: string };
  const deployReply = await renderRequest<DeployResponse>(
    token,
    `/services/${encodeURIComponent(serviceId)}/deploys`,
    { body: JSON.stringify({ clearCache: "do_not_clear" }), method: "POST" },
  );
  return {
    deployId: ("deploy" in deployReply ? deployReply.deploy?.id : (deployReply as { id?: string }).id) ?? null,
    openclaw,
  };
}

export async function deleteRenderService(token: string, serviceId: string): Promise<"deleted" | "missing"> {
  try {
    await renderRequest(token, `/services/${encodeURIComponent(serviceId)}`, {
      method: "DELETE",
    });
    return "deleted";
  } catch (error) {
    if (error instanceof RenderApiError && error.status === 404) {
      return "missing";
    }
    throw error;
  }
}
