import type { Context } from "hono";
import { Hono } from "hono";

import { handleApiError, jsonErrorResponse } from "../lib/http";
import { authenticateAccess, protectedCors, securityHeaders } from "../lib/security";

/**
 * Sub-app Hono das rotas autenticadas (`/user`, `/conversations`, ...):
 * headers de segurança, CORS, autenticação obrigatória e o handler de erro
 * central. Toda rota nova de usuário nasce daqui.
 */
export function createAuthenticatedRouter(basePath: string): Hono {
  const app = new Hono().basePath(basePath);
  app.onError(handleApiError);
  app.use("*", securityHeaders);
  app.use("*", protectedCors);
  app.use("*", async (c, next) => {
    const authError = await authenticateAccess(c);
    if (authError) return authError;
    return next();
  });
  return app;
}

function getUserId(c: Context): string | undefined {
  return c.get("userId") as string | undefined;
}

export function requireAuth(c: Context): string | Response {
  const userId = getUserId(c);
  if (!userId) return jsonErrorResponse(401, "Authentication required");
  return userId;
}
