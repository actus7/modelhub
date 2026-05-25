import { PROVIDER_CATALOG } from "./lib/catalog";

const STRICT_VERCEL_ENVS = new Set(["preview", "production"]);

let runtimeEnvValidated = false;

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsvSet(value: string | undefined): Set<string> {
  return new Set(parseCsv(value).map((item) => item.toLowerCase()));
}

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
      issues.push("DATABASE_URL must point to a pooled Neon endpoint (-pooler) in Vercel preview/production.");
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

function validateDuckAiChallengeRuntime(env: NodeJS.ProcessEnv, issues: string[]): void {
  const rawValue = env.DUCKAI_CHALLENGE_RUNTIME?.trim().toLowerCase();
  if (
    rawValue &&
    !["browser", "puppeteer", "off", "disabled", "jsdom-dangerous"].includes(rawValue)
  ) {
    issues.push(
      'DUCKAI_CHALLENGE_RUNTIME must be "browser", "puppeteer", "off", "disabled", or "jsdom-dangerous" when configured.',
    );
  }

  if (
    rawValue === "jsdom-dangerous" &&
    env.DUCKAI_ALLOW_UNTRUSTED_CHALLENGE_CODE !== "true"
  ) {
    issues.push(
      'DUCKAI_CHALLENGE_RUNTIME=jsdom-dangerous requires DUCKAI_ALLOW_UNTRUSTED_CHALLENGE_CODE="true".',
    );
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

function validateAllowedProxyDomains(env: NodeJS.ProcessEnv, issues: string[]): void {
  for (const domain of parseCsv(env.ALLOWED_PROXY_DOMAINS)) {
    if (domain.includes("://") || domain.includes("/") || domain.includes("?")) {
      issues.push(`ALLOWED_PROXY_DOMAINS entry "${domain}" must be a bare domain without protocol or path.`);
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

function getEnabledProviders(env: NodeJS.ProcessEnv) {
  const enabledProviders = parseCsvSet(env.ENABLED_PROVIDERS);
  const disabledProviders = parseCsvSet(env.DISABLED_PROVIDERS);

  return PROVIDER_CATALOG.filter((provider) => {
    const providerId = provider.id.toLowerCase();
    if (enabledProviders.size > 0) {
      return enabledProviders.has(providerId);
    }

    return !disabledProviders.has(providerId);
  });
}

function validateProviderSharedEnvMode(env: NodeJS.ProcessEnv, issues: string[]): void {
  for (const provider of getEnabledProviders(env)) {
    const requiredEnvNames = provider.requiredKeys?.map((field) => field.envName) ?? [];
    if (requiredEnvNames.length === 0) {
      continue;
    }

    const configuredKeys = requiredEnvNames.filter((envName) => env[envName]?.trim());
    if (configuredKeys.length === 0) {
      continue;
    }

    for (const envName of requiredEnvNames) {
      if (!env[envName]?.trim()) {
        issues.push(`Provider "${provider.id}" is in shared-env mode and requires ${requiredEnvNames.join(", ")}.`);
        break;
      }
    }
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
  validateBooleanFlag("DUCKAI_ALLOW_UNTRUSTED_CHALLENGE_CODE", env, issues);
  validateBooleanFlag("DUCKAI_PUPPETEER_NO_SANDBOX", env, issues);
  validateDuckAiChallengeRuntime(env, issues);
  validatePositiveNumber("RATE_LIMIT_WINDOW_MS", env, issues);
  validatePositiveNumber("RATE_LIMIT_MAX", env, issues);
  validatePositiveNumber("USER_RATE_LIMIT_MAX", env, issues);
  validateAllowedOrigins(env, issues);
  validateAllowedProxyDomains(env, issues);
  validateUpstashRateLimitEnv(env, issues);
  validateProviderSharedEnvMode(env, issues);

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
