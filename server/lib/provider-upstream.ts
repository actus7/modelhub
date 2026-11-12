/** Chamadas HTTP ao provedor upstream: timeout e tradução de falhas em respostas de erro seguras. */

import { jsonErrorResponse } from "./http";
import { logger } from "./logger";
import { scrubSecrets } from "./secret-scrub";

export function upstreamErrorResponse(
  providerName: string,
  status: number,
  detailsForLogRaw?: string,
  extraFields?: Record<string, unknown>,
): Response {
  // Provedores podem ecoar a credencial no corpo do erro (ex.: 401 da Anthropic);
  // redige antes de logar/persistir/devolver ao cliente.
  const detailsForLog = detailsForLogRaw === undefined ? undefined : scrubSecrets(detailsForLogRaw);
  logger.error("provider.upstream_error", {
    details: detailsForLog?.slice(0, 500),
    provider: providerName,
    status,
  });

  const upstreamSnippet = detailsForLog?.slice(0, 4000);
  const fromUpstream = upstreamSnippet ? { upstream: upstreamSnippet } : {};
  const details =
    Object.keys(fromUpstream).length > 0 || (extraFields && Object.keys(extraFields).length > 0)
      ? { ...fromUpstream, ...extraFields }
      : undefined;
  const upstreamMessage = extractUpstreamErrorMessage(detailsForLog);
  const message = upstreamMessage
    ? `${providerName} upstream error: ${upstreamMessage}`
    : `${providerName} upstream error`;
  return jsonErrorResponse(status, message, details);
}

function extractUpstreamErrorMessage(detailsForLog: string | undefined): string {
  if (!detailsForLog) return "";

  try {
    const parsed: unknown = JSON.parse(detailsForLog);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.message === "string" && record.message.trim()) {
        return record.message.trim().slice(0, 500);
      }

      if (typeof record.error === "string" && record.error.trim()) {
        return record.error.trim().slice(0, 500);
      }

      if (typeof record.error === "object" && record.error !== null) {
        const errorRecord = record.error as Record<string, unknown>;
        if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
          return errorRecord.message.trim().slice(0, 500);
        }
      }
    }
  } catch {
    // Fall through to plain-text extraction.
  }

  const plain = detailsForLog.trim();
  return plain.startsWith("{") ? "" : plain.slice(0, 500);
}

function formatProviderErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    let s = error.message;
    if (error.cause !== undefined) {
      const c = error.cause instanceof Error ? error.cause.message : String(error.cause);
      s = `${s} (${c})`;
    }
    return s;
  }
  return String(error);
}

export function internalProviderErrorResponse(providerName: string, error: unknown): Response {
  logger.error("provider.internal_error", { error, provider: providerName });
  const detail = formatProviderErrorDetail(error);
  const max = 2000;
  const truncated = detail.length > max ? `${detail.slice(0, max)}…` : detail;
  return jsonErrorResponse(500, `${providerName} request failed: ${truncated}`);
}

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs = 45000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function postJsonWithTimeout(
  url: string,
  init: {
    headers?: Record<string, string>;
    body: unknown;
    timeoutMs?: number;
  },
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (init.headers) {
    Object.assign(headers, init.headers);
  }

  return fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify(init.body),
    },
    init.timeoutMs ?? 45000,
  );
}
