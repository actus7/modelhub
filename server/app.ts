import "./env";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { Hono } from "hono";
import { z } from "zod";

import { getAvailableProviders, getProxyTarget } from "./lib/catalog";
import { getProviderFromResponse, logHttpRequest, resolveProviderFromPath } from "./lib/observability";
import { fetchWithTimeout, jsonErrorResponse } from "./lib/provider-core";
import {
  ensureDebugAccess,
  ensureProtectedAccess,
  isAccessProtectionEnabled,
  protectedCors,
  securityHeaders,
} from "./lib/security";
import { providerRegistry } from "./providers/registry";
import userFetch from "./routes/user";
import conversationsFetch from "./routes/conversations";
import v1Fetch from "./routes/v1";

type ApiAppEnv = {
  Variables: {
    apiKeyId: string;
    sessionId: string;
    userId: string;
  };
};

function parseAllowedProxyDomains(): string[] {
  return (process.env.ALLOWED_PROXY_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivateIpAddress(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    return (
      address.startsWith("127.") ||
      address.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
      address.startsWith("192.168.") ||
      address.startsWith("169.254.") ||
      address.startsWith("0.")
    );
  }

  if (ipVersion === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("::ffff:127.")
    );
  }

  return false;
}

async function hostnameResolvesToPublicIps(hostname: string): Promise<boolean> {
  if (isIP(hostname)) {
    return !isPrivateIpAddress(hostname);
  }

  try {
    const lookups = await lookup(hostname, { all: true, verbatim: true });
    if (lookups.length === 0) {
      return false;
    }

    return lookups.every((entry) => !isPrivateIpAddress(entry.address));
  } catch (error) {
    console.error("[custom-model-proxy] DNS resolution failed", error);
    return false;
  }
}

async function isUrlAllowed(rawUrl: string): Promise<boolean> {
  const allowedProxyDomains = parseAllowedProxyDomains();
  if (allowedProxyDomains.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== "443") return false;
    if (!allowedProxyDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return false;
    }

    return hostnameResolvesToPublicIps(hostname);
  } catch (error) {
    console.warn("[custom-model-proxy] invalid URL rejected", error);
    return false;
  }
}

function getProtectedRequestHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};

  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers["content-type"] = contentType;
  }

  const accept = request.headers.get("accept");
  if (accept) {
    headers.accept = accept;
  }

  return headers;
}

function sanitizeProxyResponseHeaders(responseHeaders: Headers): Headers {
  const sanitizedHeaders = new Headers(responseHeaders);
  sanitizedHeaders.delete("content-encoding");
  sanitizedHeaders.delete("content-length");
  sanitizedHeaders.delete("location");
  sanitizedHeaders.delete("set-cookie");
  sanitizedHeaders.delete("transfer-encoding");
  return sanitizedHeaders;
}

export function createApiApp() {
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
          message: err instanceof Error ? err.message : "Internal server error",
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
  app.use("/gateway/*", protectedCors);
  app.use("/embeddings/*", protectedCors);
  app.use("/custom-model-proxy", protectedCors);
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

  app.post(
    "/custom-model-proxy",
    zValidator(
      "query",
      z.object({
        url: z.url().max(2048),
      }),
    ),
    async (c) => {
      const accessError = await ensureProtectedAccess(c);
      if (accessError) {
        return accessError;
      }

      if (parseAllowedProxyDomains().length === 0) {
        return jsonErrorResponse(503, "Custom proxy is not configured");
      }

      const { url } = c.req.valid("query");
      if (!(await isUrlAllowed(url))) {
        return jsonErrorResponse(403, "URL not allowed by proxy policy");
      }

      const body = await c.req.text();
      const response = await fetchWithTimeout(
        url,
        {
          body,
          headers: getProtectedRequestHeaders(c.req.raw),
          method: c.req.method,
          redirect: "manual",
        },
        60000,
      );

      if (response.status >= 300 && response.status < 400) {
        return jsonErrorResponse(502, "Redirect responses are not allowed");
      }

      return new Response(response.body, {
        headers: sanitizeProxyResponseHeaders(response.headers),
        status: response.status,
      });
    },
  );

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

  app.use(async (c, next) => {
    try {
      const url = new URL(c.req.url);
      const matchedProxy = getProxyTarget(url.pathname);
      if (!matchedProxy) {
        await next();
        return;
      }

      const accessError = await ensureProtectedAccess(c);
      if (accessError) {
        return accessError;
      }

      const headers: Record<string, string> = {
        host: new URL(matchedProxy.target).hostname,
      };

      c.req.raw.headers.forEach((value, key) => {
        const normalizedKey = key.toLowerCase();
        if (
          !normalizedKey.startsWith("cf-") &&
          !normalizedKey.startsWith("x-forwarded-") &&
          !normalizedKey.startsWith("cdn-") &&
          normalizedKey !== "x-real-ip" &&
          normalizedKey !== "host" &&
          normalizedKey !== "accept-encoding"
        ) {
          headers[normalizedKey] = value;
        }
      });

      const targetUrl = `${matchedProxy.target}${url.pathname.replace(
        `/${matchedProxy.pathSegment}/`,
        "/",
      )}${url.search}`;
      const method = c.req.method.toUpperCase();
      const requestInit: RequestInit = { headers, method };
      if (method !== "GET" && method !== "HEAD") {
        requestInit.body = await c.req.text();
      }

      const response = await fetchWithTimeout(targetUrl, requestInit, 60000);
      return new Response(response.body, {
        headers: sanitizeProxyResponseHeaders(response.headers),
        status: response.status,
      });
    } catch (error) {
      console.error("Proxy error:", error);
      return jsonErrorResponse(500, "Internal proxy error");
    }
  });

  return app;
}

const app = createApiApp();

export default app;
