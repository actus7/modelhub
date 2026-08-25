/**
 * CodeBuddy CN (Tencent) OAuth provider configuration.
 * Flow: Device Code (browser OAuth polling)
 * Special: POST state → GET poll with state
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const CODEBUDDY_CN_CONFIG: BaseProviderConfig = {
  stateUrl: 'https://copilot.tencent.com/v2/plugin/auth/state',
  tokenUrl: 'https://copilot.tencent.com/v2/plugin/auth/token',
  platform: 'vscode',
  userAgent: 'CodeBuddy/1.0.0',
  pollInterval: 2000,
};

const codebuddyCn: OAuthProviderHandler = {
  flowType: 'device_code',

  async requestDeviceCode(config) {
    const response = await fetch(`${config.stateUrl}?platform=${config.platform}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': config.userAgent as string,
        'X-Requested-With': 'XMLHttpRequest',
        'X-Domain': 'copilot.tencent.com',
        'X-No-Authorization': 'true',
        'X-No-User-Id': 'true',
        'X-Product': 'SaaS',
      },
      body: '{}',
    });
    if (!response.ok) throw new Error(`CodeBuddy state request failed: ${await response.text()}`);
    const data = (await response.json()) as Record<string, unknown>;
    if (data.code !== 0 || !(data.data as Record<string, unknown>)?.state || !(data.data as Record<string, unknown>)?.authUrl) {
      throw new Error(`CodeBuddy state error: ${data.msg || 'missing state/authUrl'}`);
    }
    const inner = data.data as Record<string, unknown>;
    return {
      device_code: inner.state as string,
      verification_uri: inner.authUrl as string,
      user_code: '',
      interval: (config.pollInterval as number) / 1000,
      _isCodeBuddy: true,
    };
  },

  async pollToken(config, deviceCode) {
    const response = await fetch(`${config.tokenUrl}?state=${encodeURIComponent(deviceCode)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': config.userAgent as string,
        'X-Requested-With': 'XMLHttpRequest',
        'X-Domain': 'copilot.tencent.com',
        'X-No-Authorization': 'true',
        'X-No-User-Id': 'true',
        'X-No-Enterprise-Id': 'true',
        'X-No-Department-Info': 'true',
        'X-Product': 'SaaS',
      },
    });
    if (!response.ok) return { ok: false, data: { error: 'request_failed' } };
    const data = (await response.json()) as Record<string, unknown>;
    if (data.code === 0 && (data.data as Record<string, unknown>)?.accessToken) {
      const inner = data.data as Record<string, unknown>;
      return {
        ok: true,
        data: {
          access_token: inner.accessToken,
          refresh_token: inner.refreshToken || '',
          token_type: inner.tokenType || 'Bearer',
          expires_in: inner.expiresIn,
        },
      };
    }
    if (data.code === 11217) return { ok: true, data: { error: 'authorization_pending' } };
    return { ok: false, data: { error: (data.msg as string) || 'unknown_error' } };
  },

  mapTokens(tokens) {
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || 86400,
      providerSpecificData: {},
    };
  },
};

export default codebuddyCn;
export { CODEBUDDY_CN_CONFIG };
