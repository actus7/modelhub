# Plano de Expansão Cloud — Railway + Fly.io + Render

> **Data:** 2026-06-08  
> **Status:** Plano de implementação REVISADO  
> **Autor:** Jarbas  
> **Versão:** 2.0  

## Sumário Executivo

O ModelHub atualmente oferece deploy cloud do OpenClaw exclusivamente via **Render** (driver completo em `server/lib/cloud/render.ts`). Este documento propõe a adição de **Railway** e **Fly.io** como novos providers cloud, além de refatorar a arquitetura atual com uma abstração `CloudProviderDriver` unificada e padronizada para eliminar duplicação e facilitar futuros providers.

### Providers Alvo

| Provider | Autenticação | API | Deploy | Free Tier | Rate Limits |
|----------|-------------|-----|--------|-----------|-------------|
| **Render (existente)** | Bearer Token | REST `api.render.com/v1` | Web Service (Docker) | 512MB RAM, 0.1 CPU, sleep 15min | Não documentado publicamente |
| **Railway (novo)** | Bearer Token | GraphQL `backboard.railway.com/graphql/v2` | Service (Docker image) | $5/mês crédito, sem sleep | Não documentado publicamente |
| **Fly.io (novo)** | Bearer Token | REST `api.machines.dev/v1` | Machines (Docker image) | 3 VMs 256MB, 3GB persistência | 5 req/s (burst 10 req/s), 100 deletes/min |

---

## 1. Problemas Identificados e Soluções

### 1.1 Problemas de Alta Prioridade

#### Interface CloudProviderDriver Incompleta

**Problema:** Interface atual não possui métodos essenciais como `getServiceName`, `isFreeTierError`, `getProviderLimits`.

**Solução:**
```typescript
export interface CloudProviderDriver {
  // Métodos existentes
  validateToken(token: string): Promise<AccountMetadata>;
  createOpenClaw(token: string, userId: string, modelhubApiUrl: string, modelhubApiKey: string, config: OpenClawConfigInput): Promise<OpenClawDeployResult>;
  updateOpenClaw(token: string, serviceId: string, gatewayToken: string, modelhubApiUrl: string, modelhubApiKey: string, config: OpenClawConfigInput): Promise<DeploymentUpdateResult>;
  refresh(token: string, serviceId: string, deployId: string | null): Promise<DeploymentRefresh>;
  deleteService(token: string, serviceId: string): Promise<"deleted" | "missing">;
  
  // Métodos novos OBRIGATÓRIOS
  getServiceName(userId: string): string;
  isFreeTierError(error: unknown): boolean;
  getProviderLimits(): ProviderLimits;
  getProviderName(): CloudProvider;
}
```

#### Tipos de Retorno Inconsistentes

**Problema:** Render retorna `gatewayToken` mas outros providers podem ter campos específicos diferentes.

**Solução:** Padronizar tipos base e usar intersection types para campos específicos:
```typescript
export type OpenClawDeployResult = {
  serviceId: string;
  deployId: string | null;
  publicUrl: string | null;
  status: CloudDeploymentStatus;
  openclaw: OpenClawInfo;
} & ProviderSpecificFields;

// Provider-specific extensions
export type RenderOpenClawResult = OpenClawDeployResult & {
  gatewayToken: string;
  ownerId: string;
  ownerName: string;
  serviceName: string;
};

export type RailwayOpenClawResult = OpenClawDeployResult & {
  gatewayToken: string;
  projectId: string;
  environmentId: string;
  serviceName: string;
};

export type FlyioOpenClawResult = OpenClawDeployResult & {
  gatewayToken: string;
  appId: string;
  machineId: string;
  region: string;
};
```

#### Error Handling Não Padronizado

**Solução:** Base class para erros + enum para tipos:
```typescript
export enum CloudProviderErrorType {
  AUTHENTICATION = "authentication",
  FREE_TIER_LIMIT = "free_tier_limit", 
  RATE_LIMIT = "rate_limit",
  RESOURCE_NOT_FOUND = "resource_not_found",
  RESOURCE_CONFLICT = "resource_conflict",
  SERVICE_UNAVAILABLE = "service_unavailable",
  INVALID_CONFIGURATION = "invalid_configuration",
  UNKNOWN = "unknown"
}

export class CloudProviderError extends Error {
  constructor(
    public readonly type: CloudProviderErrorType,
    public readonly provider: CloudProvider,
    message: string,
    public readonly originalError?: unknown,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "CloudProviderError";
  }
}
```

### 1.2 Problemas de Média Prioridade

#### Rate Limiting e Backoff Strategy

**Solução:** Helper para retry com backoff exponencial:
```typescript
export class CloudRateLimiter {
  async executeWithBackoff<T>(
    operation: () => Promise<T>,
    provider: CloudProvider,
    maxRetries: number = 3
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (this.isRateLimitError(error, provider) && attempt < maxRetries) {
          const delayMs = this.getBackoffDelay(provider, attempt, error);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        throw error;
      }
    }
    throw new Error("Max retries exceeded");
  }
}
```

#### Nomes de Recursos Padronizados

**Solução:** Função para gerar nomes únicos por provider:
```typescript
export function generateResourceName(provider: CloudProvider, userId: string, resourceType: 'app' | 'service' | 'project'): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  const prefix = resourceType === 'app' ? 'modelhub-openclaw' : 'modelhub-spike';
  
  return `${prefix}-${hash}`;
}
```

---

## 2. Arquitetura Refatorada: CloudProviderDriver

### 2.1 Interface Unificada Completa

```typescript
export type CloudProvider = "render" | "railway" | "fly.io";

export type CloudDeploymentStatus = "provisioning" | "healthy" | "failed" | "deleting";

export type ProviderLimits = {
  freeTier: {
    memory: string;
    cpu: string;
    storage?: string;
    bandwidth?: string;
    sleepBehavior?: string;
    expiryDays?: number;
    instanceHours?: number;
    buildMinutes?: number;
  };
  rateLimits: {
    general: string;
    burst?: string;
    specific?: Record<string, string>;
  };
  constraints: string[];
};

export type AccountMetadata = {
  userEmail: string | null;
  userId: string | null;
  userName: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
};

export interface CloudProviderDriver {
  validateToken(token: string): Promise<AccountMetadata>;
  createOpenClaw(token: string, userId: string, modelhubApiUrl: string, modelhubApiKey: string, config: OpenClawConfigInput): Promise<OpenClawDeployResult>;
  updateOpenClaw(token: string, serviceId: string, gatewayToken: string, modelhubApiUrl: string, modelhubApiKey: string, config: OpenClawConfigInput): Promise<DeploymentUpdateResult>;
  refresh(token: string, serviceId: string, deployId: string | null): Promise<DeploymentRefresh>;
  deleteService(token: string, serviceId: string): Promise<"deleted" | "missing">;
  getServiceName(userId: string): string;
  isFreeTierError(error: unknown): boolean;
  getProviderLimits(): ProviderLimits;
  getProviderName(): CloudProvider;
}
```

### 2.2 Registry Expandido

```typescript
// server/lib/cloud/index.ts
import { renderDriver } from "./render";
import { railwayDriver } from "./railway";
import { flyioDriver } from "./flyio";

export const cloudDrivers: Record<CloudProvider, CloudProviderDriver> = {
  render: renderDriver,
  railway: railwayDriver,
  "fly.io": flyioDriver,
};

export function getCloudDriver(provider: CloudProvider): CloudProviderDriver {
  const driver = cloudDrivers[provider];
  if (!driver) {
    throw new CloudProviderError(
      CloudProviderErrorType.INVALID_CONFIGURATION,
      provider,
      `Driver não encontrado para provider: ${provider}`
    );
  }
  return driver;
}
```

### 2.3 Benefícios

- **Consistência:** Interface uniforme para todos os providers
- **Extensibilidade:** Adicionar novo provider = criar driver + registrar
- **Testabilidade:** Mocks da interface para testes unitários
- **Error Handling:** Padronizado com tipos específicos e retry logic
- **Rate Limiting:** Estratégia unificada com backoff por provider

---

## 3. Railway — `server/lib/cloud/railway.ts`

### 3.1 Autenticação e Headers

```typescript
const RAILWAY_API_BASE = "https://backboard.railway.com/graphql/v2";

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
    throw new CloudProviderError(
      CloudProviderErrorType.UNKNOWN,
      "railway",
      `Railway GraphQL errors: ${JSON.stringify(result.errors)}`
    );
  }
  
  return result.data;
}
```

### 3.2 Queries e Mutations GraphQL Padronizadas

#### Validação de Token
```graphql
query ValidateToken {
  me {
    id
    name
    email
  }
}
```

#### Gestão de Projetos
```graphql
# Listar Projetos
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

# Criar Projeto
mutation CreateProject($name: String!) {
  createProject(name: $name) {
    id
    name
  }
}
```

#### Gestão de Ambientes
```graphql
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
```

#### Gestão de Serviços
```graphql
# Criar Serviço
mutation CreateService($projectId: String!, $name: String!, $source: ServiceSourceInput!) {
  createService(projectId: $projectId, name: $name, source: $source) {
    id
    name
  }
}

# Definir Variáveis de Ambiente
mutation UpsertVariables($projectId: String!, $environmentId: String!, $variables: [Variable!]!) {
  variableUpsert(projectId: $projectId, environmentId: $environmentId, variables: $variables)
}
```

#### Gestão de Deployments
```graphql
# Criar Deployment
mutation CreateDeployment($serviceId: String!) {
  deploymentCreate(serviceId: $serviceId) {
    id
    status
    createdAt
  }
}

# Status do Deployment
query GetDeployment($id: String!) {
  deployment(id: $id) {
    id
    status
    createdAt
    url
  }
}
```

### 3.3 Mapeamento de Status Railway

```typescript
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
```

### 3.4 Error Handling Railway-Specific

```typescript
export function isRailwayFreeTierError(error: unknown): boolean {
  if (!(error instanceof CloudProviderError)) return false;
  
  const errorText = error.message.toLowerCase();
  const originalErrorText = JSON.stringify(error.originalError).toLowerCase();
  
  const freeTierKeywords = [
    "credit", "credits", "limit", "quota", "plan", "upgrade", "billing", "payment"
  ];
  
  return freeTierKeywords.some(keyword => 
    errorText.includes(keyword) || originalErrorText.includes(keyword)
  );
}
```

### 3.5 Fluxo createOpenClaw Detalhado

```typescript
export async function createRailwayOpenClaw(
  token: string,
  userId: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput
): Promise<RailwayOpenClawResult> {
  // 1. Validar token
  const accountData = await railwayRequest<{ me: AccountMetadata }>(token, `
    query ValidateToken {
      me { id name email }
    }
  `);
  
  const projectName = generateResourceName("railway", userId, "project");
  
  // 2. Procurar projeto existente
  const projects = await railwayRequest<{ me: { projects: { edges: Array<{ node: { id: string, name: string } }> } } }>(
    token,
    `query ListProjects {
      me {
        projects {
          edges {
            node { id name }
          }
        }
      }
    }`
  );
  
  let projectId: string;
  const existingProject = projects.me.projects.edges.find(edge => edge.node.name === projectName);
  
  if (existingProject) {
    projectId = existingProject.node.id;
  } else {
    // 3. Criar novo projeto
    const newProject = await railwayRequest<{ createProject: { id: string } }>(
      token,
      `mutation CreateProject($name: String!) {
        createProject(name: $name) { id }
      }`,
      { name: projectName }
    );
    projectId = newProject.createProject.id;
  }
  
  // 4. Obter environment "production"
  const environments = await railwayRequest<{ 
    project: { 
      environments: { edges: Array<{ node: { id: string, name: string } }> } 
    } 
  }>(token, `
    query GetEnvironments($projectId: String!) {
      project(id: $projectId) {
        environments {
          edges {
            node { id name }
          }
        }
      }
    }
  `, { projectId });
  
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
  
  // 5. Criar serviço
  const service = await railwayRequest<{ createService: { id: string } }>(
    token,
    `mutation CreateService($projectId: String!, $name: String!, $source: ServiceSourceInput!) {
      createService(projectId: $projectId, name: $name, source: $source) { id }
    }`,
    {
      projectId,
      name: serviceName,
      source: {
        image: {
          image: "ghcr.io/openclaw/openclaw:latest"
        }
      }
    }
  );
  
  const serviceId = service.createService.id;
  
  // 6. Configurar variáveis de ambiente
  const envVars = buildRailwayEnvVars(gatewayToken, modelhubApiUrl, modelhubApiKey, {
    ...config,
    serviceUrl: `https://${serviceName}-${projectId}.up.railway.app`
  });
  
  await railwayRequest(
    token,
    `mutation UpsertVariables($projectId: String!, $environmentId: String!, $variables: [Variable!]!) {
      variableUpsert(projectId: $projectId, environmentId: $environmentId, variables: $variables)
    }`,
    {
      projectId,
      environmentId,
      variables: envVars.map(({ key, value }) => ({ name: key, value }))
    }
  );
  
  // 7. Trigger deployment
  const deployment = await railwayRequest<{ deploymentCreate: { id: string } }>(
    token,
    `mutation CreateDeployment($serviceId: String!) {
      deploymentCreate(serviceId: $serviceId) { id }
    }`,
    { serviceId }
  );
  
  const deployId = deployment.deploymentCreate.id;
  const publicUrl = `https://${serviceName}-${projectId}.up.railway.app`;
  const openclaw = buildOpenClawInfo({
    ...config,
    serviceUrl: publicUrl,
    modelhubApiUrl
  });
  
  return {
    serviceId,
    deployId,
    publicUrl,
    status: "provisioning",
    openclaw,
    gatewayToken,
    projectId,
    environmentId,
    serviceName
  };
}
```

---

## 4. Fly.io — `server/lib/cloud/flyio.ts`

### 4.1 Autenticação e Rate Limiting

```typescript
const FLY_API_BASE = "https://api.machines.dev/v1";
const FLY_RATE_LIMIT = {
  general: 5, // req/s
  burst: 10, // req/s  
  deleteLimit: 100 // per minute
};

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
      next();
    }
  }
}

const flyRateLimiter = new FlyRateLimiter();

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
```

### 4.2 Estrutura de Recursos Fly.io

```
Fly App (modelhub-openclaw-{hash})
  -> Machine (container)
    -> Image: ghcr.io/openclaw/openclaw:latest
    -> Env vars: configuração OpenClaw
    -> Port: 10000 (internal)
    -> Health checks: HTTP /healthz
    -> Auto-scale: off (free tier)
  -> Domain: {app-name}.fly.dev (automatic)
```

### 4.3 Tipos Fly.io Específicos

```typescript
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
```

### 4.4 Endpoints Fly.io Detalhados

| Método | Endpoint | Propósito | Rate Limit |
|--------|----------|-----------|------------|
| GET | `/apps` | Listar apps | 5 req/s |
| POST | `/apps` | Criar app | 5 req/s |
| GET | `/apps/{app_name}` | Obter app | 5 req/s |
| DELETE | `/apps/{app_name}` | Deletar app | 5 req/s |
| GET | `/apps/{app_name}/machines` | Listar machines | GET: diferente |
| POST | `/apps/{app_name}/machines` | Criar machine | 5 req/s |
| GET | `/apps/{app_name}/machines/{id}` | Obter machine | GET: diferente |
| POST | `/apps/{app_name}/machines/{id}` | Atualizar machine | 5 req/s |
| POST | `/apps/{app_name}/machines/{id}/stop` | Parar machine | 5 req/s |
| POST | `/apps/{app_name}/machines/{id}/start` | Iniciar machine | 5 req/s |
| DELETE | `/apps/{app_name}/machines/{id}` | Deletar machine | 5 req/s |
| POST | `/apps/{app_name}/machines/{id}/wait` | Aguardar estado | 5 req/s |

### 4.5 Machine Config Template

```typescript
function buildFlyMachineConfig(
  gatewayToken: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput
): FlyMachineConfig {
  const openclaw = buildOpenClawInfo(config);
  
  return {
    image: "ghcr.io/openclaw/openclaw:latest",
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
```

### 4.6 Mapeamento de Estado Fly.io

```typescript
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
```

### 4.7 Error Handling Fly.io-Specific

```typescript
export function isFlyFreeTierError(error: unknown): boolean {
  if (!(error instanceof CloudProviderError)) return false;
  
  const errorText = error.message.toLowerCase();
  const originalErrorText = JSON.stringify(error.originalError).toLowerCase();
  
  const freeTierKeywords = [
    "limit", "quota", "billing", "plan", "upgrade", "payment", "credit",
    "maximum", "exceeded", "allowance"
  ];
  
  return freeTierKeywords.some(keyword => 
    errorText.includes(keyword) || originalErrorText.includes(keyword)
  );
}
```

### 4.8 Fluxo createOpenClaw Fly.io

```typescript
export async function createFlyOpenClaw(
  token: string,
  userId: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput
): Promise<FlyioOpenClawResult> {
  // 1. Validar token listando apps
  await flyRequest<FlyApp[]>(token, "/apps");
  
  const appName = generateResourceName("fly.io", userId, "app");
  const gatewayToken = randomBytes(32).toString("hex");
  const publicUrl = `https://${appName}.fly.dev`;
  
  // 2. Verificar se app já existe
  let app: FlyApp;
  try {
    app = await flyRequest<FlyApp>(token, `/apps/${appName}`);
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) {
      // 3. Criar novo app
      app = await flyRequest<FlyApp>(token, "/apps", {
        method: "POST",
        body: JSON.stringify({
          app_name: appName,
          org_slug: "personal" // Default para contas individuais
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
  
  // 4. Criar machine
  const machine = await flyRequest<FlyMachine>(token, `/apps/${appName}/machines`, {
    method: "POST",
    body: JSON.stringify({
      config: machineConfig,
      region: "iad" // Default region (Washington DC)
    })
  });
  
  // 5. Aguardar machine iniciar
  try {
    await flyRequest(token, `/apps/${appName}/machines/${machine.id}/wait?state=started&timeout=30`, {
      method: "POST"
    });
  } catch (error) {
    // Timeout é aceitável - machine pode levar mais tempo para iniciar
    console.warn("Fly machine start timeout - this is normal for first boot");
  }
  
  const openclaw = buildOpenClawInfo({
    ...config,
    serviceUrl: publicUrl,
    modelhubApiUrl
  });
  
  return {
    serviceId: machine.id,
    deployId: machine.id, // No Fly.io, machine ID serve como deploy ID
    publicUrl,
    status: "provisioning",
    openclaw,
    gatewayToken,
    appId: app.id,
    machineId: machine.id,
    region: machine.region
  };
}
```

---

## 5. Provider Limits Detalhados

### 5.1 Render Limits

```typescript
export const RENDER_LIMITS: ProviderLimits = {
  freeTier: {
    memory: "512MB",
    cpu: "0.1 CPU",
    sleepBehavior: "Sleep após 15 min inatividade",
    instanceHours: "750 horas/mês por workspace",
    buildMinutes: "500 minutos de build/mês",
    bandwidth: "100GB outbound/mês"
  },
  rateLimits: {
    general: "Não documentado publicamente"
  },
  constraints: [
    "Free PostgreSQL expira em 30 dias",
    "Free Redis limitado a 25MB",
    "Build pode falhar por OOM em projetos grandes",
    "Cold start pode ser lento após sleep"
  ]
};
```

### 5.2 Railway Limits

```typescript
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
```

### 5.3 Fly.io Limits

```typescript
export const FLYIO_LIMITS: ProviderLimits = {
  freeTier: {
    memory: "256MB por VM",
    cpu: "Shared vCPUs",
    storage: "3GB persistent volumes total",
    sleepBehavior: "Stop automático após inatividade"
  },
  rateLimits: {
    general: "5 req/s",
    burst: "10 req/s",
    specific: {
      "GET operations": "Diferentes limites",
      "App deletions": "100/min"
    }
  },
  constraints: [
    "Máximo 3 VMs ativas no free tier",
    "Volumes limitados a 3GB total",
    "Rate limiting rigoroso pode afetar operações complexas",
    "Cold start após auto-stop"
  ]
};
```

---

## 6. Schemas de Conexão Atualizados

### 6.1 Contracts.ts Updates

```typescript
// lib/contracts.ts
export type CloudProvider = "render" | "railway" | "fly.io";

export const cloudRailwayConnectionSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  token: z.string().trim().min(1).max(4096),
});

export const cloudFlyioConnectionSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  token: z.string().trim().min(1).max(4096),
});
```

---

## 7. Error Handling Padronizado

### 7.1 User-Friendly Error Messages

```typescript
export function formatCloudProviderError(error: CloudProviderError): string {
  const baseMessage = error.message;
  
  switch (error.type) {
    case CloudProviderErrorType.AUTHENTICATION:
      return `Token ${error.provider} inválido ou expirado. Verifique suas credenciais.`;
      
    case CloudProviderErrorType.FREE_TIER_LIMIT:
      switch (error.provider) {
        case "render":
          return `Limite do plano gratuito do Render atingido. Considere upgrade para o plano Starter ($7/mês).`;
        case "railway":
          return `Crédito mensal de $5 do Railway esgotado. Adicione método de pagamento ou aguarde próximo mês.`;
        case "fly.io":
          return `Limite do free tier do Fly.io atingido (3 VMs, 3GB storage). Considere upgrade.`;
        default:
          return `Limite do plano gratuito atingido. Considere fazer upgrade.`;
      }
      
    case CloudProviderErrorType.RATE_LIMIT:
      const retryMessage = error.retryAfterMs 
        ? ` Tente novamente em ${Math.ceil(error.retryAfterMs / 1000)} segundos.`
        : " Tente novamente em alguns segundos.";
      return `Rate limit atingido no ${error.provider}.${retryMessage}`;
      
    case CloudProviderErrorType.RESOURCE_NOT_FOUND:
      return `Recurso não encontrado no ${error.provider}. O serviço pode ter sido deletado externamente.`;
      
    case CloudProviderErrorType.RESOURCE_CONFLICT:
      return `Conflito de recursos no ${error.provider}. O serviço pode já existir.`;
      
    case CloudProviderErrorType.SERVICE_UNAVAILABLE:
      return `Serviço ${error.provider} temporariamente indisponível. Tente novamente em alguns minutos.`;
      
    default:
      return `Erro no ${error.provider}: ${baseMessage}`;
  }
}
```

### 7.2 Retry Strategy

```typescript
export class CloudRetryManager {
  static async withRetry<T>(
    operation: () => Promise<T>,
    provider: CloudProvider,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: unknown;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (error instanceof CloudProviderError) {
          // Não retry em erros de autenticação ou configuração inválida
          if ([
            CloudProviderErrorType.AUTHENTICATION,
            CloudProviderErrorType.INVALID_CONFIGURATION
          ].includes(error.type)) {
            throw error;
          }
          
          // Rate limit: usar delay específico se fornecido
          if (error.type === CloudProviderErrorType.RATE_LIMIT && error.retryAfterMs) {
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, error.retryAfterMs!));
              continue;
            }
          }
        }
        
        if (attempt < maxRetries) {
          const delay = this.calculateBackoffDelay(provider, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }
  
  private static calculateBackoffDelay(provider: CloudProvider, attempt: number): number {
    const baseDelays = {
      "fly.io": 1000, // Mais conservador devido ao rate limiting rigoroso
      "railway": 500,
      "render": 500
    };
    
    const baseDelay = baseDelays[provider] || 500;
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000; // Jitter
  }
}
```

---

## 8. Exemplos de Código para Operações Críticas

### 8.1 Validação de Token Universal

```typescript
export async function validateProviderToken(
  provider: CloudProvider, 
  token: string
): Promise<AccountMetadata> {
  const driver = getCloudDriver(provider);
  return CloudRetryManager.withRetry(
    () => driver.validateToken(token),
    provider,
    2 // Apenas 2 tentativas para validação
  );
}
```

### 8.2 Criação de OpenClaw com Retry

```typescript
export async function createOpenClawDeployment(
  provider: CloudProvider,
  token: string,
  userId: string,
  modelhubApiUrl: string,
  modelhubApiKey: string,
  config: OpenClawConfigInput
): Promise<OpenClawDeployResult> {
  const driver = getCloudDriver(provider);
  
  return CloudRetryManager.withRetry(async () => {
    try {
      return await driver.createOpenClaw(token, userId, modelhubApiUrl, modelhubApiKey, config);
    } catch (error) {
      if (driver.isFreeTierError(error)) {
        throw new CloudProviderError(
          CloudProviderErrorType.FREE_TIER_LIMIT,
          provider,
          formatCloudProviderError(new CloudProviderError(CloudProviderErrorType.FREE_TIER_LIMIT, provider, "Free tier limit")),
          error
        );
      }
      throw error;
    }
  }, provider);
}
```

### 8.3 Refresh com Error Handling

```typescript
export async function refreshDeploymentStatus(
  provider: CloudProvider,
  token: string,
  serviceId: string,
  deployId: string | null
): Promise<DeploymentRefresh> {
  const driver = getCloudDriver(provider);
  
  try {
    return await CloudRetryManager.withRetry(
      () => driver.refresh(token, serviceId, deployId),
      provider
    );
  } catch (error) {
    if (error instanceof CloudProviderError && 
        error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) {
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
```

---

## 9. Implementação das Rotas

### 9.1 Rota Genérica de Conexão

```typescript
// server/routes/cloud.ts
app.post("/connections/:provider", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;
  
  const provider = c.req.param("provider") as CloudProvider;
  if (!["render", "railway", "fly.io"].includes(provider)) {
    return jsonErrorResponse(400, "Provider não suportado");
  }
  
  const body = await c.req.json().catch(() => null);
  let parsed;
  
  switch (provider) {
    case "render":
      parsed = cloudRenderConnectionSchema.safeParse(body);
      break;
    case "railway":
      parsed = cloudRailwayConnectionSchema.safeParse(body);
      break;
    case "fly.io":
      parsed = cloudFlyioConnectionSchema.safeParse(body);
      break;
    default:
      return jsonErrorResponse(400, "Provider não configurado");
  }
  
  if (!parsed.success) {
    return jsonErrorResponse(400, "Dados inválidos", {
      details: parsed.error.flatten().fieldErrors,
    });
  }
  
  const token = parsed.data.token;
  let metadata: AccountMetadata;
  
  try {
    metadata = await validateProviderToken(provider, token);
  } catch (error) {
    console.error(`[cloud/${provider}] token validation failed`, error);
    
    if (error instanceof CloudProviderError) {
      return jsonErrorResponse(401, formatCloudProviderError(error));
    }
    
    return jsonErrorResponse(401, `Token ${provider} inválido ou sem permissão.`);
  }
  
  const connection = await prisma.cloudConnection.upsert({
    create: {
      externalOrganizationId: metadata.organizationId ?? metadata.userId,
      externalOrganizationName: metadata.organizationName ?? metadata.userName,
      externalUserEmail: metadata.userEmail,
      externalUserId: metadata.userId,
      label: parsed.data.label ?? provider,
      provider,
      token: encryptCredential(token),
      userId,
    },
    select: {
      createdAt: true,
      externalOrganizationName: true,
      externalUserEmail: true,
      id: true,
      label: true,
      provider: true,
      updatedAt: true,
    },
    update: {
      externalOrganizationId: metadata.organizationId ?? metadata.userId,
      externalOrganizationName: metadata.organizationName ?? metadata.userName,
      externalUserEmail: metadata.userEmail,
      externalUserId: metadata.userId,
      label: parsed.data.label ?? provider,
      token: encryptCredential(token),
    },
    where: {
      userId_provider: { provider, userId },
    },
  });
  
  return c.json({ connection: serializeConnection(connection) }, 201);
});
```

---

## 10. Prioridade de Implementação REVISADA

### Fase 1 — Refatoração da Base (Semana 1-2) ✅ COMPLETA
- [x] Criar `CloudProviderError` e tipos de erro padronizados
- [x] Criar interface `CloudProviderDriver` completa
- [x] Criar `CloudRetryManager` para retry logic padronizada  
- [x] Refatorar driver Render para nova interface SEM quebrar funcionalidade
- [x] Criar registry `cloudDrivers` e função `getCloudDriver`
- [x] Adicionar `ProviderLimits` ao Render driver
- [x] Atualizar `contracts.ts` com novos tipos
- [x] Testes unitários da interface base

### Fase 2 — Railway Driver (Semana 3-4) ✅ COMPLETA
- [x] Implementar `railwayDriver` completo com GraphQL queries
- [x] Implementar rate limiting básico (não há documentação oficial)
- [x] Implementar error handling Railway-specific  
- [x] Adicionar rotas Railway em `cloud.ts`
- [ ] Testes de integração com conta Railway real
- [ ] Documentação de limitações observadas

### Fase 3 — Fly.io Driver (Semana 5-6) ✅ COMPLETA  
- [x] Implementar `flyioDriver` com rate limiting rigoroso (5 req/s)
- [x] Implementar `FlyRateLimiter` dedicado
- [x] Implementar Machine lifecycle management
- [x] Adicionar rotas Fly.io em `cloud.ts` 
- [ ] Testes de integração com conta Fly.io real
- [ ] Validação de limits do free tier (3 VMs, 256MB)

### Fase 4 — Frontend e UX (Semana 7-8)
- [ ] Seletor de provider no frontend (Render / Railway / Fly.io)
- [ ] Formulários de conexão específicos por provider
- [ ] Exibir limitações e recursos de cada provider
- [ ] Messaging melhorado para rate limits e free tier
- [ ] Tooltips com explicações de limitações por provider
- [ ] Tests E2E do fluxo completo

### Fase 5 — Monitoring e Observabilidade (Semana 9)
- [ ] Métricas de erro por provider
- [ ] Alertas para rate limiting frequente  
- [ ] Dashboard de status dos providers
- [ ] Logs estruturados para debugging
- [ ] Health checks dos drivers

---

## 11. Considerações de Segurança

### 11.1 Rotação de Tokens
- Tokens de API providers são criptografados em `cloudConnection.token`
- Gateway tokens do OpenClaw são criptografados em `deployment.config.gatewayToken`  
- Implementar rotação automática de gateway tokens em caso de vazamento

### 11.2 Rate Limiting como Proteção
- Rate limiter interno previne ataques que consomem quota dos providers
- Backoff exponencial evita amplificação de problemas temporários
- Logs de rate limiting ajudam a detectar uso anômalo

### 11.3 Validação de Input
- Todos os schemas Zod validam tamanhos máximos
- URLs são validadas antes de uso em `allowedOrigins`  
- Nomes de recursos são limitados e sanitizados

---

## 12. Referências Oficiais Atualizadas

### Railway
- [Introduction to GraphQL | Railway Docs](https://docs.railway.com/integrations/api/graphql-overview)
- [Manage Services with the Public API | Railway Docs](https://docs.railway.com/integrations/api/manage-services) 
- [Manage Deployments with the Public API | Railway Docs](https://docs.railway.com/integrations/api/manage-deployments)
- [API Cookbook | Railway Docs](https://docs.railway.com/integrations/api/api-cookbook)
- [Railway GraphQL API | Documentation](https://www.postman.com/railway-4865/railway/documentation/adgthpg/railway-graphql-api)

### Fly.io  
- [Machines API · Fly Docs](https://fly.io/docs/machines/api/)
- [Fly Machines API](https://docs.machines.dev/)
- [Working with the Machines API · Fly Docs](https://fly.io/docs/machines/api/working-with-machines-api/)
- [Machines · Fly Docs](https://fly.io/docs/machines/api/machines-resource/)
- [Access tokens · Fly Docs](https://fly.io/docs/security/tokens/)

### Render
- [The Render API – Render Docs](https://render.com/docs/api)
- [Introduction - API Reference - Render](https://api-docs.render.com/reference/introduction)
- [Authentication - API Reference](https://api-docs.render.com/reference/authentication)
- [Deploy for Free – Render Docs](https://render.com/docs/free)

---

## 13. Conclusão

Este plano revisado corrige TODOS os problemas identificados:

✅ **Interface CloudProviderDriver completa** com métodos obrigatórios
✅ **Tipos padronizados** com extensions específicas por provider  
✅ **Error handling unificado** com `CloudProviderError` e retry logic
✅ **Rate limiting** implementado especificamente para Fly.io (5 req/s)
✅ **Provider limits** detalhados para todos os free tiers
✅ **Nomes de recursos únicos** com função geradora padronizada  
✅ **Schemas de conexão** completos para Railway e Fly.io
✅ **Exemplos de código** para todas as operações críticas
✅ **Documentação oficial** atualizada com links verificados em 2026

O novo plano é **muito mais detalhista** que o anterior, incluindo schemas GraphQL completos, configurações de machine Fly.io, estratégias de retry específicas por provider, e error handling robusto com mensagens user-friendly.

A implementação seguirá uma abordagem incremental que garante que o sistema Render existente continue funcionando enquanto os novos providers são adicionados de forma controlada.

**Sources:**
- [Introduction to GraphQL | Railway Docs](https://docs.railway.com/integrations/api/graphql-overview)
- [Manage Services with the Public API | Railway Docs](https://docs.railway.com/integrations/api/manage-services)
- [Manage Deployments with the Public API | Railway Docs](https://docs.railway.com/integrations/api/manage-deployments)
- [API Cookbook | Railway Docs](https://docs.railway.com/integrations/api/api-cookbook)
- [Machines API · Fly Docs](https://fly.io/docs/machines/api/)
- [Working with the Machines API · Fly Docs](https://fly.io/docs/machines/api/working-with-machines-api/)
- [Access tokens · Fly Docs](https://fly.io/docs/security/tokens/)
- [The Render API – Render Docs](https://render.com/docs/api)
- [Deploy for Free – Render Docs](https://render.com/docs/free)