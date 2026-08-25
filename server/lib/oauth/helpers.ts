/**
 * Shared helpers for OAuth providers.
 *
 * Ported from 9router/src/lib/oauth/providerHelpers.js and providers/_shared.js
 */

const BASE64_BLOCK_SIZE = 4;

// ─── JWT / Token Helpers ────────────────────────────────────────────

/** Decode JWT payload without verification (for extracting claims). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    if (!jwt || typeof jwt !== 'string') return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const missingPadding = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const padded = base64 + '='.repeat(missingPadding);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/** Extract email from an access token JWT. */
export function extractEmailFromAccessToken(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return undefined;
  return (payload.email as string) || (payload.preferred_username as string) || (payload.sub as string) || undefined;
}

/** Decode xAI id_token to extract email. */
export function decodeXaiIdTokenEmail(idToken: string | undefined): string | undefined {
  if (!idToken || typeof idToken !== 'string') return undefined;
  const parts = idToken.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const json = Buffer.from(base64 + '='.repeat(padding), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return (payload.email as string) || (payload.preferred_username as string) || (payload.sub as string) || undefined;
  } catch {
    return undefined;
  }
}

/** Extract Codex account info from id_token. */
export function extractCodexAccountInfo(idToken: string | undefined): {
  email?: string;
  chatgptAccountId?: string;
  chatgptPlanType?: string;
} {
  const payload = decodeJwtPayload(idToken || '');
  if (!payload) return {};
  const chatgpt = (payload['https://api.openai.com/auth'] as Record<string, unknown>) || {};
  return {
    email: payload.email as string | undefined,
    chatgptAccountId: (chatgpt.chatgpt_account_id || payload.account_id) as string | undefined,
    chatgptPlanType: (chatgpt.chatgpt_plan_type || payload.plan_type) as string | undefined,
  };
}

/** Validate xAI OAuth endpoint URL (must be on x.ai domain). */
export function validateXaiOAuthEndpoint(rawUrl: string, field: string): string {
  const value = String(rawUrl || '').trim();
  if (!value) throw new Error(`xai discovery ${field} is empty`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (err: unknown) {
    throw new Error(`xai discovery ${field} is invalid: ${(err as Error).message}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`xai discovery ${field} must use https: ${value}`);
  const host = parsed.hostname.toLowerCase().trim();
  if (host !== 'x.ai' && !host.endsWith('.x.ai')) {
    throw new Error(`xai discovery ${field} host ${host} is not on x.ai`);
  }
  return value;
}

// ─── JSON Path Extraction ───────────────────────────────────────────

/**
 * Extract a string/number value from a nested object by trying multiple paths.
 * Used by Trae and Windsurf providers.
 */
export function extractJsonPath(
  root: unknown,
  paths: string[][],
): string | null {
  for (const path of paths) {
    let cur: unknown = root;
    for (const key of path) {
      if (cur == null || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[key];
    }
    if (typeof cur === 'string' && cur.trim()) return cur.trim();
    if (typeof cur === 'number') return String(cur);
  }
  return null;
}

// ─── AWS Region Validation ──────────────────────────────────────────

const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;

/** Reject any region that is not a valid AWS region before interpolating it into a URL. */
export function assertValidAwsRegion(region: string): string {
  if (typeof region !== 'string' || !AWS_REGION_PATTERN.test(region)) {
    throw new Error('Invalid region');
  }
  return region;
}

// ─── Kiro Profile ARN ───────────────────────────────────────────────

/** Fetch Kiro profile ARN from CodeWhisperer ListAvailableProfiles. */
export async function fetchKiroProfileArn(accessToken: string): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const response = await fetch('https://codewhisperer.us-east-1.amazonaws.com/ListAvailableProfiles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ maxResults: 10 }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { profiles?: Array<{ arn?: string }> };
    return data.profiles?.find((p) => p.arn?.trim())?.arn?.trim() || null;
  } catch {
    return null;
  }
}
