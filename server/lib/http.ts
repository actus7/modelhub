/**
 * Respostas de erro HTTP da API — fonte única do formato.
 *
 * - Erros esperados (validação, auth, not found): `{ error: string, ...details }`.
 * - Falhas não tratadas: `{ error: { message }, requestId }`, sem detalhes
 *   internos; o erro completo vai para o log estruturado.
 */

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { getRequestId, logger } from "./logger";

export function jsonErrorResponse(
  status: number,
  error: string,
  details?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(details ? { error, ...details } : { error }), {
    headers: { ...headers, "Content-Type": "application/json" },
    status,
  });
}

/** Handler `onError` compartilhado por todos os apps Hono (raiz e sub-rotas). */
export function handleApiError(error: unknown, c: Context): Response {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  logger.error("http.unhandled_error", {
    error,
    method: c.req.method,
    route: c.req.path,
  });

  return c.json({ error: { message: "Internal server error" }, requestId: getRequestId() }, 500);
}
