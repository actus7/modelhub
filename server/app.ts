import "./env";

import { Hono } from "hono";

import { getAvailableProviders } from "./lib/catalog";
import { checkReadiness } from "./lib/health";
import { handleApiError } from "./lib/http";
import { logger, runWithRequestContext } from "./lib/logger";
import {
  classifyHttpStatus,
  getProviderFromResponse,
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "./lib/observability";
import {
  ensureDebugAccess,
  ensureProtectedAccess,
  isAccessProtectionEnabled,
  protectedCors,
  securityHeaders,
} from "./lib/security";
import { providerRegistry } from "./providers/registry";
import canvasFetch from "./routes/canvas";
import conversationsFetch from "./routes/conversations";
import harnessFetch from "./routes/harness";
import projectsFetch from "./routes/projects";
import userFetch from "./routes/user";
import v1Fetch from "./routes/v1";

type ApiAppEnv = {
  Variables: {
    apiKeyId: string;
    sessionId: string;
    userId: string;
  };
};

function resolveProviderFromPath(pathname: string): string | undefined {
  const [firstSegment] = pathname.split("/").filter(Boolean);
  return firstSegment && providerRegistry[firstSegment] ? firstSegment : undefined;
}

function createApiApp() {
  const app = new Hono<ApiAppEnv>();

  /** Falhas não tratadas viram JSON (clientes OpenAI esperam JSON, não a página 500 do Next.js). */
  app.onError(handleApiError);

  app.use("*", securityHeaders);
  app.use(async (c, next) => {
    const startedAt = Date.now();
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));

    await runWithRequestContext({ requestId }, async () => {
      await next();
      c.res.headers.set("X-Accel-Buffering", "no");
      c.res.headers.set(REQUEST_ID_HEADER, requestId);
      logger.info("http.request", {
        durationMs: Date.now() - startedAt,
        errorClass: classifyHttpStatus(c.res.status),
        method: c.req.method,
        provider: getProviderFromResponse(c.res) ?? resolveProviderFromPath(c.req.path) ?? null,
        route: c.req.path,
        status: c.res.status,
      });
    });
  });

  app.use("/v1/*", protectedCors);
  app.use("/providers/*", protectedCors);
  app.use("/:provider/*", protectedCors);
  app.use("/debug", protectedCors);

  app.get("/providers/catalog", (c) => {
    return c.json({
      authRequired: isAccessProtectionEnabled(),
      providers: getAvailableProviders(),
    });
  });

  app.use("/user/*", async (c) => await userFetch(c.req.raw));
  app.use("/conversations/*", async (c) => await conversationsFetch(c.req.raw));
  app.use("/harness/*", async (c) => await harnessFetch(c.req.raw));
  app.use("/projects/*", async (c) => await projectsFetch(c.req.raw));
  app.use("/canvas/*", async (c) => await canvasFetch(c.req.raw));
  app.use("/v1/*", async (c) => await v1Fetch(c.req.raw));

  app.use("/:provider/*", async (c, next) => {
    const providerId = c.req.param("provider");
    const handler = providerRegistry[providerId]?.handler;

    if (!handler) {
      await next();
      return;
    }

    const accessError = await ensureProtectedAccess(c, { providerId });
    if (accessError) {
      return accessError;
    }

    return handler(c.req.raw);
  });

  /** Liveness: o processo responde. Não toca em dependências. */
  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: Date.now() });
  });

  /** Readiness: 503 enquanto o banco não responde. */
  app.get("/health/ready", async (c) => {
    const report = await checkReadiness();
    return c.json({ ...report, timestamp: Date.now() }, report.status === "ok" ? 200 : 503);
  });

  app.get("/debug", async (c) => {
    const debugError = await ensureDebugAccess(c);
    if (debugError) {
      return debugError;
    }

    return c.json({ node: process.version, timestamp: Date.now() });
  });

  return app;
}

const app = createApiApp();

export default app;
