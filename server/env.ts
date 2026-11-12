import { parseCsv } from "./lib/env-utils";

const STRICT_VERCEL_ENVS = new Set(["preview", "production"]);

let runtimeEnvValidated = false;

function isBooleanLike(value: string | undefined): boolean {
  return value === undefined || value === "true" || value === "false";
}

function isStrictVercelEnv(env: NodeJS.ProcessEnv): boolean {
  return STRICT_VERCEL_ENVS.has(env.VERCEL_ENV ?? "");
}

function validateDatabaseUrl(databaseUrl: string | undefined, issues: string[]): void {
  if (!databaseUrl?.trim()) {
    issues.push("DATABASE_URL is required.");
    return;
  }

  try {
    const parsed = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      issues.push("DATABASE_URL must use the postgres/postgresql protocol.");
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    if (!isLocalHost && !hostname.includes("-pooler")) {
      issues.push(
        "DATABASE_URL must point to a pooled Neon endpoint (-pooler) in Vercel preview/production.",
      );
    }
  } catch {
    issues.push("DATABASE_URL must be a valid connection string.");
  }
}

function validateEncryptionKey(encryptionKey: string | undefined, issues: string[]): void {
  if (!encryptionKey?.trim()) {
    issues.push("ENCRYPTION_KEY is required.");
    return;
  }

  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    issues.push("ENCRYPTION_KEY must be exactly 64 hexadecimal characters.");
  }
}

function validateNeonAuthBaseUrl(baseUrl: string | undefined, issues: string[]): void {
  if (!baseUrl?.trim()) {
    issues.push("NEON_AUTH_BASE_URL is required.");
    return;
  }

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:") {
      issues.push("NEON_AUTH_BASE_URL must use https in Vercel preview/production.");
    }
  } catch {
    issues.push("NEON_AUTH_BASE_URL must be a valid URL.");
  }
}

function validateCookieSecret(cookieSecret: string | undefined, issues: string[]): void {
  if (!cookieSecret?.trim()) {
    issues.push("NEON_AUTH_COOKIE_SECRET is required.");
    return;
  }

  if (cookieSecret.length < 32) {
    issues.push("NEON_AUTH_COOKIE_SECRET must be at least 32 characters (Neon Auth requirement).");
  }
}

function validateBooleanFlag(name: string, env: NodeJS.ProcessEnv, issues: string[]): void {
  if (!isBooleanLike(env[name])) {
    issues.push(`${name} must be either "true" or "false" when configured.`);
  }
}

function validatePositiveNumber(name: string, env: NodeJS.ProcessEnv, issues: string[]): void {
  const rawValue = env[name];
  if (rawValue === undefined) {
    return;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    issues.push(`${name} must be a positive number when configured.`);
  }
}

function validateAllowedOrigins(env: NodeJS.ProcessEnv, issues: string[]): void {
  for (const origin of parseCsv(env.ALLOWED_ORIGINS)) {
    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        issues.push(`ALLOWED_ORIGINS entry "${origin}" must use http or https.`);
      }
    } catch {
      issues.push(`ALLOWED_ORIGINS entry "${origin}" is not a valid origin URL.`);
    }
  }
}

function validateUpstashRateLimitEnv(env: NodeJS.ProcessEnv, issues: string[]): void {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url && !token) return;

  if (!url || !token) {
    issues.push("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together.");
    return;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      issues.push("UPSTASH_REDIS_REST_URL must use https.");
    }
  } catch {
    issues.push("UPSTASH_REDIS_REST_URL must be a valid URL.");
  }
}

export function shouldValidateRuntimeEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "test") {
    return false;
  }

  // Skip validation during Next.js build phase — secrets are only available at runtime
  if (env.NEXT_PHASE === "phase-production-build") {
    return false;
  }

  // Local dev: same required vars as production so auth/DB fail with clear messages, not library internals
  if (env.NODE_ENV === "development") {
    return true;
  }

  return isStrictVercelEnv(env);
}

export function validateRuntimeEnvConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const issues: string[] = [];

  validateDatabaseUrl(env.DATABASE_URL, issues);
  validateEncryptionKey(env.ENCRYPTION_KEY, issues);
  validateNeonAuthBaseUrl(env.NEON_AUTH_BASE_URL, issues);
  validateCookieSecret(env.NEON_AUTH_COOKIE_SECRET, issues);
  validateBooleanFlag("REQUIRE_AUTH", env, issues);
  validateBooleanFlag("ALLOW_DEBUG_ENDPOINTS", env, issues);
  validatePositiveNumber("RATE_LIMIT_WINDOW_MS", env, issues);
  validatePositiveNumber("RATE_LIMIT_MAX", env, issues);
  validatePositiveNumber("USER_RATE_LIMIT_MAX", env, issues);
  validateAllowedOrigins(env, issues);
  validateUpstashRateLimitEnv(env, issues);

  return issues;
}

export function ensureRuntimeEnvValidated(env: NodeJS.ProcessEnv = process.env): void {
  if (runtimeEnvValidated || !shouldValidateRuntimeEnv(env)) {
    return;
  }

  const issues = validateRuntimeEnvConfig(env);
  if (issues.length > 0) {
    throw new Error(`Runtime environment validation failed:\n- ${issues.join("\n- ")}`);
  }

  runtimeEnvValidated = true;
}
