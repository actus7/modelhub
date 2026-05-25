import { describe, expect, it } from "vitest";

import { shouldValidateRuntimeEnv, validateRuntimeEnvConfig } from "../env";

const VALID_ENV = {
  ALLOW_DEBUG_ENDPOINTS: "false",
  DATABASE_URL: "postgresql://neondb_owner:password@ep-example-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  NEON_AUTH_BASE_URL: "https://auth.example.com",
  NEON_AUTH_COOKIE_SECRET: "test-secret-32-characters-long!!",
  NODE_ENV: "production",
  REQUIRE_AUTH: "true",
  VERCEL_ENV: "preview",
} satisfies NodeJS.ProcessEnv;

describe("runtime env validation", () => {
  it("validates a complete preview configuration", () => {
    expect(validateRuntimeEnvConfig(VALID_ENV)).toEqual([]);
  });

  it("fails when NEON_AUTH_COOKIE_SECRET is shorter than 32 characters", () => {
    expect(
      validateRuntimeEnvConfig({
        ...VALID_ENV,
        NEON_AUTH_COOKIE_SECRET: "short",
      }),
    ).toEqual(
      expect.arrayContaining(["NEON_AUTH_COOKIE_SECRET must be at least 32 characters (Neon Auth requirement)."]),
    );
  });

  it("fails when central envs are missing", () => {
    expect(validateRuntimeEnvConfig({ NODE_ENV: "production", VERCEL_ENV: "preview" } as NodeJS.ProcessEnv)).toEqual(
      expect.arrayContaining([
        "DATABASE_URL is required.",
        "ENCRYPTION_KEY is required.",
        "NEON_AUTH_BASE_URL is required.",
        "NEON_AUTH_COOKIE_SECRET is required.",
      ]),
    );
  });

  it("requires all shared provider envs when one of them is configured", () => {
    const issues = validateRuntimeEnvConfig({
      ...VALID_ENV,
      CLOUDFLARE_API_TOKEN: "token",
      ENABLED_PROVIDERS: "cloudflareworkersai",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        'Provider "cloudflareworkersai" is in shared-env mode and requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.',
      ]),
    );
  });

  it("requires explicit opt-in for Duck.ai jsdom challenge execution", () => {
    expect(
      validateRuntimeEnvConfig({
        ...VALID_ENV,
        DUCKAI_CHALLENGE_RUNTIME: "jsdom-dangerous",
      }),
    ).toEqual(
      expect.arrayContaining([
        'DUCKAI_CHALLENGE_RUNTIME=jsdom-dangerous requires DUCKAI_ALLOW_UNTRUSTED_CHALLENGE_CODE="true".',
      ]),
    );
  });

  it("accepts the browser Duck.ai challenge runtime", () => {
    expect(
      validateRuntimeEnvConfig({
        ...VALID_ENV,
        DUCKAI_CHALLENGE_RUNTIME: "browser",
      }),
    ).toEqual([]);
  });

  it("requires complete Upstash configuration when distributed rate limiting is enabled", () => {
    expect(
      validateRuntimeEnvConfig({
        ...VALID_ENV,
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      }),
    ).toEqual(
      expect.arrayContaining([
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together.",
      ]),
    );
  });

  it("validates in development and on Vercel preview/production", () => {
    expect(shouldValidateRuntimeEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(shouldValidateRuntimeEnv({ NODE_ENV: "production", VERCEL_ENV: "preview" } as NodeJS.ProcessEnv)).toBe(true);
    expect(shouldValidateRuntimeEnv({ NODE_ENV: "production", VERCEL_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("skips validation during Next.js build phase", () => {
    expect(shouldValidateRuntimeEnv({ NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PHASE: "phase-production-build" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
