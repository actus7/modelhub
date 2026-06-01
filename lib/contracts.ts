import { z } from "zod";
import type { ProviderModelCapabilities } from "@/lib/chat-parts";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  isActive?: boolean;
  isAdmin?: boolean;
  createdAt?: string | Date;
  counts?: {
    activeApiKeys: number;
    providerCredentials: number;
    totalRequests: number;
  };
};

type ProviderKeyField = {
  envName: string;
  label: string;
  placeholder: string;
};

type ProviderCategory =
  | "api-provider"
  | "browser-sdk"
  | "gateway"
  | "public-web"
  | "utility";

type ProviderAuthMode = "api-key" | "browser-session" | "none";

export type ProviderRuntime = {
  authMode: ProviderAuthMode;
  externalApi: boolean;
  kind: "client" | "server";
  openAiCompatible: boolean;
  transport:
    | "browser-sdk"
    | "modelhub-proxy"
    | "openai-compatible"
    | "passthrough-proxy";
};

export type UiProvider = {
  id: string;
  label: string;
  base: string;
  category?: ProviderCategory;
  hasModels: boolean;
  localModels?: ProviderModel[];
  requiredEnv?: string;
  requiredKeys?: ProviderKeyField[];
  runtime?: ProviderRuntime;
  signupUrl?: string;
  signupLabel?: string;
};

type UsageProviderStat = {
  provider: string;
  count: number;
};

type UsageModelStat = {
  model: string | null;
  count: number;
};

type UsageStatusStat = {
  status: number;
  count: number;
};

type UsageDailyStat = {
  date: string;
  count: number;
};

export type UsageSummary = {
  period: {
    days: number;
    since: string;
  };
  totalRequests: number;
  errorRate: number;
  byProvider: UsageProviderStat[];
  byModel: UsageModelStat[];
  byStatus: UsageStatusStat[];
  daily: UsageDailyStat[];
};

export type RecentUsageLog = {
  id: string;
  providerId: string | null;
  modelId: string | null;
  endpoint: string | null;
  statusCode: number;
  errorDetail: string | null;
  createdAt: string;
  apiKey: {
    prefix: string;
    label: string;
  } | null;
};

export type ProviderModel = {
  capabilities: ProviderModelCapabilities;
  id: string;
  name: string;
};

export type ProviderCatalogResponse = {
  authRequired: boolean;
  providers: UiProvider[];
};

export type ApiKeySummary = {
  id: string;
  prefix: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt?: string | null;
};

export type ProviderCredentialSummary = {
  id: string;
  providerId: string;
  credentialKey: string;
  createdAt?: string;
  updatedAt: string;
};

export const cloudDeploymentStatusSchema = z.enum([
  "provisioning",
  "healthy",
  "failed",
  "deleting",
]);

type CloudProvider = "render";
export type CloudDeploymentStatus = z.infer<typeof cloudDeploymentStatusSchema>;

export type CloudConnectionSummary = {
  id: string;
  provider: CloudProvider;
  label: string;
  externalUserEmail: string | null;
  externalOrganizationName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpenClawDeploymentSummary = {
  allowedOrigins: string[];
  controlUiUrl: string;
  healthUrl: string;
  model: string;
  modelhubApiUrl: string;
  provider: string;
  readyUrl: string;
  webSocketUrl: string;
};

export type CloudDeploymentSummary = {
  id: string;
  connectionId: string;
  provider: CloudProvider;
  name: string;
  status: CloudDeploymentStatus;
  externalAppName: string;
  externalServiceId: string;
  publicUrl: string | null;
  image: string;
  region: string;
  instanceType: string;
  port: number;
  error: string | null;
  openclaw: OpenClawDeploymentSummary | null;
  createdAt: string;
  updatedAt: string;
};

type ToolStartEvent = {
  type: "tool-start";
  toolCallId: string;
  toolName: string;
  args: unknown;
};

type ToolResultEvent = {
  type: "tool-result";
  toolCallId: string;
  result: unknown;
};

type TextDeltaEvent = {
  type: "text-delta";
  delta: string;
};

export type StreamEvent = ToolStartEvent | ToolResultEvent | TextDeltaEvent;

export const providerCredentialSchema = z.object({
  providerId: z.string().min(1).max(64),
  credentialKey: z.string().min(1).max(128),
  credentialValue: z.string().min(1).max(4096),
});

export const cloudRenderConnectionSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  token: z.string().trim().min(1).max(4096),
});

export const openClawDeploymentConfigSchema = z.object({
  allowedOrigins: z.array(z.string().trim().url()).max(12).optional(),
  model: z.string().trim().min(1).max(200),
  provider: z.string().trim().min(1).max(64),
});

export const apiKeyLabelSchema = z.object({
  label: z.string().max(100).optional(),
});

/** ID do modelo que efetivamente gerou a resposta (pode diferir do selecionado se houve fallback). */
export const MODELHUB_EFFECTIVE_MODEL_HEADER = "x-modelhub-effective-model" as const;

/** ID do modelo que o usuário pediu na requisição. */
export const MODELHUB_REQUESTED_MODEL_HEADER = "x-modelhub-requested-model" as const;

/** Presente e igual a `"true"` somente quando houve troca de modelo após falha (ex. `model_not_found`). */
export const MODELHUB_MODEL_FALLBACK_USED_HEADER = "x-modelhub-model-fallback-used" as const;

/** Lista dos IDs tentados na ordem, separados por vírgula (inclui o que respondeu com sucesso). */
export const MODELHUB_MODELS_ATTEMPTED_HEADER = "x-modelhub-models-attempted" as const;

/**
 * Base64url(JSON) com falhas upstream antes de um 200 por fallback — para persistir em UsageLog.errorDetail.
 */
export const MODELHUB_FALLBACK_DIAGNOSTIC_HEADER = "x-modelhub-fallback-diagnostic" as const;
