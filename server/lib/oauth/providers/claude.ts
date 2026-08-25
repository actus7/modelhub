/**
 * Claude OAuth provider configuration.
 * Flow: Authorization Code with PKCE
 */

import type { BaseProviderConfig, MappedTokens, OAuthProviderHandler } from '../types';

const CLAUDE_CONFIG: BaseProviderConfig = {
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://claude.ai/oauth/token',
  clientId: process.env.CLAUDE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  scopes: ['user:inference'],
  codeChallengeMethod: 'S256',
};

const claude: OAuthProviderHandler = {
  flowType: 'authorization_code_pkce',

  buildAuthUrl(config, redirectUri, state, codeChallenge) {
    const params = new URLSearchParams({
      code: 'true',
      client_id: config.clientId as string,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: (config.scopes as string[]).join(' '),
      code_challenge: codeChallenge!,
      code_challenge_method: config.codeChallengeMethod as string,
      state,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },

  async exchangeToken(config, code, redirectUri, codeVerifier, state) {
    // Parse code - may contain state after #
    let authCode = code;
    let codeState = '';
    if (authCode.includes('#')) {
      const parts = authCode.split('#');
      authCode = parts[0];
      codeState = parts[1] || '';
    }

    const response = await fetch(config.tokenUrl as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        code: authCode,
        state: codeState || state,
        grant_type: 'authorization_code',
        client_id: config.clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return (await response.json()) as Record<string, unknown>;
  },

  mapTokens(tokens) {
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      scope: (tokens.scope as string) || null,
    };
  },
};

export default claude;
export { CLAUDE_CONFIG };
