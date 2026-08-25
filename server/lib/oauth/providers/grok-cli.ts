/**
 * Grok CLI OAuth provider configuration.
 * Flow: Device Code
 * Special: fetches user profile from cli-chat-proxy.grok.com after auth
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';
import { decodeXaiIdTokenEmail, extractEmailFromAccessToken } from '../helpers';

const GROK_CLI_CONFIG: BaseProviderConfig = {
  deviceCodeUrl: 'https://auth.x.ai/oauth2/device/code',
  tokenUrl: 'https://auth.x.ai/oauth2/token',
  clientId: process.env.GROK_CLI_OAUTH_CLIENT_ID || '',
  scope: 'openid profile email offline_access grok-cli:access api:access',
  referrer: 'grok-build',
};

const grokCli: OAuthProviderHandler = {
  flowType: 'device_code',

  async requestDeviceCode(config) {
    const body = new URLSearchParams({
      client_id: config.clientId as string,
      scope: config.scope as string,
    });
    if (config.referrer) body.set('referrer', config.referrer as string);

    const response = await fetch(config.deviceCodeUrl as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)',
      },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Grok CLI device code request failed: ${error}`);
    }

    return (await response.json()) as import('../types').DeviceCodeResult;
  },

  async pollToken(config, deviceCode) {
    const response = await fetch(config.tokenUrl as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: config.clientId as string,
      }),
    });

    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      const text = await response.text();
      data = { error: 'invalid_response', error_description: text };
    }

    const pending = data?.error === 'authorization_pending' || data?.error === 'slow_down';
    return { ok: response.ok || pending, data };
  },

  async postExchange(tokens) {
    try {
      const res = await fetch('https://cli-chat-proxy.grok.com/v1/user', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
          'User-Agent': 'grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)',
          'x-xai-token-auth': 'xai-grok-cli',
          'x-grok-client-version': '0.2.93',
        },
      });
      if (res.ok) return { user: (await res.json()) as Record<string, unknown> };
    } catch {
      /* ignore */
    }
    return { user: null };
  },

  mapTokens(tokens, extra) {
    const user = extra?.user as Record<string, unknown> | undefined;
    const email =
      decodeXaiIdTokenEmail(tokens.id_token as string | undefined) ||
      extractEmailFromAccessToken(tokens.access_token as string) ||
      (user?.email as string) ||
      null;
    const userId = (user?.userId || user?.principalId || null) as string | null;
    const displayName =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || null;

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
      : null;

    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      expiresAt,
      scope: (tokens.scope as string) || null,
      email: email || undefined,
      displayName: displayName || undefined,
      providerSpecificData: {
        authMethod: 'device_code',
        idToken: (tokens.id_token as string) || null,
        email: email || null,
        userId,
        hasGrokCodeAccess: (user?.hasGrokCodeAccess as boolean) ?? null,
        subscriptionTier: (user?.subscriptionTier as string) ?? null,
      },
    };
  },
};

export default grokCli;
export { GROK_CLI_CONFIG };
