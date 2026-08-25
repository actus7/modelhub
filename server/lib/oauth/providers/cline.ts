/**
 * Cline OAuth provider configuration.
 * Flow: Authorization Code (base64-encoded token in callback)
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const CLINE_CONFIG: BaseProviderConfig = {
  authorizeUrl: 'https://app.cline.bot/auth',
  tokenExchangeUrl: 'https://app.cline.bot/api/v1/auth/token',
};

const cline: OAuthProviderHandler = {
  flowType: 'authorization_code',

  buildAuthUrl(config, redirectUri) {
    const params = new URLSearchParams({
      client_type: 'extension',
      callback_url: redirectUri,
      redirect_uri: redirectUri,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },

  async exchangeToken(config, code, redirectUri) {
    try {
      // Cline encodes token data as base64 in the code param
      let base64 = code;
      const padding = 4 - (base64.length % 4);
      if (padding !== 4) base64 += '='.repeat(padding);
      const decoded = Buffer.from(base64, 'base64').toString('utf-8');
      const lastBrace = decoded.lastIndexOf('}');
      if (lastBrace === -1) throw new Error('No JSON found in decoded code');
      const tokenData = JSON.parse(decoded.substring(0, lastBrace + 1)) as Record<string, unknown>;
      return {
        access_token: tokenData.accessToken,
        refresh_token: tokenData.refreshToken,
        email: tokenData.email,
        firstName: tokenData.firstName,
        lastName: tokenData.lastName,
        expires_at: tokenData.expiresAt,
      };
    } catch {
      const response = await fetch(config.tokenExchangeUrl as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_type: 'extension',
          redirect_uri: redirectUri,
        }),
      });
      if (!response.ok) throw new Error(`Cline token exchange failed: ${await response.text()}`);
      const data = (await response.json()) as Record<string, unknown>;
      const inner = (data.data || data) as Record<string, unknown>;
      return {
        access_token: inner.accessToken,
        refresh_token: inner.refreshToken,
        email: (inner.userInfo as Record<string, unknown>)?.email || '',
        expires_at: inner.expiresAt,
      };
    }
  },

  mapTokens(tokens) {
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: tokens.expires_at
        ? Math.floor((new Date(tokens.expires_at as string).getTime() - Date.now()) / 1000)
        : 3600,
      email: tokens.email as string | undefined,
      providerSpecificData: { firstName: tokens.firstName, lastName: tokens.lastName },
    };
  },
};

export default cline;
export { CLINE_CONFIG };
