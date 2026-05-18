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

export type UiProvider = {
  id: string;
  label: string;
  base: string;
  hasModels: boolean;
  requiredEnv?: string;
  requiredKeys?: ProviderKeyField[];
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
