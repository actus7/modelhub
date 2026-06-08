import { randomBytes } from "node:crypto";

import type { CloudDeploymentStatus } from "@/lib/contracts";
import type { CloudProviderDriver, CloudProvider, ProviderLimits, AccountMetadata, OpenClawConfigInput, OpenClawInfo, OpenClawDeployResult, DeploymentUpdateResult, DeploymentRefresh, RailwayOpenClawResult } from "./driver";
import { CloudProviderError, CloudProviderErrorType } from "./driver";
import { generateResourceName } from "./driver";
import { buildOpenClawInfo, buildOpenClawRuntimeConfig } from "./render";

const RAILWAY_API_BASE = "https://backboard.railway.app/graphql/v2";
export const RAILWAY_OPENCLAW_IMAGE = "ghcr.io/openclaw/openclaw:latest";
export const RAILWAY_OPENCLAW_PORT = 10000;

// Railway-specific types
type RailwayUser = {
  id: string;
  name?: string;
  email?: string;
};

type RailwayProject = {
  id: string;
  name: string;
};

type RailwayEnvironment = {
  id: string;
  name: string;
};

type RailwayService = {
  id: string;
  name: string;
};

type RailwayDeployment = {
  id: string;
  status: string;
  url?: string;
  createdAt: string;
};

// API request wrapper with error handling
async function railwayRequest<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(RAILWAY_API_BASE, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new CloudProviderError(
      response.status === 401 ? CloudProviderErrorType.AUTHENTICATION : CloudProviderErrorType.SERVICE_UNAVAILABLE,
      "railway",
      `Railway API error: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();

  if (result.errors) {
    const errorMessage = `Railway GraphQL errors: ${JSON.stringify(result.errors)}`;
    const isAuth = result.errors.some((err: any) => {
      const msg = (err.message ?? "").toLowerCase();
      return msg.includes('unauthorized') || msg.includes('not authorized') || msg.includes('authentication') || msg.includes('forbidden');
    });

    throw new CloudProviderError(
      isAuth ? CloudProviderErrorType.AUTHENTICATION : CloudProviderErrorType.UNKNOWN,
      "railway",
      errorMessage
    );
  }

  return result.data;
}

// GraphQL queries and mutations
const VALIDATE_TOKEN_QUERY = `
  query ValidateToken {
    me {
      id
      name
      email
    }
  }
`;

const LIST_PROJECTS_QUERY = `
  query ListProjects {
    me {
      projects {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }
`;

const CREATE_PROJECT_MUTATION = `
  mutation CreateProject($name: String!) {
    createProject(name: $name) {
      id
      name
    }
  }
`;

const GET_PROJECT_ENVIRONMENTS_QUERY = `
  query GetProjectEnvironments($projectId: String!) {
    project(id: $projectId) {
      environments {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }
`;

const CREATE_SERVICE_MUTATION = `
  mutation CreateService($projectId: String!, $name: String!, $source: ServiceSourceInput!) {
    createService(projectId: $projectId, name: $name, source: $source) {
      id
      name
    }
  }
`;

const UPSERT_VARIABLES_MUTATION = `
  mutation UpsertVariables($projectId: String!, $environmentId: String!, $variables: [Variable!]!) {
    variableUpsert(projectId: $projectId, environmentId: $environmentId, variables: $variables)
  }
`;

const CREATE_DEPLOYMENT_MUTATION = `
  mutation CreateDeployment($serviceId: String!) {
    deploymentCreate(serviceId: $serviceId) {
      id
      status
      createdAt
    }
  }
`;

const GET_DEPLOYMENT_QUERY = `
  query GetDeployment($id: String!) {
    deployment(id: $id) {
      id
      status
      createdAt
      url
    }
  }
`;

const DELETE_SERVICE_MUTATION = `
  mutation DeleteService($id: String!) {
    deleteService(id: $id)
  }
`;

// Status mapping
function mapRailwayDeploymentStatus(railwayStatus: string): {
  status: CloudDeploymentStatus;
  error: string | null;
} {
  switch (railwayStatus?.toLowerCase()) {
    case "success":
    case "active":
      return { status: "healthy", error: null };

    case "queued":
    case "building":
    case "deploying":
      return { status: "provisioning", error: null };

    case "failed":
    case "crashed":
    case "removed":
      return { status: "failed", error: "Deploy falhou no Railway" };

    case "sleeping":
    case "skipped":
      return { status: "healthy", error: null };

    default:
      return { status: "provisioning", error: null };
  }
}

// Free tier error detection
export function isRailwayFreeTierError(error: unknown): boolean {
  if (!(error instanceof CloudProviderError)) return false;

  const errorText = error.message.toLowerCase();
  const originalErrorText = (JSON.stringify(error.originalError) || "").toLowerCase();

  const freeTierKeywords = [
    "credit", "credits", "limit", "quota", "plan", "upgrade", "billing", "payment"
  ];

  return freeTierKeywords.some(keyword =>
    errorText.includes(keyword) || originalErrorText.includes(keyword)
  );
}

// Provider limits
export const RAILWAY_LIMITS: ProviderLimits = {
  freeTier: {
    memory: "Baseado em crédito ($5/mês)",
    cpu: "Baseado em crédito",
    sleepBehavior: "Sem sleep automático"
  },
  rateLimits: {
    general: "Não documentado publicamente"
  },
  constraints: [
    "Crédito de $5/mês pode esgotar rapidamente",
    "Sem controle fino de recursos no free tier",
    "Billing baseado em uso de CPU/RAM por segundo"
  ]
};

// Helper functions
function buildRailwayEnvVars(
  gatewayToken: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput & { serviceUrl: string }
): Array<{ key: string; value: string }> {
  const openclaw = buildOpenClawInfo(config);
  return [
    { key: "OPENCLAW_GATEWAY_PORT", value: String(RAILWAY_OPENCLAW_PORT) },
    { key: "OPENCLAW_GATEWAY_TOKEN", value: gatewayToken },
    { key: "OPENAI_API_KEY", value: modelhubApiKey },
    { key: "OPENAI_BASE_URL", value: modelhubApiUrl },
    { key: "OPENCLAW_CONFIG_PATH", value: "/tmp/openclaw-state/openclaw.json" },
    { key: "OPENCLAW_NO_AUTO_UPDATE", value: "1" },
    { key: "OPENCLAW_STATE_DIR", value: "/tmp/openclaw-state" },
    { key: "OPENCLAW_WORKSPACE_DIR", value: "/tmp/openclaw-workspace" },
    { key: "MODELHUB_OPENCLAW_CONFIG_JSON", value: JSON.stringify(buildOpenClawRuntimeConfig(openclaw)) }
  ];
}

// Main implementation functions
export async function validateRailwayToken(token: string): Promise<AccountMetadata> {
  const data = await railwayRequest<{ me: RailwayUser }>(token, VALIDATE_TOKEN_QUERY);

  if (!data.me?.id) {
    throw new CloudProviderError(
      CloudProviderErrorType.AUTHENTICATION,
      "railway",
      "Token Railway válido mas sem acesso a dados do usuário"
    );
  }

  return {
    userEmail: data.me.email || null,
    userId: data.me.id,
    userName: data.me.name || null,
    organizationId: data.me.id,
    organizationName: data.me.name || null
  };
}

export async function createRailwayOpenClaw(
  token: string,
  userId: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput
): Promise<RailwayOpenClawResult> {
  // 1. Validate token
  await railwayRequest<{ me: RailwayUser }>(token, VALIDATE_TOKEN_QUERY);

  const projectName = generateResourceName("railway", userId, "project");

  // 2. Find or create project
  const projects = await railwayRequest<{
    me: {
      projects: {
        edges: Array<{ node: RailwayProject }>
      }
    }
  }>(token, LIST_PROJECTS_QUERY);

  let projectId: string;
  const existingProject = projects.me.projects.edges.find(edge => edge.node.name === projectName);

  if (existingProject) {
    projectId = existingProject.node.id;
  } else {
    const newProject = await railwayRequest<{ createProject: RailwayProject }>(
      token,
      CREATE_PROJECT_MUTATION,
      { name: projectName }
    );
    projectId = newProject.createProject.id;
  }

  // 3. Get production environment
  const environments = await railwayRequest<{
    project: {
      environments: {
        edges: Array<{ node: RailwayEnvironment }>
      }
    }
  }>(token, GET_PROJECT_ENVIRONMENTS_QUERY, { projectId });

  const productionEnv = environments.project.environments.edges.find(
    edge => edge.node.name.toLowerCase() === "production"
  );

  if (!productionEnv) {
    throw new CloudProviderError(
      CloudProviderErrorType.RESOURCE_NOT_FOUND,
      "railway",
      "Environment 'production' não encontrado no projeto Railway"
    );
  }

  const environmentId = productionEnv.node.id;
  const serviceName = "openclaw";
  const gatewayToken = randomBytes(32).toString("hex");
  // Railway assigns the public URL only after the deployment is live; populated on first refresh.
  const publicUrl = null;

  // 4. Create service
  const service = await railwayRequest<{ createService: RailwayService }>(
    token,
    CREATE_SERVICE_MUTATION,
    {
      projectId,
      name: serviceName,
      source: {
        image: {
          image: RAILWAY_OPENCLAW_IMAGE
        }
      }
    }
  );

  const serviceId = service.createService.id;

  // 5. Set environment variables
  const envVars = buildRailwayEnvVars(gatewayToken, modelhubApiUrl, modelhubApiKey, {
    ...config,
    serviceUrl: publicUrl ?? "",
    modelhubApiUrl
  });

  await railwayRequest(
    token,
    UPSERT_VARIABLES_MUTATION,
    {
      projectId,
      environmentId,
      variables: envVars.map(({ key, value }) => ({ name: key, value }))
    }
  );

  // 6. Create deployment
  const deployment = await railwayRequest<{ deploymentCreate: RailwayDeployment }>(
    token,
    CREATE_DEPLOYMENT_MUTATION,
    { serviceId }
  );

  const deployId = deployment.deploymentCreate.id;
  const openclaw = buildOpenClawInfo({
    ...config,
    serviceUrl: publicUrl ?? "",
    modelhubApiUrl
  });

  // Encode projectId and environmentId into serviceId so updateRailwayOpenClaw can
  // call variableUpsert without requiring a separate DB lookup.
  const compositeServiceId = `${serviceId}:${projectId}:${environmentId}`;

  return {
    serviceId: compositeServiceId,
    deployId,
    gatewayToken,
    publicUrl,
    status: "provisioning",
    openclaw,
    projectId,
    environmentId,
    serviceName
  };
}

export async function updateRailwayOpenClaw(
  token: string,
  compositeServiceId: string,
  gatewayToken: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput
): Promise<DeploymentUpdateResult> {
  const [serviceId, projectId, environmentId] = compositeServiceId.split(":");

  if (projectId && environmentId) {
    const envVars = buildRailwayEnvVars(gatewayToken, modelhubApiUrl, modelhubApiKey, {
      ...config,
      serviceUrl: config.serviceUrl ?? ""
    });
    await railwayRequest(token, UPSERT_VARIABLES_MUTATION, {
      projectId,
      environmentId,
      variables: envVars.map(({ key, value }) => ({ name: key, value }))
    });
  }

  const deployment = await railwayRequest<{ deploymentCreate: RailwayDeployment }>(
    token,
    CREATE_DEPLOYMENT_MUTATION,
    { serviceId }
  );

  return {
    deployId: deployment.deploymentCreate.id,
    openclaw: buildOpenClawInfo(config)
  };
}

export async function refreshRailwayDeployment(
  token: string,
  serviceId: string,
  deployId: string | null
): Promise<DeploymentRefresh> {
  if (!deployId) {
    return {
      deployId: null,
      error: "No deployment ID provided",
      missing: true,
      publicUrl: null,
      status: "failed"
    };
  }

  try {
    const deployment = await railwayRequest<{ deployment: RailwayDeployment }>(
      token,
      GET_DEPLOYMENT_QUERY,
      { id: deployId }
    );

    const mapped = mapRailwayDeploymentStatus(deployment.deployment.status);

    return {
      deployId: deployment.deployment.id,
      error: mapped.error,
      missing: false,
      publicUrl: deployment.deployment.url || null,
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

export async function deleteRailwayService(token: string, compositeServiceId: string): Promise<"deleted" | "missing"> {
  const [serviceId] = compositeServiceId.split(":");
  try {
    await railwayRequest(token, DELETE_SERVICE_MUTATION, { id: serviceId });
    return "deleted";
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) {
      return "missing";
    }
    throw error;
  }
}

// CloudProviderDriver implementation for Railway
export const railwayDriver: CloudProviderDriver = {
  async validateToken(token: string): Promise<AccountMetadata> {
    return await validateRailwayToken(token);
  },

  async createOpenClaw(
    token: string,
    userId: string,
    modelhubApiUrl: string,
    modelhubApiKey: string,
    config: OpenClawConfigInput
  ): Promise<OpenClawDeployResult> {
    try {
      return await createRailwayOpenClaw(token, userId, modelhubApiUrl, modelhubApiKey, config);
    } catch (error) {
      if (!(error instanceof CloudProviderError)) {
        throw new CloudProviderError(
          CloudProviderErrorType.UNKNOWN,
          "railway",
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
      return await updateRailwayOpenClaw(token, serviceId, gatewayToken, modelhubApiUrl, modelhubApiKey, config);
    } catch (error) {
      if (!(error instanceof CloudProviderError)) {
        throw new CloudProviderError(
          CloudProviderErrorType.UNKNOWN,
          "railway",
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
      return await refreshRailwayDeployment(token, serviceId, deployId);
    } catch (error) {
      if (!(error instanceof CloudProviderError)) {
        throw new CloudProviderError(
          CloudProviderErrorType.UNKNOWN,
          "railway",
          error instanceof Error ? error.message : "Unknown error",
          error
        );
      }
      throw error;
    }
  },

  async deleteService(token: string, serviceId: string): Promise<"deleted" | "missing"> {
    try {
      return await deleteRailwayService(token, serviceId);
    } catch (error) {
      if (!(error instanceof CloudProviderError)) {
        throw new CloudProviderError(
          CloudProviderErrorType.UNKNOWN,
          "railway",
          error instanceof Error ? error.message : "Unknown error",
          error
        );
      }
      throw error;
    }
  },

  getServiceName(userId: string): string {
    return generateResourceName("railway", userId, "service");
  },

  isFreeTierError(error: unknown): boolean {
    return isRailwayFreeTierError(error);
  },

  getProviderLimits(): ProviderLimits {
    return RAILWAY_LIMITS;
  },

  getProviderName(): CloudProvider {
    return "railway";
  }
};