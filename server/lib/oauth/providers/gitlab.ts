/**
 * GitLab Duo OAuth provider configuration.
 * Flow: Authorization Code with PKCE
 * Special: dynamic baseUrl/clientId from meta
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const GITLAB_CONFIG: BaseProviderConfig = {
  defaultBaseUrl: 'https://gitlab.com',
  authorizeUrlPath: '/oauth/authorize',
  tokenUrlPath: '/oauth/token',
  userInfoUrlPath: '/api/v4/user',
  scope: 'api',
  codeChallengeMethod: 'S256',
};

const gitlab: OAuthProviderHandler = {
  flowType: 'authorization_code_pkce',

  buildAuthUrl(config, redirectUri, state, codeChallenge, meta) {
    const baseUrl = (meta?.baseUrl as string) || (config.defaultBaseUrl as string);
    const clientId = (meta?.clientId as string) || '';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: config.scope as string,
      code_challenge: codeChallenge!,
      code_challenge_method: config.codeChallengeMethod as string,
    });
    return `${baseUrl}${config.authorizeUrlPath}?${params.toString()}`;
  },

  async exchangeToken(config, code, redirectUri, codeVerifier, _state, meta) {
    const baseUrl = (meta?.baseUrl as string) || (config.defaultBaseUrl as string);
    const clientId = (meta?.clientId as string) || '';
    const clientSecret = (meta?.clientSecret as string) || '';
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier!,
    });
    if (clientSecret) body.set('client_secret', clientSecret);
    const response = await fetch(`${baseUrl}${config.tokenUrlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    if (!response.ok) throw new Error(`GitLab token exchange failed: ${await response.text()}`);
    const tokens = (await response.json()) as Record<string, unknown>;

    const userRes = await fetch(`${baseUrl}${config.userInfoUrlPath}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = userRes.ok ? ((await userRes.json()) as Record<string, unknown>) : {};
    return { ...tokens, _user: user, _baseUrl: baseUrl, _clientId: clientId };
  },

  mapTokens(tokens) {
    const user = tokens._user as Record<string, unknown> | undefined;
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      scope: (tokens.scope as string) || null,
      providerSpecificData: {
        username: (user?.username as string) || '',
        email: (user?.email as string) || (user?.public_email as string) || '',
        name: (user?.name as string) || '',
        baseUrl: tokens._baseUrl as string,
        clientId: tokens._clientId as string,
        authKind: 'oauth',
      },
    };
  },
};

export default gitlab;
export { GITLAB_CONFIG };
