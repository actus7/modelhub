/**
 * Antigravity (Google Code Assist) OAuth provider configuration.
 * Flow: Authorization Code (no PKCE, uses client_secret)
 * Special: loadCodeAssist + onboardUser flow
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

function getOAuthPlatformEnum(): number {
  const os = process.platform;
  const architecture = process.arch;
  if (os === 'darwin') return architecture === 'arm64' ? 2 : 1;
  if (os === 'linux') return architecture === 'arm64' ? 4 : 3;
  if (os === 'win32') return 5;
  return 0;
}

function getOAuthClientMetadata() {
  return { ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 };
}

const ANTIGRAVITY_CONFIG: BaseProviderConfig = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || '',
  clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || '',
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  userInfoUrl: 'https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses',
  loadCodeAssistEndpoint: 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
  onboardUserEndpoint: 'https://cloudcode-pa.googleapis.com/v1internal:onboardUser',
  loadCodeAssistUserAgent: 'google-api-nodejs-client/9.15.1',
};

const antigravity: OAuthProviderHandler = {
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
    const loadHeaders = {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
      'User-Agent': ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent as string,
      'x-request-source': 'local',
    };
    const metadata = getOAuthClientMetadata();

    const userInfoRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}&alt=json`, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'x-request-source': 'local' },
    });
    const userInfo = userInfoRes.ok ? ((await userInfoRes.json()) as Record<string, unknown>) : {};

    let projectId = '';
    let tierId = 'legacy-tier';
    try {
      const loadRes = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint as string, {
        method: 'POST',
        headers: loadHeaders,
        body: JSON.stringify({ metadata }),
      });
      if (loadRes.ok) {
        const data = (await loadRes.json()) as Record<string, unknown>;
        const proj = data.cloudaicompanionProject;
        projectId = typeof proj === 'string' ? proj : (proj as Record<string, unknown>)?.id as string || '';
        if (Array.isArray(data.allowedTiers)) {
          for (const tier of data.allowedTiers as Array<Record<string, unknown>>) {
            if (tier.isDefault && tier.id) {
              tierId = (tier.id as string).trim();
              break;
            }
          }
        }
      }
    } catch { /* ignore */ }

    // Fire-and-forget onboarding
    if (projectId) {
      const doOnboard = async () => {
        for (let i = 0; i < 10; i++) {
          try {
            const onboardRes = await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint as string, {
              method: 'POST',
              headers: loadHeaders,
              body: JSON.stringify({ tierId, metadata }),
            });
            if (onboardRes.ok) {
              const result = (await onboardRes.json()) as Record<string, unknown>;
              if (result.done === true) break;
            }
          } catch {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      };
      doOnboard().catch(() => {});
    }

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

export default antigravity;
export { ANTIGRAVITY_CONFIG };
