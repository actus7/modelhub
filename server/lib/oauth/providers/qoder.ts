/**
 * Qoder OAuth provider configuration.
 * Flow: Device Code (custom PKCE + nonce + machine_id)
 * Special: polls openapi.qoder.sh for dt-... token
 */

import { randomUUID, createHash, randomBytes } from 'node:crypto';
import type { BaseProviderConfig, DeviceCodeResult, OAuthProviderHandler } from '../types';

const QODER_CONFIG: BaseProviderConfig = {
  loginUrl: 'https://qoder.com/device/selectAccounts',
  deviceTokenUrl: 'https://openapi.qoder.sh/api/v1/deviceToken',
  userInfoUrl: 'https://openapi.qoder.sh/api/v1/user/profile',
};

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const qoder: OAuthProviderHandler = {
  flowType: 'device_code',

  async requestDeviceCode(config) {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const nonce = randomUUID();
    const machineId = randomUUID();

    const params = new URLSearchParams({
      challenge,
      challenge_method: 'S256',
      machine_id: machineId,
      nonce,
    });

    return {
      device_code: nonce,
      user_code: nonce.slice(0, 8).toUpperCase(),
      verification_uri: config.loginUrl as string,
      verification_uri_complete: `${config.loginUrl}?${params.toString()}`,
      expires_in: 300,
      interval: 2,
      codeVerifier: verifier,
      _qoderNonce: nonce,
      _qoderMachineId: machineId,
    } as DeviceCodeResult;
  },

  async pollToken(config, deviceCode, codeVerifier, extraData) {
    const nonce = deviceCode || (extraData?._qoderNonce as string);
    const verifier = codeVerifier || (extraData?._qoderVerifier as string);
    if (!nonce || !verifier) {
      return { ok: false, data: { error: 'invalid_request', error_description: 'Missing nonce/verifier' } };
    }

    const url = `${QODER_CONFIG.deviceTokenUrl}?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(verifier)}&challenge_method=S256`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), 15_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'Go-http-client/2.0' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 202 || response.status === 404) {
      return { ok: false, data: { error: 'authorization_pending' } };
    }

    const text = await response.text();
    if (!response.ok) {
      return { ok: false, data: { error: 'poll_failed', error_description: `HTTP ${response.status}` } };
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, data: { error: 'invalid_response' } };
    }

    if (!body.token) {
      return { ok: false, data: { error: 'no_token' } };
    }

    // Parse expiry
    const expiresAt = body.expires_at as string | number | undefined;
    const expiresInSeconds = body.expires_in as number | undefined;
    let expireMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
    if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0) {
      expireMs = expiresAt;
    } else if (typeof expiresAt === 'string' && /^\d+$/.test(expiresAt.trim())) {
      expireMs = parseInt(expiresAt.trim(), 10);
    } else if (typeof expiresInSeconds === 'number' && expiresInSeconds >= 0) {
      expireMs = Date.now() + expiresInSeconds * 1000;
    }

    const minSeconds = 24 * 60 * 60;
    const remainingSeconds = Math.floor((expireMs - Date.now()) / 1000);
    const expiresIn = Math.max(minSeconds, remainingSeconds);

    // Best-effort user info
    let userInfo: { name?: string; email?: string; organizationId?: string } = {};
    try {
      const userRes = await fetch(QODER_CONFIG.userInfoUrl as string, {
        headers: { Authorization: `Bearer ${body.token}`, Accept: 'application/json', 'User-Agent': 'Go-http-client/2.0' },
      });
      if (userRes.ok) {
        const u = (await userRes.json()) as Record<string, unknown>;
        userInfo = {
          name: ((u.name || u.username || '') as string).trim(),
          email: ((u.email || '') as string).trim(),
          organizationId: ((u.organization_id || '') as string).trim(),
        };
      }
    } catch { /* ignore */ }

    return {
      ok: true,
      data: {
        access_token: body.token,
        refresh_token: body.refresh_token || '',
        expires_in: expiresIn,
        _qoderUserId: body.user_id || '',
        _qoderMachineId: extraData?._qoderMachineId || '',
        _qoderName: userInfo.name,
        _qoderEmail: userInfo.email,
        _qoderOrganizationId: userInfo.organizationId,
      },
    };
  },

  mapTokens(tokens) {
    const rawEmail = ((tokens._qoderEmail as string) || '').trim();
    const displayName = ((tokens._qoderName as string) || '').trim() || null;
    const userId = (tokens._qoderUserId as string) || '';
    const email = rawEmail || (userId ? `qoder-user-${userId}` : null);
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      email,
      displayName,
      providerSpecificData: {
        authMethod: 'device',
        userId,
        machineId: (tokens._qoderMachineId as string) || '',
        organizationId: (tokens._qoderOrganizationId as string) || '',
      },
    };
  },
};

export default qoder;
export { QODER_CONFIG };
