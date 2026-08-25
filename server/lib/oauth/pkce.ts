/**
 * PKCE (Proof Key for Code Exchange) utilities.
 *
 * Ported from 9router/src/lib/oauth/utils/pkce.js
 */

import { createHash, randomBytes } from 'node:crypto';

/**
 * Generate PKCE code verifier (43-128 characters).
 * @param bytes - Number of random bytes (xAI uses 96, default 32).
 */
export function generateCodeVerifier(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Generate PKCE code challenge from verifier (S256 method).
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate random state for CSRF protection.
 */
export function generateState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate complete PKCE pair + state.
 */
export function generatePKCE(bytes = 32): {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
} {
  const codeVerifier = generateCodeVerifier(bytes);
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  return { codeVerifier, codeChallenge, state };
}

/**
 * Hash a state value for storage (deterministic lookup in OAuthTransaction).
 * Uses SHA-256 so the raw state is not stored in the database.
 */
export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}
