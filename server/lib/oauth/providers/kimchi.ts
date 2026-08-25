/**
 * Kimchi OAuth provider configuration.
 * Flow: Browser Token (validation-based)
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const KIMCHI_CONFIG: BaseProviderConfig = {
  webAppUrl: 'https://app.kimchi.dev',
  validationUrl: 'https://api.cast.ai/v1/llm/openai/supported-providers',
  userInfoUrl: 'https://api.cast.ai/v1/user',
};

const kimchi: OAuthProviderHandler = {
  flowType: 'browser_token',

  buildAuthUrl(config, redirectUri, state) {
    const baseUrl = ((config.webAppUrl as string) || 'https://app.kimchi.dev').replace(/\/+$/, '');
    const params = new URLSearchParams({ callback: redirectUri, state });
    return `${baseUrl}/cli-auth?${params.toString()}`;
  },

  async exchangeToken(config, token) {
    const accessToken = String(token || '').trim();
    if (!accessToken) throw new Error('Missing Kimchi token');

    const validationRes = await fetch(config.validationUrl as string, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    if (!validationRes.ok) throw new Error(`Kimchi token validation failed: ${validationRes.status}`);

    let userInfo: Record<string, unknown> = {};
    if (config.userInfoUrl) {
      try {
        const userRes = await fetch(config.userInfoUrl as string, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) userInfo = (await userRes.json()) as Record<string, unknown>;
      } catch {
        userInfo = {};
      }
    }

    return { access_token: accessToken, token_type: 'Bearer', _kimchiUser: userInfo };
  },

  mapTokens(tokens) {
    const user = (tokens._kimchiUser as Record<string, unknown>) || {};
    const userId = user.id ? String(user.id) : '';
    const username = (user.username as string) || '';
    const email = (user.email as string) || (userId ? `kimchi-user-${userId}` : null);
    return {
      accessToken: tokens.access_token as string,
      refreshToken: null,
      email,
      displayName: (user.name as string) || username || null,
      providerSpecificData: { authMethod: 'browser_token', userId, username },
    };
  },
};

export default kimchi;
export { KIMCHI_CONFIG };
