import type { Context } from "hono";

import { jsonErrorResponse } from "../lib/provider-core";

export function getUserId(c: Context): string | undefined {
  return c.get("userId") as string | undefined;
}

export function requireAuth(c: Context): string | Response {
  const userId = getUserId(c);
  if (!userId) return jsonErrorResponse(401, "Authentication required");
  return userId;
}
