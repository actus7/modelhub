/**
 * Kimi Code OAuth provider configuration.
 * Flow: Device Code
 * Special: uses open-sse buildKimiHeaders for device identification
 */

import { randomUUID } from 'node:crypto';
import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const KIMI_CONFIG: BaseProviderConfig = {
  deviceCodeUrl: 'https://kimi.moonshot.cn/api/oauth/device/code',
  tokenUrl: 'https://kimi.moonshot.cn/api/oauth/token',
  clientId: process.env.KIMI_OAUTH_CLIENT_ID || 'kimi-cli',
  authorizeDeviceUrl: 'https://www.kimi.com/code/authorize_device',
};

const kimi: OAuthProviderHandler = {
  flowType: 'device_code',

  async requestDeviceCode(config) {
    const deviceId = randomUUID();
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'X-Device-Id': deviceId,
    };
    const response = await fetch(config.deviceCodeUrl as string, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ client_id: config.clientId as string }),
    });
    if (!response.ok) throw new Error(`Device code request failed: ${await response.text()}`);
    const data = (await response.json()) as Record<string, unknown>;
    const authorizeDeviceUrl = (config.authorizeDeviceUrl as string) || 'https://www.kimi.com/code/authorize_device';
    return {
      device_code: data.device_code as string,
      user_code: data.user_code as string,
      verification_uri: (data.verification_uri as string) || authorizeDeviceUrl,
      verification_uri_complete:
        (data.verification_uri_complete as string) || `${authorizeDeviceUrl}?user_code=${data.user_code}`,
      expires_in: data.expires_in as number,
      interval: (data.interval as number) || 5,
      _kimiDeviceId: deviceId,
    };
  },

  async pollToken(config, deviceCode, _codeVerifier, extraData) {
    const deviceId = extraData?._kimiDeviceId as string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (deviceId) headers['X-Device-Id'] = deviceId;

    const response = await fetch(config.tokenUrl as string, {
      method: 'POST',
      headers,
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: config.clientId as string,
        device_code: deviceCode,
      }),
    });

    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      data = { error: 'invalid_response', error_description: 'non-json token response' };
    }

    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      return { ok: true, data };
    }
    if (data.access_token && deviceId) data._kimiDeviceId = deviceId;
    return { ok: response.ok || !!data.access_token || !!data.error, data };
  },

  mapTokens(tokens) {
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      providerSpecificData: {
        authMethod: 'device_code',
        ...(tokens._kimiDeviceId ? { deviceId: tokens._kimiDeviceId } : {}),
      },
    };
  },
};

export default kimi;
export { KIMI_CONFIG };
