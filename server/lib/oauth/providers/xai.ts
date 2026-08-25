/**
 * xAI (Grok) OAuth provider configuration.
 * Flow: Authorization Code with PKCE (96-byte verifier)
 * Special: OIDC discovery with static fallback
 */

import { randomBytes } from 'node:crypto';
import type { BaseProviderConfig, OAuthProviderHandler } from '../types';
import { decodeXaiIdTokenEmail, validateXaiOAuthEndpoint } from '../helpers';

const XAI_ISSUER = 'https://auth.x.ai';
const XAI_DISCOVERY_PATH = '/.well-known/openid-configuration';

const XAI_CONFIG: BaseProviderConfig = {
  clientId: process.env.XAI_OAUTH_CLIENT_ID || '',
  issuer: XAI_ISSUER,
  authorizeUrl: `${XAI_ISSUER}/oauth2/authorize`,
  tokenUrl: `${XAI_ISSUER}/oauth2/token`,
  discoveryUrl: `${XAI_ISSUER}${XAI_DISCOVERY_PATH}`,
  scope: 'openid profile email offline_access grok-cli:access api:access',
  codeChallengeMethod: 'S256',
  loopbackPort: 56121,
  callbackPath: '/callback',
  refreshLeadSeconds: 300,
};

let cachedXaiDiscovery: { authorizeUrl: string; tokenUrl: string } | null = null;

async function discoverXaiEndpoints(): Promise<{ authorizeUrl: string; tokenUrl: string }> {
  if (cachedXaiDiscovery) return cachedXaiDiscovery;
  try {
    const res = await fetch(XAI_CONFIG.discoveryUrl as string, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as Record<string, string>;
      cachedXaiDiscovery = {
        authorizeUrl: validateXaiOAuthEndpoint(data.authorization_endpoint, 'authorization_endpoint'),
        tokenUrl: validateXaiOAuthEndpoint(data.token_endpoint, 'token_endpoint'),
      };
      return cachedXaiDiscovery;
    }
  } catch {
    /* fall through to static fallback */
  }
  cachedXaiDiscovery = { authorizeUrl: XAI_CONFIG.authorizeUrl as string, tokenUrl: XAI_CONFIG.tokenUrl as string };
  return cachedXaiDiscovery;
}

const xai: OAuthProviderHandler = {
  flowType: 'authorization_code_pkce',
  fixedPort: XAI_CONFIG.loopbackPort as number,
  callbackPath: XAI_CONFIG.callbackPath as string,
  pkceVerifierBytes: 96,

  async prepareConfig(config) {
    const endpoints = await discoverXaiEndpoints();
    return { ...config, authorizeUrl: endpoints.authorizeUrl, tokenUrl: endpoints.tokenUrl };
  },

  buildAuthUrl(config, redirectUri, state, codeChallenge) {
    const nonce = randomBytes(16).toString('hex');
    const params: Record<string, string> = {
      response_type: 'code',
      client_id: config.clientId as string,
      redirect_uri: redirectUri,
      scope: config.scope as string,
      code_challenge: codeChallenge!,
      code_challenge_method: config.codeChallengeMethod as string,
      state,
      nonce,
      plan: 'generic',
      referrer: 'cli-proxy-api',
    };
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    return `${config.authorizeUrl}?${qs}`;
  },

  async exchangeToken(config, code, redirectUri, codeVerifier) {
    const response = await fetch(config.tokenUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId as string,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier!,
      }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`xAI token exchange failed: ${error}`);
    }
    return (await response.json()) as Record<string, unknown>;
  },

  mapTokens(tokens) {
    const mapped = {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      scope: (tokens.scope as string) || null,
    } as import('../types').MappedTokens;
    const email = decodeXaiIdTokenEmail(tokens.id_token as string | undefined);
    if (email) mapped.email = email;
    if (tokens.id_token) {
      mapped.providerSpecificData = { idToken: tokens.id_token };
    }
    return mapped;
  },
};

export default xai;
export { XAI_CONFIG };
