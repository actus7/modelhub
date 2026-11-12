import "./env";

import { HTTPException } from "hono/http-exception";
import { Hono } from "hono";

import { getAvailableProviders } from "./lib/catalog";
import { getProviderFromResponse, logHttpRequest, resolveProviderFromPath } from "./lib/observability";
import {
  ensureDebugAccess,
  ensureProtectedAccess,
  isAccessProtectionEnabled,
  protectedCors,
  securityHeaders,
} from "./lib/security";
import { providerRegistry } from "./providers/registry";
import canvasFetch from "./routes/canvas";
import projectsFetch from "./routes/projects";
import userFetch from "./routes/user";
import conversationsFetch from "./routes/conversations";
import harnessFetch from "./routes/harness";
import v1Fetch from "./routes/v1";

type ApiAppEnv = {
  Variables: {
    apiKeyId: string;
    sessionId: string;
    userId: string;
  };
};

function createApiApp() {
  const app = new Hono<ApiAppEnv>();

  /** Evita que falhas não tratadas cheguem ao Next.js como página HTML 500 (clientes OpenAI esperam JSON). */
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    console.error("[api] unhandled error:", err);
    return c.json(
      {
        error: {
          message: "Internal server error",
        },
      },
      500,
    );
  });

  app.use("*", securityHeaders);
  app.use(async (c, next) => {
    const startedAt = Date.now();
    await next();
    c.res.headers.set("X-Accel-Buffering", "no");
    logHttpRequest({
      durationMs: Date.now() - startedAt,
      method: c.req.method,
      provider: getProviderFromResponse(c.res) ?? resolveProviderFromPath(c.req.path),
      route: c.req.path,
      status: c.res.status,
    });
  });

  app.use("/v1/*", protectedCors);
  app.use("/providers/*", protectedCors);
  app.use("/:provider/*", protectedCors);
  app.use("/debug", protectedCors);

  app.get("/", (c) => {
    return c.json({
      service: "ai-gateway-api",
      status: "ok",
      timestamp: Date.now(),
    });
  });

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

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: Date.now() });
  });

  app.get("/debug", async (c) => {
    const debugError = await ensureDebugAccess(c);
    if (debugError) {
      return debugError;
    }

    return c.json({ node: process.version, timestamp: Date.now(), version: "v4-hardened" });
  });

  return app;
}

const app = createApiApp();

export default app;
