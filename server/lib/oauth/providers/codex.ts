/**
 * Codex (OpenAI) OAuth provider configuration.
 * Flow: Authorization Code with PKCE
 * Special: extracts email + chatgpt account info from id_token
 */

import type { BaseProviderConfig, MappedTokens, OAuthProviderHandler } from '../types';
import { extractCodexAccountInfo, extractEmailFromAccessToken } from '../helpers';

const CODEX_CONFIG: BaseProviderConfig = {
  authorizeUrl: 'https://auth0.openai.com/authorize',
  tokenUrl: 'https://auth0.openai.com/oauth/token',
  clientId: process.env.CODEX_OAUTH_CLIENT_ID || 'DRkX6O8VT2k87k7HTONTHJ77777',
  scope: 'openid profile email offline_access',
  codeChallengeMethod: 'S256',
  extraParams: { audience: 'https://api.openai.com/v1' },
  fixedPort: 1455,
  callbackPath: '/auth/callback',
};

const codex: OAuthProviderHandler = {
  flowType: 'authorization_code_pkce',
  fixedPort: CODEX_CONFIG.fixedPort as number,
  callbackPath: CODEX_CONFIG.callbackPath as string,

  buildAuthUrl(config, redirectUri, state, codeChallenge) {
    const params: Record<string, string> = {
      response_type: 'code',
      client_id: config.clientId as string,
      redirect_uri: redirectUri,
      scope: config.scope as string,
      code_challenge: codeChallenge!,
      code_challenge_method: config.codeChallengeMethod as string,
      ...(config.extraParams as Record<string, string>),
      state,
    };
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    return `${config.authorizeUrl}?${queryString}`;
  },

  async exchangeToken(config, code, redirectUri, codeVerifier) {
    const response = await fetch(config.tokenUrl as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
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
      throw new Error(`Token exchange failed: ${error}`);
    }

    return (await response.json()) as Record<string, unknown>;
  },

  mapTokens(tokens) {
    const info = extractCodexAccountInfo(tokens.id_token as string | undefined);
    const mapped: MappedTokens = {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      idToken: (tokens.id_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
    };
    const email = info.email || extractEmailFromAccessToken(tokens.access_token as string);
    if (email) mapped.email = email;
    if (info.chatgptAccountId || info.chatgptPlanType) {
      mapped.providerSpecificData = {
        chatgptAccountId: info.chatgptAccountId,
        chatgptPlanType: info.chatgptPlanType,
      };
    }
    return mapped;
  },
};

export default codex;
export { CODEX_CONFIG };
