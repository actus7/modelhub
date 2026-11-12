/**
 * App Hono de um provedor (`/{provider}/api/*`): autenticação, credenciais,
 * orçamento, validação do corpo e registro de uso em volta de `config.chat`.
 */

import { Hono } from "hono";

import {
  MODELHUB_CONVERSATION_HEADER,
  MODELHUB_MESSAGE_HEADER,
  MODELHUB_PROJECT_HEADER,
} from "@/lib/contracts";

import { checkBudget } from "./budget";
import { decryptCredential } from "./crypto";
import { prisma } from "./db";
import { handleApiError, jsonErrorResponse } from "./http";
import { logger } from "./logger";
import { fetchCachedProviderModels, type ProviderConfig } from "./provider-config";
import {
  AttachmentCapabilityError,
  MAX_PROVIDER_REQUEST_BODY_BYTES,
  getModelCapabilities,
  normalizeMessages,
  providerChatBodySchema,
  requestUsesTools,
  resolveMessagesForProvider,
} from "./provider-messages";
import {
  MAX_USAGE_LOG_ERROR_CHARS,
  logUsage,
  resolveUsageCorrelation,
  updateUsageLogDuration,
  updateUsageLogTiming,
  updateUsageLogTokens,
} from "./provider-usage-log";
import { ensureProtectedAccess, protectedCors, securityHeaders } from "./security";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`CONFIG_ERROR:${name}`);
  }

  return value;
}

export function resolveEnv(name: string, credentials?: Record<string, string>): string {
  const fromCredentials = credentials?.[name];
  if (fromCredentials) {
    return fromCredentials;
  }

  return requireEnv(name);
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function parseCredentialsHeader(request: {
  header: (name: string) => string | undefined;
}): Record<string, string> {
  const raw = request.header("x-provider-credentials");
  if (!raw) return {};

  try {
    const decoded = atob(raw);
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.length > 0) {
          result[key] = value;
        }
      }
      return result;
    }
  } catch {
    // Invalid header, ignore
  }

  return {};
}

/**
 * Busca as credenciais do usuário para um provedor específico no banco de dados,
 * descriptografa e retorna como Record<string, string>.
 * Se não houver userId ou credenciais, retorna objeto vazio.
 */
async function getUserProviderCredentials(
  userId: string | undefined,
  providerId: string,
): Promise<Record<string, string>> {
  if (!userId) return {};

  try {
    const rows = await prisma.providerCredential.findMany({
      where: { userId, providerId },
      select: { credentialKey: true, credentialValue: true },
    });

    const result: Record<string, string> = {};
    for (const row of rows) {
      try {
        result[row.credentialKey] = decryptCredential(row.credentialValue);
      } catch {
        logger.error("credentials.decrypt_failed", {
          credentialKey: row.credentialKey,
          providerId,
          userId,
        });
      }
    }
    return result;
  } catch (error) {
    logger.error("credentials.load_failed", { error, providerId });
    return {};
  }
}

function logProviderError(providerId: string, error: unknown): void {
  logger.error("provider.request_failed", { error, providerId });
}

type AppEnv = {
  Variables: {
    userId: string;
    apiKeyId: string;
  };
};

export function createProviderApp(config: ProviderConfig) {
  const app = new Hono<AppEnv>().basePath(config.basePath);
  app.onError(handleApiError);

  app.use("*", securityHeaders);
  app.use("*", protectedCors);
  app.use("*", async (c, next) => {
    const accessError = await ensureProtectedAccess(c, {
      providerId: config.providerId,
    });
    if (accessError) {
      return accessError;
    }

    return next();
  });

  app.get("/api/models", async (c) => {
    const userId = c.get("userId") as string | undefined;
    const dbCredentials = await getUserProviderCredentials(userId, config.providerId);
    const headerCredentials = parseCredentialsHeader(c.req);
    const credentials = { ...dbCredentials, ...headerCredentials };

    if (config.fetchModels) {
      const models = await fetchCachedProviderModels(config, credentials, userId);
      return c.json({ models });
    }
    return c.json({ models: config.models });
  });

  app.post("/api/test", async (c) => {
    try {
      // Merge: header > db > env (mesma lógica do /api/chat)
      const userId = c.get("userId") as string | undefined;
      const dbCredentials = await getUserProviderCredentials(userId, config.providerId);
      const headerCredentials = parseCredentialsHeader(c.req);
      const credentials = { ...dbCredentials, ...headerCredentials };

      if (Object.keys(credentials).length === 0) {
        return c.json({ ok: false, error: "Nenhuma credencial fornecida para teste." }, 400);
      }

      if (!config.testCredentials) {
        // Provider does not support credential testing — accept gracefully
        return c.json({ ok: true, skipped: true });
      }

      const result = await config.testCredentials(credentials);
      return c.json(result, result.ok ? 200 : 401);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido ao testar credenciais.";
      return c.json({ ok: false, error: message }, 500);
    }
  });

  app.post("/api/chat", async (c) => {
    try {
      const contentLengthHeader = c.req.header("content-length");
      if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_REQUEST_BODY_BYTES) {
          return jsonErrorResponse(413, "Request body too large");
        }
      }

      const rawRequestBody = await c.req.text();
      if (getUtf8ByteLength(rawRequestBody) > MAX_PROVIDER_REQUEST_BODY_BYTES) {
        return jsonErrorResponse(413, "Request body too large");
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(rawRequestBody) as unknown;
      } catch {
        return jsonErrorResponse(400, "Invalid JSON request body");
      }

      const parsedBody = providerChatBodySchema.safeParse(rawJson);
      if (!parsedBody.success) {
        const zodIssues = parsedBody.error.issues;
        // Alguns clientes só mostram error.message; o Zod guarda a causa em issues.
        logger.warn("provider.invalid_chat_body", {
          providerId: config.providerId,
          issueCount: zodIssues.length,
          issues: zodIssues.slice(0, 32),
        });
        const issues = zodIssues.slice(0, 12).map((i) => ({
          path: i.path.map(String).join(".") || "(root)",
          message: i.message,
          code: i.code,
        }));
        return jsonErrorResponse(400, "Invalid chat request payload", {
          issues,
        });
      }

      const rawBody = parsedBody.data as Record<string, unknown>;
      const modelId = parsedBody.data.modelId || config.defaultModel;
      const messages = normalizeMessages(parsedBody.data.messages);

      if (!messages.length) {
        return jsonErrorResponse(400, "messages must be a non-empty array");
      }

      // 1. Credenciais do banco (menor prioridade)
      const userId = c.get("userId") as string | undefined;
      const apiKeyId = c.get("apiKeyId") as string | undefined;
      const projectId = c.req.header(MODELHUB_PROJECT_HEADER)?.trim() || undefined;
      const dbCredentials = await getUserProviderCredentials(userId, config.providerId);

      // 2. Credenciais do header (maior prioridade — sobrescrevem as do banco)
      const headerCredentials = parseCredentialsHeader(c.req);

      // Merge: header > db > env (env é resolvido em resolveEnv)
      const credentials = { ...dbCredentials, ...headerCredentials };

      const modelCapabilities = await getModelCapabilities(config, modelId, credentials, userId);

      if (requestUsesTools(rawBody) && modelCapabilities.tools === false) {
        return jsonErrorResponse(400, `Modelo "${modelId}" nao suporta tools`);
      }

      const resolvedMessages = await resolveMessagesForProvider({
        config,
        credentials,
        messages,
        modelId,
        modelCapabilities,
        userId,
        projectId,
      });

      // Verificar orçamento antes de processar
      if (userId) {
        const budgetCheck = await checkBudget(userId);
        if (!budgetCheck.allowed) {
          logUsage({
            userId,
            apiKeyId,
            providerId: config.providerId,
            modelId,
            endpoint: c.req.path,
            statusCode: 429,
            errorDetail: `budget_exceeded: ${budgetCheck.periodSpendUsd.toFixed(6)}/${budgetCheck.limitUsd} USD`,
          });
          return jsonErrorResponse(
            429,
            `Limite de orçamento atingido: $${budgetCheck.periodSpendUsd.toFixed(4)} de $${budgetCheck.limitUsd?.toFixed(2)} USD no período`,
          );
        }
      }

      const { conversationId, messageId } = await resolveUsageCorrelation(
        userId,
        c.req.header(MODELHUB_CONVERSATION_HEADER),
        c.req.header(MODELHUB_MESSAGE_HEADER),
      );
      const startedAt = Date.now();
      const routingTier = c.req.header("x-modelhub-routing-tier") ?? null;
      const routingReason = c.req.header("x-modelhub-routing-reason") ?? null;
      const taskCategory = c.req.header("x-modelhub-task-category") ?? null;
      const response = await config.chat(resolvedMessages, modelId, rawBody, credentials, userId);

      const durationMs = Date.now() - startedAt;

      let errorDetail: string | null = null;
      if (response.status >= 400) {
        try {
          errorDetail = (await response.clone().text()).slice(0, MAX_USAGE_LOG_ERROR_CHARS);
        } catch {
          errorDetail = null;
        }
      }

      const logPromise = logUsage({
        userId,
        apiKeyId,
        providerId: config.providerId,
        modelId,
        endpoint: c.req.path,
        statusCode: response.status,
        errorDetail,
        durationMs,
        routingTier,
        routingReason,
        taskCategory,
        conversationId,
        messageId,
      });

      // Tap streaming response to extract token usage e TTFT (primeiro chunk) asynchronously
      if (response.ok && response.body) {
        const [streamForCaller, streamForMonitor] = response.body.tee();

        (async () => {
          try {
            const logId = await logPromise;
            if (!logId) return;

            let firstChunkAt: number | null = null;
            const reader = streamForMonitor.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (firstChunkAt === null) {
                  firstChunkAt = Date.now();
                  void updateUsageLogTiming(logId, firstChunkAt - startedAt);
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                  if (!line.startsWith("d:")) continue;
                  try {
                    const data = JSON.parse(line.slice(2)) as {
                      finishReason?: string;
                      usage?: { promptTokens: number; completionTokens: number };
                    };
                    if (data.usage) {
                      await updateUsageLogTokens(
                        logId,
                        {
                          inputTokens: data.usage.promptTokens,
                          completionTokens: data.usage.completionTokens,
                        },
                        config.providerId,
                        modelId,
                      );
                      return;
                    }
                  } catch {
                    /* ignore parse errors */
                  }
                }
              }
            } finally {
              await updateUsageLogDuration(logId, Date.now() - startedAt);
            }
          } catch {
            /* ignore monitor errors */
          }
        })();

        return new Response(streamForCaller, {
          status: response.status,
          headers: response.headers,
        });
      }

      return response;
    } catch (error) {
      if (error instanceof AttachmentCapabilityError) {
        return jsonErrorResponse(error.status, error.message);
      }

      if (error instanceof Error && error.message.startsWith("CONFIG_ERROR:")) {
        return jsonErrorResponse(503, "Provider is not configured");
      }

      logProviderError(config.providerId, error);

      // Log falhas também
      const errMsg = error instanceof Error ? error.message : String(error);
      logUsage({
        userId: c.get("userId") as string | undefined,
        apiKeyId: c.get("apiKeyId") as string | undefined,
        providerId: config.providerId,
        modelId: undefined,
        endpoint: c.req.path,
        statusCode: 500,
        errorDetail: errMsg.slice(0, MAX_USAGE_LOG_ERROR_CHARS),
      });

      return jsonErrorResponse(500, "Unable to process provider request");
    }
  });

  return app;
}
