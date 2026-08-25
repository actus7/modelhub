/**
 * Zed OAuth provider configuration.
 * Flow: Authorization Code (RSA keypair native-app flow — NOT standard OAuth)
 * Special: generates ephemeral RSA-2048 keypair; user signs in at zed.dev;
 * Zed redirects to local callback with access_token RSA-encrypted against public key.
 */

import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const ZED_CONFIG: BaseProviderConfig = {
  webBaseUrl: 'https://zed.dev',
  cloudBaseUrl: 'https://cloud.zed.dev',
  llmBaseUrl: 'https://cloud.zed.dev',
  defaultNativeAppPort: 58443,
};

function createZedNativeAuthData(config: BaseProviderConfig, opts: { nativeAppPort: number }) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const systemId = `native-${Date.now()}`;
  const callbackUrl = `http://127.0.0.1:${opts.nativeAppPort}/`;
  const pubKeyB64 = Buffer.from(publicKey).toString('base64url');

  const authUrl = `${config.webBaseUrl}/native_app_signin?system_id=${encodeURIComponent(systemId)}&public_key=${encodeURIComponent(pubKeyB64)}&callback_url=${encodeURIComponent(callbackUrl)}`;

  return { authUrl, systemId, privateKey, publicKey };
}

function parseZedCallbackPayload(code: string): { userId: string; encryptedAccessToken: string } {
  const text = String(code || '').trim();
  let queryStr = text;
  if (text.includes('?')) queryStr = text.slice(text.indexOf('?') + 1);
  const params = Object.fromEntries(new URLSearchParams(queryStr));

  const userId = params.user_id || params.userId || '';
  const encryptedAccessToken = params.access_token || params.encrypted_access_token || '';
  if (!userId || !encryptedAccessToken) throw new Error('Zed callback missing user_id or access_token');
  return { userId, encryptedAccessToken };
}

function decryptZedAccessToken(encryptedB64: string, privateKeyPem: string): string {
  const encrypted = Buffer.from(encryptedB64, 'base64url');
  const decrypted = privateDecrypt(
    { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING },
    encrypted,
  );
  return decrypted.toString('utf8');
}

async function fetchZedAuthenticatedUser(credentials: { accessToken: string; providerSpecificData: Record<string, unknown> }, opts: { config: BaseProviderConfig }) {
  try {
    const res = await fetch(`${opts.config.cloudBaseUrl}/api/user`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveZedOrganizationId(credentials: { providerSpecificData: Record<string, unknown> }, userInfo: Record<string, unknown> | null): string {
  return (credentials.providerSpecificData?.organizationId as string) || (userInfo?.organization_id as string) || '';
}

const zed: OAuthProviderHandler = {
  flowType: 'authorization_code',
  callbackPath: '/',

  async prepareConfig(config, meta) {
    const nativeAppPort = Number(meta?.nativeAppPort) || (ZED_CONFIG.defaultNativeAppPort as number);
    const auth = createZedNativeAuthData(config, { nativeAppPort });
    return { ...config, ...auth };
  },

  buildAuthUrl(config) {
    return config.authUrl as string;
  },

  async exchangeToken(config, code, _redirectUri, codeVerifier) {
    const { userId, encryptedAccessToken } = parseZedCallbackPayload(code);
    const accessToken = decryptZedAccessToken(encryptedAccessToken, codeVerifier!);
    return { accessToken, userId, systemId: config.systemId };
  },

  async postExchange(tokens) {
    const credentials = {
      accessToken: tokens.accessToken as string,
      providerSpecificData: { userId: tokens.userId, systemId: tokens.systemId },
    };
    let userInfo: Record<string, unknown> | null = null;
    try {
      userInfo = await fetchZedAuthenticatedUser(credentials, { config: ZED_CONFIG });
    } catch { /* best-effort */ }
    const organizationId = resolveZedOrganizationId(credentials, userInfo);
    return {
      userInfo,
      organizationId,
      email: (userInfo?.email as string) || null,
      name: (userInfo?.name as string) || (userInfo?.display_name as string) || null,
    };
  },

  mapTokens(tokens, extra) {
    return {
      accessToken: tokens.accessToken as string,
      refreshToken: null,
      expiresIn: null,
      email: (extra?.email as string) || undefined,
      displayName: (extra?.name as string) || undefined,
      providerSpecificData: {
        authMethod: 'oauth',
        userId: tokens.userId,
        systemId: tokens.systemId,
        organizationId: (extra?.organizationId as string) || '',
      },
    };
  },
};

export default zed;
export { ZED_CONFIG };
