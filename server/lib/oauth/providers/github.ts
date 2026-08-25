/**
 * GitHub Copilot OAuth provider configuration.
 * Flow: Device Code
 * Special: exchanges GitHub token for Copilot token + fetches user info
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const GITHUB_CONFIG: BaseProviderConfig = {
  deviceCodeUrl: 'https://github.com/login/device/code',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  clientId: process.env.GITHUB_COPILOT_CLIENT_ID || 'Iv1.b507a01c84e6c4ef',
  scopes: 'read:user',
  copilotTokenUrl: 'https://api.github.com/copilot_internal/v2/token',
  userInfoUrl: 'https://api.github.com/user',
  apiVersion: '2022-11-28',
  userAgent: 'modelhub/1.0',
};

const github: OAuthProviderHandler = {
  flowType: 'device_code',

  async requestDeviceCode(config) {
    const response = await fetch(config.deviceCodeUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: config.clientId as string,
        scope: config.scopes as string,
      }),
    });
    if (!response.ok) throw new Error(`Device code request failed: ${await response.text()}`);
    return (await response.json()) as import('../types').DeviceCodeResult;
  },

  async pollToken(config, deviceCode) {
    const response = await fetch(config.tokenUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: config.clientId as string,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      const text = await response.text();
      data = { error: 'invalid_response', error_description: text };
    }

    return { ok: response.ok, data };
  },

  async postExchange(tokens) {
    const copilotRes = await fetch(GITHUB_CONFIG.copilotTokenUrl as string, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
        'X-GitHub-Api-Version': GITHUB_CONFIG.apiVersion as string,
        'User-Agent': GITHUB_CONFIG.userAgent as string,
      },
    });
    const copilotToken = copilotRes.ok ? ((await copilotRes.json()) as Record<string, unknown>) : {};

    const userRes = await fetch(GITHUB_CONFIG.userInfoUrl as string, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
        'X-GitHub-Api-Version': GITHUB_CONFIG.apiVersion as string,
        'User-Agent': GITHUB_CONFIG.userAgent as string,
      },
    });
    const userInfo = userRes.ok ? ((await userRes.json()) as Record<string, unknown>) : {};

    return { copilotToken, userInfo };
  },

  mapTokens(tokens, extra) {
    const userInfo = extra?.userInfo as Record<string, unknown> | undefined;
    const copilotToken = extra?.copilotToken as Record<string, unknown> | undefined;
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      name: (userInfo?.login as string) || (userInfo?.name as string) || undefined,
      displayName: (userInfo?.name as string) || (userInfo?.login as string) || undefined,
      email: (userInfo?.email as string) || null,
      providerSpecificData: {
        copilotToken: copilotToken?.token as string | undefined,
        copilotTokenExpiresAt: copilotToken?.expires_at as string | undefined,
        githubUserId: userInfo?.id as number | undefined,
        githubLogin: userInfo?.login as string | undefined,
        githubName: userInfo?.name as string | undefined,
        githubEmail: userInfo?.email as string | undefined,
      },
    };
  },
};

export default github;
export { GITHUB_CONFIG };
