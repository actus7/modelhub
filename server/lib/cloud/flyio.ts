import { randomBytes } from "node:crypto";

import type { CloudDeploymentStatus } from "@/lib/contracts";
import type { CloudProviderDriver, AccountMetadata, OpenClawConfigInput, OpenClawInfo, OpenClawDeployResult, DeploymentUpdateResult, DeploymentRefresh } from "./driver";
import {
  CloudProviderError,
  CloudProviderErrorType,
  generateResourceName
} from "./driver";
import { buildOpenClawInfo, buildOpenClawRuntimeConfig } from "./render";

const FLY_API_BASE = "https://api.machines.dev/v1";
export const FLYIO_OPENCLAW_IMAGE = "ghcr.io/openclaw/openclaw:latest";
export const FLYIO_OPENCLAW_PORT = 10000;

const FLY_RATE_LIMIT = {
  general: 5, // req/s
  burst: 10, // req/s
  deleteLimit: 100 // per minute
};

// Fly.io-specific types
type FlyApp = {
  id: string;
  name: string;
  machine_count: number;
  network: string;
};

type FlyMachine = {
  id: string;
  name: string;
  state: "created" | "starting" | "started" | "stopping" | "stopped" | "replacing" | "destroying" | "destroyed";
  region: string;
  instance_id: string;
  private_ip: string;
  config: {
    image: string;
    guest: {
      cpu_kind: string;
      cpus: number;
      memory_mb: number;
    };
    restart: {
      policy: string;
    };
    auto_destroy: boolean;
  };
  image_ref: {
    registry: string;
    repository: string;
    tag: string;
    digest: string;
  };
  created_at: string;
  updated_at: string;
};

type FlyMachineConfig = {
  image: string;
  env?: Record<string, string>;
  restart?: {
    policy: "no" | "always" | "on-failure";
  };
  auto_destroy?: boolean;
  guest?: {
    cpu_kind?: "shared" | "performance";
    cpus?: number;
    memory_mb?: number;
  };
  services?: Array<{
    protocol: "tcp" | "udp";
    internal_port: number;
    ports: Array<{
      port: number;
      handlers: string[];
    }>;
    checks?: Array<{
      grace_period?: string;
      interval?: string;
      method?: string;
      path?: string;
      port?: number;
      protocol?: string;
      timeout?: string;
      type: "http" | "tcp";
    }>;
  }>;
};

// Rate limiter class for Fly.io
class FlyRateLimiter {
  private lastRequest = 0;
  private requestQueue: Array<() => void> = [];

  async request<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const now = Date.now();
          const timeSinceLastRequest = now - this.lastRequest;
          const minInterval = 1000 / FLY_RATE_LIMIT.general; // 200ms para 5 req/s

          if (timeSinceLastRequest < minInterval) {
            await new Promise(r => setTimeout(r, minInterval - timeSinceLastRequest));
          }

          this.lastRequest = Date.now();
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  private processQueue() {
    if (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift()!;
      Promise.resolve(next()).finally(() => { this.processQueue(); });
    }
  }
}

const flyRateLimiter = new FlyRateLimiter();

// API request wrapper with rate limiting and error handling
async function flyRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  return flyRateLimiter.request(async () => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");

    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${FLY_API_BASE}${path}`, {
      ...init,
      headers,
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new CloudProviderError(
        CloudProviderErrorType.RATE_LIMIT,
        "fly.io",
        "Rate limit exceeded",
        response,
        retryAfter ? parseInt(retryAfter) * 1000 : 5000
      );
    }

    if (!response.ok) {
      const errorType = response.status === 401
        ? CloudProviderErrorType.AUTHENTICATION
        : response.status === 404
        ? CloudProviderErrorType.RESOURCE_NOT_FOUND
        : CloudProviderErrorType.SERVICE_UNAVAILABLE;

      throw new CloudProviderError(
        errorType,
        "fly.io",
        `Fly.io API error: ${response.status} ${response.statusText}`,
        await response.text().catch(() => "")
      );
    }

    if (response.status === 204) return null as T;

    return await response.json() as T;
  });
}

// Status mapping
function mapFlyMachineState(flyState: string): {
  status: CloudDeploymentStatus;
  error: string | null;
} {
  switch (flyState) {
    case "started":
    case "running":
      return { status: "healthy", error: null };

    case "created":
    case "starting":
      return { status: "provisioning", error: null };

    case "stopped":
    case "stopping":
      return { status: "healthy", error: "Machine pausada (free tier)" };

    case "destroyed":
    case "destroying":
      return { status: "failed", error: "Machine destruída" };

    default:
      return { status: "provisioning", error: null };
  }
}

// Free tier error detection
export function isFlyFreeTierError(error: unknown): boolean {
  if (!(error instanceof CloudProviderError)) return false;

  const errorText = error.message.toLowerCase();
  const originalErrorText = (JSON.stringify(error.originalError) || "").toLowerCase();

  const freeTierKeywords = [
    "limit", "quota", "billing", "plan", "upgrade", "payment", "credit",
    "maximum", "exceeded", "allowance"
  ];

  return freeTierKeywords.some(keyword =>
    errorText.includes(keyword) || originalErrorText.includes(keyword)
  );
}

// Machine config builder
function buildFlyMachineConfig(
  gatewayToken: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput
): FlyMachineConfig {
  const openclaw = buildOpenClawInfo(config);

  return {
    image: FLYIO_OPENCLAW_IMAGE,
    env: {
      "OPENCLAW_GATEWAY_PORT": "10000",
      "OPENCLAW_GATEWAY_TOKEN": gatewayToken,
      "OPENAI_API_KEY": modelhubApiKey,
      "OPENAI_BASE_URL": modelhubApiUrl,
      "OPENCLAW_CONFIG_PATH": "/tmp/openclaw-state/openclaw.json",
      "OPENCLAW_NO_AUTO_UPDATE": "1",
      "OPENCLAW_STATE_DIR": "/tmp/openclaw-state",
      "OPENCLAW_WORKSPACE_DIR": "/tmp/openclaw-workspace",
      "MODELHUB_OPENCLAW_CONFIG_JSON": JSON.stringify(buildOpenClawRuntimeConfig(openclaw))
    },
    restart: {
      policy: "always"
    },
    auto_destroy: false,
    guest: {
      cpu_kind: "shared",
      cpus: 1,
      memory_mb: 256 // Free tier limit
    },
    services: [{
      protocol: "tcp",
      internal_port: 10000,
      ports: [
        { port: 443, handlers: ["tls"] },
        { port: 80, handlers: ["http"] }
      ],
      checks: [{
        type: "http",
        path: "/healthz",
        port: 10000,
        interval: "30s",
        timeout: "10s",
        grace_period: "30s"
      }]
    }]
  };
}

// Main implementation functions
export async function validateFlyToken(token: string): Promise<AccountMetadata> {
  // Validate by listing apps (simplest API call)
  await flyRequest<FlyApp[]>(token, "/apps");

  // Fly.io doesn't provide user details in the apps API, so we return minimal info
  return {
    userEmail: null,
    userId: "fly-user", // Fly doesn't expose user ID
    userName: null,
    organizationId: "personal", // Default org
    organizationName: "Personal"
  };
}

export async function createFlyOpenClaw(
  token: string,
  userId: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput
): Promise<OpenClawDeployResult> {
  // 1. Validate token
  await flyRequest<FlyApp[]>(token, "/apps");

  const appName = generateResourceName(userId);
  const gatewayToken = randomBytes(32).toString("hex");
  const publicUrl = `https://${appName}.fly.dev`;

  // 2. Check if app exists
  let app: FlyApp;
  try {
    app = await flyRequest<FlyApp>(token, `/apps/${appName}`);
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) {
      // 3. Create new app
      app = await flyRequest<FlyApp>(token, "/apps", {
        method: "POST",
        body: JSON.stringify({
          app_name: appName,
          org_slug: "personal" // Default for individual accounts
        })
      });
    } else {
      throw error;
    }
  }

  const machineConfig = buildFlyMachineConfig(
    gatewayToken,
    modelhubApiUrl,
    modelhubApiKey,
    {
      ...config,
      serviceUrl: publicUrl,
      modelhubApiUrl
    }
  );

  // 4. Create machine
  const machine = await flyRequest<FlyMachine>(token, `/apps/${appName}/machines`, {
    method: "POST",
    body: JSON.stringify({
      config: machineConfig,
      region: "iad" // Default region (Washington DC)
    })
  });

  // 5. Wait for machine to start (optional, with timeout)
  try {
    await flyRequest(token, `/apps/${appName}/machines/${machine.id}/wait?state=started&timeout=30`, {
      method: "POST"
    });
  } catch (error) {
    // Timeout is acceptable - machine may take longer to start
    console.warn("Fly machine start timeout - this is normal for first boot");
  }

  const openclaw = buildOpenClawInfo({
    ...config,
    serviceUrl: publicUrl,
    modelhubApiUrl
  });

  // Encode appName into serviceId so refresh/update/delete can resolve the correct path.
  // Fly.io Machines API requires /apps/{app_name}/machines/{machine_id} for all operations.
  const compositeServiceId = `${appName}/${machine.id}`;

  return {
    serviceId: compositeServiceId,
    deployId: machine.id,
    gatewayToken,
    publicUrl,
    status: "provisioning",
    openclaw,
  };
}

export async function updateFlyOpenClaw(
  token: string,
  compositeServiceId: string, // "appName/machineId"
  gatewayToken: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput
): Promise<DeploymentUpdateResult> {
  const slashIdx = compositeServiceId.indexOf("/");
  const appName = compositeServiceId.slice(0, slashIdx);
  const machineId = compositeServiceId.slice(slashIdx + 1);

  const machineConfig = buildFlyMachineConfig(gatewayToken, modelhubApiUrl, modelhubApiKey, config);

  const updatedMachine = await flyRequest<FlyMachine>(token, `/apps/${appName}/machines/${machineId}`, {
    method: "POST",
    body: JSON.stringify({ config: machineConfig })
  });

  return {
    deployId: updatedMachine.id,
    openclaw: buildOpenClawInfo(config)
  };
}

export async function refreshFlyDeployment(
  token: string,
  compositeServiceId: string, // "appName/machineId"
  deployId: string | null
): Promise<DeploymentRefresh> {
  const slashIdx = compositeServiceId.indexOf("/");
  const appName = compositeServiceId.slice(0, slashIdx);
  const machineId = compositeServiceId.slice(slashIdx + 1);

  try {
    const machine = await flyRequest<FlyMachine>(token, `/apps/${appName}/machines/${machineId}`);
    const mapped = mapFlyMachineState(machine.state);

    return {
      deployId: machine.id,
      error: mapped.error,
      missing: false,
      publicUrl: `https://${appName}.fly.dev`,
      status: mapped.status
    };
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) {
      return {
        deployId,
        error: null,
        missing: true,
        publicUrl: null,
        status: "failed"
      };
    }
    throw error;
  }
}

export async function deleteFlyService(token: string, compositeServiceId: string): Promise<"deleted" | "missing"> {
  const slashIdx = compositeServiceId.indexOf("/");
  const appName = compositeServiceId.slice(0, slashIdx);
  const machineId = compositeServiceId.slice(slashIdx + 1);

  try {
    await flyRequest(token, `/apps/${appName}/machines/${machineId}`, { method: "DELETE" });
    return "deleted";
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) {
      return "missing";
    }
    throw error;
  }
}

// CloudProviderDriver implementation for Fly.io
export const flyioDriver: CloudProviderDriver = {
  async validateToken(token: string): Promise<AccountMetadata> {
    return await validateFlyToken(token);
  },

  async createOpenClaw(
    token: string,
    userId: string,
    modelhubApiUrl: string,
    modelhubApiKey: string,
    config: OpenClawConfigInput
  ): Promise<OpenClawDeployResult> {
    try {
      return await createFlyOpenClaw(token, userId, modelhubApiUrl, modelhubApiKey, config);
    } catch (error) {
      if (!(error instanceof CloudProviderError)) {
        throw new CloudProviderError(
          CloudProviderErrorType.UNKNOWN,
          "fly.io",
          error instanceof Error ? error.message : "Unknown error",
          error
        );
      }
      throw error;
    }
  },

  async updateOpenClaw(
    token: string,
    serviceId: string,
    gatewayToken: string,
    modelhubApiUrl: string,
    modelhubApiKey: string,
    config: OpenClawConfigInput
  ): Promise<DeploymentUpdateResult> {
    try {
      return await updateFlyOpenClaw(token, serviceId, gatewayToken, modelhubApiUrl, modelhubApiKey, config);
    } catch (error) {
      if (!(error instanceof CloudProviderError)) {
        throw new CloudProviderError(
          CloudProviderErrorType.UNKNOWN,
          "fly.io",
          error instanceof Error ? error.message : "Unknown error",
          error
        );
      }
      throw error;
    }
  },

  async refresh(
    token: string,
    serviceId: string,
    deployId: string | null
  ): Promise<DeploymentRefresh> {
    try {
      return await refreshFlyDeployment(token, serviceId, deployId);
    } catch (error) {
      if (!(error instanceof CloudProviderError)) {
        throw new CloudProviderError(
          CloudProviderErrorType.UNKNOWN,
          "fly.io",
          error instanceof Error ? error.message : "Unknown error",
          error
        );
      }
      throw error;
    }
  },

  async deleteService(token: string, serviceId: string): Promise<"deleted" | "missing"> {
    try {
      return await deleteFlyService(token, serviceId);
    } catch (error) {
      if (!(error instanceof CloudProviderError)) {
        throw new CloudProviderError(
          CloudProviderErrorType.UNKNOWN,
          "fly.io",
          error instanceof Error ? error.message : "Unknown error",
          error
        );
      }
      throw error;
    }
  },

  getServiceName(userId: string): string {
    return generateResourceName(userId);
  },

  isFreeTierError(error: unknown): boolean {
    return isFlyFreeTierError(error);
  },
};