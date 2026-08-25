/**
 * KiloCode OAuth provider configuration.
 * Flow: Device Code (custom initiate/poll)
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const KILOCODE_CONFIG: BaseProviderConfig = {
  initiateUrl: 'https://kilocode.ai/api/auth/initiate-device',
  pollUrlBase: 'https://kilocode.ai/api/auth/device',
  apiBaseUrl: 'https://kilocode.ai',
};

const kilocode: OAuthProviderHandler = {
  flowType: 'device_code',

  async requestDeviceCode(config) {
    const response = await fetch(config.initiateUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('Too many pending authorization requests. Please try again later.');
      throw new Error(`Device auth initiation failed: ${await response.text()}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    return {
      device_code: data.code as string,
      user_code: data.code as string,
      verification_uri: data.verificationUrl as string,
      verification_uri_complete: data.verificationUrl as string,
      expires_in: (data.expiresIn as number) || 300,
      interval: 3,
    };
  },

  async pollToken(config, deviceCode) {
    const response = await fetch(`${config.pollUrlBase}/${deviceCode}`);
    if (response.status === 202) return { ok: false, data: { error: 'authorization_pending' } };
    if (response.status === 403) return { ok: false, data: { error: 'access_denied', error_description: 'Authorization denied by user' } };
    if (response.status === 410) return { ok: false, data: { error: 'expired_token', error_description: 'Authorization code expired' } };
    if (!response.ok) return { ok: false, data: { error: 'poll_failed', error_description: `Poll failed: ${response.status}` } };
    const data = (await response.json()) as Record<string, unknown>;
    if (data.status === 'approved' && data.token) {
      let orgId: string | null = null;
      try {
        const profileRes = await fetch(`${config.apiBaseUrl}/api/profile`, {
          headers: { Authorization: `Bearer ${data.token}` },
        });
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as Record<string, unknown>;
          const orgs = profile.organizations as Array<Record<string, unknown>> | undefined;
          orgId = (orgs?.[0]?.id as string) || null;
        }
      } catch { /* ignore */ }
      return { ok: true, data: { access_token: data.token, _userEmail: data.userEmail, _orgId: orgId } };
    }
    return { ok: false, data: { error: 'authorization_pending' } };
  },

  mapTokens(tokens) {
    return {
      accessToken: tokens.access_token as string,
      refreshToken: null,
      expiresIn: null,
      email: tokens._userEmail as string | undefined,
      ...(tokens._orgId ? { providerSpecificData: { orgId: tokens._orgId } } : {}),
    };
  },
};

export default kilocode;
export { KILOCODE_CONFIG };
