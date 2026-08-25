/**
 * iFlow OAuth provider configuration.
 * Flow: Authorization Code with Basic Auth
 * Special: fetches user info + API key after auth
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const IFLOW_CONFIG: BaseProviderConfig = {
  authorizeUrl: 'https://iflow.cc/oauth/authorize',
  tokenUrl: 'https://iflow.cc/oauth/token',
  clientId: process.env.IFLOW_OAUTH_CLIENT_ID || '',
  clientSecret: process.env.IFLOW_OAUTH_CLIENT_SECRET || '',
  userInfoUrl: 'https://iflow.cc/api/user/info',
  extraParams: { loginMethod: 'email', type: 'oauth' },
};

const iflow: OAuthProviderHandler = {
  flowType: 'authorization_code',

  buildAuthUrl(config, redirectUri, state) {
    const extraParams = config.extraParams as Record<string, string>;
    const params = new URLSearchParams({
      loginMethod: extraParams.loginMethod,
      type: extraParams.type,
      redirect: redirectUri,
      state,
      client_id: config.clientId as string,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },

  async exchangeToken(config, code, redirectUri) {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const response = await fetch(config.tokenUrl as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId as string,
        client_secret: config.clientSecret as string,
      }),
    });
    if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
    return (await response.json()) as Record<string, unknown>;
  },

  async postExchange(tokens) {
    const userInfoRes = await fetch(
      `${IFLOW_CONFIG.userInfoUrl}?accessToken=${encodeURIComponent(tokens.access_token as string)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!userInfoRes.ok) throw new Error(`Failed to fetch user info: ${await userInfoRes.text()}`);
    const result = (await userInfoRes.json()) as { success: boolean; message?: string; data?: Record<string, unknown> };
    if (!result.success) throw new Error(`User info request failed: ${result.message || 'Unknown error'}`);
    const userInfo = result.data || {};
    if (!userInfo.apiKey || (userInfo.apiKey as string).trim() === '') {
      throw new Error('Empty API key returned from iFlow');
    }
    const email = (userInfo.email as string)?.trim() || (userInfo.phone as string)?.trim();
    if (!email) throw new Error('Missing account email/phone in user info');
    return { userInfo };
  },

  mapTokens(tokens, extra) {
    const userInfo = extra?.userInfo as Record<string, unknown> | undefined;
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      apiKey: userInfo?.apiKey as string | undefined,
      email: (userInfo?.email as string) || (userInfo?.phone as string) || undefined,
      displayName: (userInfo?.nickname as string) || (userInfo?.name as string) || undefined,
    };
  },
};

export default iflow;
export { IFLOW_CONFIG };
