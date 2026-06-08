import { randomBytes } from "node:crypto";

import type { CloudDeploymentStatus } from "@/lib/contracts";
import type { CloudProviderDriver, AccountMetadata, OpenClawConfigInput, OpenClawInfo, OpenClawDeployResult, DeploymentUpdateResult, DeploymentRefresh } from "./driver";
import { CloudProviderError, CloudProviderErrorType, generateResourceName } from "./driver";
import { buildOpenClawInfo, buildOpenClawRuntimeConfig } from "./render";

const RAILWAY_API_BASE = "https://backboard.railway.app/graphql/v2";
export const RAILWAY_OPENCLAW_IMAGE = "ghcr.io/openclaw/openclaw:latest";
export const RAILWAY_OPENCLAW_PORT = 10000;

// Bootstrap script: writes openclaw.json from MODELHUB_OPENCLAW_CONFIG_JSON then starts the gateway.
// Must have no spaces (Railway splits start command on whitespace).
const RAILWAY_OPENCLAW_START_COMMAND = [
  "node",
  "-e",
  [
    "require('node:fs').mkdirSync(require('node:path').dirname(process.env.OPENCLAW_CONFIG_PATH),{recursive:true})",
    "require('node:fs').writeFileSync(process.env.OPENCLAW_CONFIG_PATH,process.env.MODELHUB_OPENCLAW_CONFIG_JSON||'{}')",
    "process.exit(require('node:child_process').spawnSync(process.execPath,['openclaw.mjs','gateway','run','--bind','lan'],{stdio:'inherit'}).status||0)",
  ].join(";"),
].join(" ");

// Railway-specific types
type RailwayUser = {
  id: string;
  name?: string;
  email?: string;
};

type RailwayProject = {
  id: string;
  name: string;
  workspaceId?: string;
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
    const body = await response.text().catch(() => "");
    throw new CloudProviderError(
      response.status === 401 ? CloudProviderErrorType.AUTHENTICATION : CloudProviderErrorType.SERVICE_UNAVAILABLE,
      "railway",
      `Railway API error: ${response.status} ${response.statusText} — ${body}`
    );
  }

  const result = await response.json();

  if (result.errors) {
    const errorMessage = `Railway GraphQL errors: ${JSON.stringify(result.errors)}`;
    const isAuth = result.errors.some((err: { message?: string }) => {
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

const LIST_WORKSPACES_QUERY = `
  query ListWorkspaces {
    me {
      workspaces {
        id
        name
      }
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
            workspaceId
          }
        }
      }
    }
  }
`;

const LIST_WORKSPACE_PROJECTS_QUERY = `
  query ListWorkspaceProjects($workspaceId: String!) {
    workspaceProjects(workspaceId: $workspaceId) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

const CREATE_PROJECT_MUTATION = `
  mutation CreateProject($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
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
  mutation CreateService($input: ServiceCreateInput!) {
    serviceCreate(input: $input) {
      id
      name
    }
  }
`;

const UPSERT_VARIABLES_MUTATION = `
  mutation UpsertVariables($input: VariableCollectionUpsertInput!) {
    variableCollectionUpsert(input: $input)
  }
`;

const UPDATE_SERVICE_INSTANCE_MUTATION = `
  mutation UpdateServiceInstance($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) {
    serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
  }
`;

const TRIGGER_DEPLOY_MUTATION = `
  mutation TriggerDeploy($input: EnvironmentTriggersDeployInput!) {
    environmentTriggersDeploy(input: $input)
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

const LIST_SERVICE_DEPLOYMENTS_QUERY = `
  query ListServiceDeployments($serviceId: String!, $environmentId: String!) {
    deployments(
      first: 1
      input: { serviceId: $serviceId, environmentId: $environmentId }
    ) {
      edges {
        node {
          id
          status
          createdAt
          url
        }
      }
    }
  }
`;

const DELETE_SERVICE_MUTATION = `
  mutation DeleteService($id: String!) {
    serviceDelete(id: $id)
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
): Promise<OpenClawDeployResult> {
  // 1. Validate token
  await railwayRequest<{ me: RailwayUser }>(token, VALIDATE_TOKEN_QUERY);

  // 2. Fetch workspaceId (required for accounts in organizations)
  let workspaceId: string | undefined;
  try {
    const wsData = await railwayRequest<{ me: { workspaces: Array<{ id: string; name: string }> } }>(
      token,
      LIST_WORKSPACES_QUERY
    );
    workspaceId = wsData.me.workspaces?.[0]?.id;
  } catch {
    // workspaceId is optional for personal accounts
  }

  const projectName = generateResourceName(userId);

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
  } else if (workspaceId) {
    // me.projects may not include workspace projects — search workspace directly
    const wsProjects = await railwayRequest<{
      workspaceProjects: { edges: Array<{ node: RailwayProject }> };
    }>(token, LIST_WORKSPACE_PROJECTS_QUERY, { workspaceId }).catch(() => null);

    const wsProject = wsProjects?.workspaceProjects?.edges.find(e => e.node.name === projectName);
    if (wsProject) {
      projectId = wsProject.node.id;
    } else {
      const newProject = await railwayRequest<{ projectCreate: RailwayProject }>(
        token,
        CREATE_PROJECT_MUTATION,
        { input: { name: projectName, workspaceId } }
      );
      projectId = newProject.projectCreate.id;
    }
  } else {
    const newProject = await railwayRequest<{ projectCreate: RailwayProject }>(
      token,
      CREATE_PROJECT_MUTATION,
      { input: { name: projectName } }
    );
    projectId = newProject.projectCreate.id;
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
  const service = await railwayRequest<{ serviceCreate: RailwayService }>(
    token,
    CREATE_SERVICE_MUTATION,
    {
      input: {
        projectId,
        name: serviceName,
        source: { image: RAILWAY_OPENCLAW_IMAGE },
      }
    }
  );

  const serviceId = service.serviceCreate.id;

  // 5. Configure start command (writes openclaw.json from env var before starting gateway)
  await railwayRequest(
    token,
    UPDATE_SERVICE_INSTANCE_MUTATION,
    {
      serviceId,
      environmentId,
      input: { startCommand: RAILWAY_OPENCLAW_START_COMMAND },
    }
  );

  // 7. Set environment variables
  const envVars = buildRailwayEnvVars(gatewayToken, modelhubApiUrl, modelhubApiKey, {
    ...config,
    serviceUrl: publicUrl ?? "",
    modelhubApiUrl
  });

  const variables: Record<string, string> = {};
  for (const { key, value } of envVars) {
    variables[key] = value;
  }
  await railwayRequest(
    token,
    UPSERT_VARIABLES_MUTATION,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        variables,
      }
    }
  );

  // 8. Trigger deployment
  await railwayRequest(
    token,
    TRIGGER_DEPLOY_MUTATION,
    { input: { environmentId, projectId, serviceId } }
  );

  const deployId = null;
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
    const variables: Record<string, string> = {};
    for (const { key, value } of envVars) {
      variables[key] = value;
    }
    await railwayRequest(token, UPSERT_VARIABLES_MUTATION, {
      input: { projectId, environmentId, serviceId, variables }
    });
  }

  await railwayRequest(
    token,
    TRIGGER_DEPLOY_MUTATION,
    { input: { environmentId, projectId, serviceId } }
  );

  return {
    deployId: null,
    openclaw: buildOpenClawInfo(config)
  };
}

export async function refreshRailwayDeployment(
  token: string,
  compositeServiceId: string,
  deployId: string | null
): Promise<DeploymentRefresh> {
  const [serviceId, , environmentId] = compositeServiceId.split(":");

  try {
    let dep: RailwayDeployment;

    if (deployId) {
      const data = await railwayRequest<{ deployment: RailwayDeployment }>(
        token,
        GET_DEPLOYMENT_QUERY,
        { id: deployId }
      );
      dep = data.deployment;
    } else {
      const data = await railwayRequest<{
        deployments: { edges: Array<{ node: RailwayDeployment }> };
      }>(token, LIST_SERVICE_DEPLOYMENTS_QUERY, { serviceId, environmentId });
      const node = data.deployments.edges[0]?.node;
      if (!node) {
        return { deployId: null, error: null, missing: false, publicUrl: null, status: "provisioning" };
      }
      dep = node;
    }

    const mapped = mapRailwayDeploymentStatus(dep.status);
    return {
      deployId: dep.id,
      error: mapped.error,
      missing: false,
      publicUrl: dep.url || null,
      status: mapped.status,
    };
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) {
      return { deployId, error: null, missing: true, publicUrl: null, status: "failed" };
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
    return generateResourceName(userId);
  },

  isFreeTierError(error: unknown): boolean {
    return isRailwayFreeTierError(error);
  },
};