/**
 * Gemini CLI (Google Cloud Code Assist) OAuth provider configuration.
 * Flow: Authorization Code (no PKCE, uses client_secret)
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const GEMINI_CONFIG: BaseProviderConfig = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  clientId: process.env.GEMINI_OAUTH_CLIENT_ID || '',
  clientSecret: process.env.GEMINI_OAUTH_CLIENT_SECRET || '',
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  userInfoUrl: 'https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses',
  codeChallengeMethod: 'S256',
};

function getOAuthClientMetadata() {
  return { ideType: 9, platform: 3, pluginType: 2 };
}

const geminiCli: OAuthProviderHandler = {
  flowType: 'authorization_code',

  buildAuthUrl(config, redirectUri, state) {
    const params = new URLSearchParams({
      client_id: config.clientId as string,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: (config.scopes as string[]).join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },

  async exchangeToken(config, code, redirectUri) {
    const response = await fetch(config.tokenUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId as string,
        client_secret: config.clientSecret as string,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
    return (await response.json()) as Record<string, unknown>;
  },

  async postExchange(tokens) {
    const userInfoRes = await fetch(`${GEMINI_CONFIG.userInfoUrl}&alt=json`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = userInfoRes.ok ? ((await userInfoRes.json()) as Record<string, unknown>) : {};

    let projectId = '';
    try {
      const projectRes = await fetch('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ metadata: getOAuthClientMetadata(), mode: 1 }),
      });
      if (projectRes.ok) {
        const data = (await projectRes.json()) as Record<string, unknown>;
        const proj = data.cloudaicompanionProject;
        projectId = typeof proj === 'string' ? proj : (proj as Record<string, unknown>)?.id as string || '';
      }
    } catch { /* ignore */ }

    return { userInfo, projectId };
  },

  mapTokens(tokens, extra) {
    const userInfo = extra?.userInfo as Record<string, unknown> | undefined;
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      scope: (tokens.scope as string) || null,
      email: userInfo?.email as string | undefined,
      projectId: extra?.projectId as string | undefined,
    };
  },
};

export default geminiCli;
export { GEMINI_CONFIG };
