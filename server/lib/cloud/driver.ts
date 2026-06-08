import { createHash } from "node:crypto";

import type { CloudDeploymentStatus } from "@/lib/contracts";

export type CloudProvider = "render" | "railway" | "fly.io";

export type AccountMetadata = {
  userEmail: string | null;
  userId: string | null;
  userName: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
};

export type OpenClawConfigInput = {
  allowedOrigins?: string[];
  model: string;
  modelhubApiUrl: string;
  provider: string;
  serviceUrl: string;
};

export type OpenClawInfo = {
  allowedOrigins: string[];
  controlUiUrl: string;
  healthUrl: string;
  model: string;
  modelhubApiUrl: string;
  provider: string;
  readyUrl: string;
  webSocketUrl: string;
};

export type OpenClawDeployResult = {
  serviceId: string;
  deployId: string | null;
  gatewayToken: string;
  publicUrl: string | null;
  status: CloudDeploymentStatus;
  openclaw: OpenClawInfo;
};

export type DeploymentUpdateResult = {
  deployId: string | null;
  openclaw: OpenClawInfo;
};

export type DeploymentRefresh = {
  deployId: string | null;
  error: string | null;
  missing: boolean;
  publicUrl: string | null;
  status: CloudDeploymentStatus;
};

// Error types for unified error handling
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

// Unified cloud provider driver interface
export interface CloudProviderDriver {
  // Core operations
  validateToken(token: string): Promise<AccountMetadata>;
  createOpenClaw(token: string, userId: string, modelhubApiUrl: string, modelhubApiKey: string, config: OpenClawConfigInput): Promise<OpenClawDeployResult>;
  updateOpenClaw(token: string, serviceId: string, gatewayToken: string, modelhubApiUrl: string, modelhubApiKey: string, config: OpenClawConfigInput): Promise<DeploymentUpdateResult>;
  refresh(token: string, serviceId: string, deployId: string | null): Promise<DeploymentRefresh>;
  deleteService(token: string, serviceId: string): Promise<"deleted" | "missing">;

  // Provider-specific metadata
  getServiceName(userId: string): string;
  isFreeTierError(error: unknown): boolean;
}

// Utility functions
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

export function generateResourceName(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `modelhub-openclaw-${hash}`;
}