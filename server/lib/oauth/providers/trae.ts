/**
 * Trae (ByteDance marscode) OAuth provider configuration.
 * Flow: Authorization Code (browser OAuth with GetLoginGuidance)
 * Special: multi-origin API, ExchangeToken, GetUserInfo
 */

import { randomUUID } from 'node:crypto';
import type { BaseProviderConfig, OAuthProviderHandler } from '../types';
import { extractJsonPath } from '../helpers';

const TRAE_CONFIG: BaseProviderConfig = {
  clientId: 'ono9krqynydwx5',
  clientSecret: '-',
  loginGuidanceUrls: [
    'https://api.marscode.com/cloudide/api/v3/trae/GetLoginGuidance',
    'https://api.trae.ai/cloudide/api/v3/trae/GetLoginGuidance',
    'https://www.trae.ai/cloudide/api/v3/trae/GetLoginGuidance',
  ],
  apiOrigins: [
    'https://api.marscode.com',
    'https://api.trae.ai',
    'https://www.trae.ai',
    'https://www.marscode.com',
  ],
  exchangeTokenPath: '/cloudide/api/v3/trae/oauth/ExchangeToken',
  getUserInfoPath: '/cloudide/api/v3/trae/GetUserInfo',
  authorizationPath: '/authorization',
  callbackPath: '/callback',
  defaultAppVersion: '3.5.54',
  defaultAppType: 'stable',
  defaultPluginVersion: 'local',
  defaultDeviceId: '0',
  userAgent: 'Trae/1.0.0 antigravity-cockpit-tools',
  tokenLifetimeDays: 14,
};

function buildTraeDeviceContext() {
  return {
    plugin_version: TRAE_CONFIG.defaultPluginVersion as string,
    machine_id: randomUUID(),
    device_id: TRAE_CONFIG.defaultDeviceId as string,
    x_device_brand: 'unknown',
    x_device_type: 'unknown',
    x_os_version: 'unknown',
    x_env: '',
    x_app_version: TRAE_CONFIG.defaultAppVersion as string,
    x_app_type: TRAE_CONFIG.defaultAppType as string,
  };
}

async function fetchTraeLoginGuidance(loginTraceId: string): Promise<string> {
  const body = JSON.stringify({ loginTraceID: loginTraceId, login_trace_id: loginTraceId });
  let lastErr = 'no successful response';
  for (const url of TRAE_CONFIG.loginGuidanceUrls as string[]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': TRAE_CONFIG.userAgent as string },
        body,
      });
      if (!res.ok) { lastErr = `${url} HTTP ${res.status}`; continue; }
      const data = (await res.json()) as Record<string, unknown>;
      const loginHost = extractJsonPath(data, [
        ['Result', 'LoginHost'], ['Result', 'loginHost'], ['Result', 'LoginURL'],
        ['result', 'loginHost'], ['data', 'Result', 'LoginHost'], ['data', 'loginHost'],
        ['LoginHost'], ['loginHost'],
      ]);
      if (loginHost) return loginHost;
      lastErr = `${url} missing LoginHost`;
    } catch (e) { lastErr = `${url} ${(e as Error).message}`; }
  }
  throw new Error(`Trae GetLoginGuidance failed: ${lastErr}`);
}

function buildTraeVerificationUrl(loginHost: string, loginTraceId: string, callbackUrl: string, ctx: ReturnType<typeof buildTraeDeviceContext>) {
  const url = new URL(loginHost.startsWith('http') ? loginHost : `https://${loginHost.replace(/^\/+/, '')}`);
  url.pathname = TRAE_CONFIG.authorizationPath as string;
  const p = new URLSearchParams();
  p.set('login_version', '1');
  p.set('auth_from', 'trae');
  p.set('login_channel', 'native_ide');
  p.set('plugin_version', ctx.plugin_version);
  p.set('auth_type', 'local');
  p.set('client_id', TRAE_CONFIG.clientId as string);
  p.set('redirect', '0');
  p.set('login_trace_id', loginTraceId);
  p.set('auth_callback_url', callbackUrl);
  p.set('machine_id', ctx.machine_id);
  p.set('device_id', ctx.device_id);
  p.set('x_device_id', ctx.device_id);
  p.set('x_machine_id', ctx.machine_id);
  p.set('x_device_brand', ctx.x_device_brand);
  p.set('x_device_type', ctx.x_device_type);
  p.set('x_os_version', ctx.x_os_version);
  p.set('x_env', ctx.x_env);
  p.set('x_app_version', ctx.x_app_version);
  p.set('x_app_type', ctx.x_app_type);
  url.search = p.toString();
  return url.toString();
}

function parseTraeCallback(raw: string) {
  const text = String(raw || '').trim();
  let queryStr = text;
  if (text.includes('?')) queryStr = text.slice(text.indexOf('?') + 1);
  if (text.startsWith('#')) queryStr = text.slice(1);
  const params = Object.fromEntries(new URLSearchParams(queryStr));
  const pick = (keys: string[]) => {
    for (const k of keys) { const v = params[k]; if (v && String(v).trim()) return String(v).trim(); }
    return null;
  };
  const err = pick(['error', 'error_code', 'errorCode']);
  if (err) {
    const desc = pick(['error_description', 'error_desc', 'message']);
    throw new Error(desc ? `Trae auth failed: ${err} (${desc})` : `Trae auth failed: ${err}`);
  }
  const refreshToken = pick(['refreshToken', 'refresh_token', 'RefreshToken']);
  if (!refreshToken) throw new Error('Trae callback missing refreshToken');
  const loginHost = pick(['loginHost', 'login_host', 'LoginHost', 'host', 'consoleHost']);
  if (!loginHost) throw new Error('Trae callback missing loginHost');
  const cloudideToken = pick(['x-cloudide-token', 'xCloudideToken', 'accessToken', 'access_token', 'token']);
  return { refreshToken, loginHost, cloudideToken };
}

function traeApiOrigins(): string[] {
  return [...(TRAE_CONFIG.apiOrigins as string[])];
}

async function fetchTraeExchangeToken(refreshToken: string, cloudideToken: string | null) {
  const body = JSON.stringify({ ClientID: TRAE_CONFIG.clientId, RefreshToken: refreshToken, ClientSecret: TRAE_CONFIG.clientSecret, UserID: '' });
  let lastErr = 'no successful response';
  for (const origin of traeApiOrigins()) {
    const url = `${origin.replace(/\/$/, '')}${TRAE_CONFIG.exchangeTokenPath}`;
    try {
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': TRAE_CONFIG.userAgent as string };
      if (cloudideToken) headers['x-cloudide-token'] = cloudideToken;
      const res = await fetch(url, { method: 'POST', headers, body });
      const text = await res.text();
      if (!res.ok) { lastErr = `${url} HTTP ${res.status}`; continue; }
      let data: Record<string, unknown>; try { data = JSON.parse(text) as Record<string, unknown>; } catch { lastErr = `${url} invalid JSON`; continue; }
      const accessToken = extractJsonPath(data, [['Result', 'AccessToken'], ['Result', 'accessToken'], ['result', 'access_token'], ['accessToken']]);
      if (!accessToken) { lastErr = `${url} missing AccessToken`; continue; }
      return {
        accessToken,
        refreshToken: extractJsonPath(data, [['Result', 'RefreshToken'], ['result', 'refresh_token'], ['refreshToken']]) || refreshToken,
        expiresIn: null,
        expiresAt: extractJsonPath(data, [['Result', 'ExpiresAt'], ['Result', 'expiresAt'], ['result', 'expires_at'], ['expiresAt']]),
      };
    } catch (e) { lastErr = `${url} ${(e as Error).message}`; }
  }
  throw new Error(`Trae ExchangeToken failed: ${lastErr}`);
}

async function fetchTraeUserInfo(accessToken: string) {
  for (const origin of traeApiOrigins()) {
    const url = `${origin.replace(/\/$/, '')}${TRAE_CONFIG.getUserInfoPath}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': TRAE_CONFIG.userAgent as string, 'x-cloudide-token': accessToken },
        body: JSON.stringify({}),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, unknown>;
      return {
        email: extractJsonPath(data, [['Result', 'NonPlainTextEmail'], ['Result', 'Email'], ['Result', 'email'], ['email'], ['data', 'email']]),
        name: extractJsonPath(data, [['Result', 'ScreenName'], ['Result', 'Nickname'], ['Result', 'Name'], ['result', 'nickname'], ['nickname'], ['name']]),
        aiRegion: extractJsonPath(data, [['Result', 'AIRegion'], ['Result', 'aiRegion'], ['aiRegion']]),
        region: extractJsonPath(data, [['Result', 'Region'], ['Result', 'region'], ['region']]),
        tenant: extractJsonPath(data, [['Result', 'TenantID'], ['Result', 'tenantId'], ['tenantId']]),
        userId: extractJsonPath(data, [['Result', 'UserID'], ['Result', 'userId'], ['userId']]),
      };
    } catch { /* try next origin */ }
  }
  return { email: null, name: null, aiRegion: null, region: null, tenant: null, userId: null };
}

function traeScopeForRegion(aiRegion: string | null): string {
  const r = (aiRegion || '').toLowerCase();
  if (r === 'sg' || r.includes('singapore')) return 'marscode-sg';
  if (r === 'cn' || r.includes('cn') || r.includes('china')) return 'marscode-cn';
  return 'marscode-us';
}

const trae: OAuthProviderHandler = {
  flowType: 'authorization_code',
  callbackPath: TRAE_CONFIG.callbackPath as string,

  async prepareConfig(config) {
    const loginTraceID = randomUUID();
    const loginHost = await fetchTraeLoginGuidance(loginTraceID);
    return { ...config, loginTraceID, loginHost };
  },

  buildAuthUrl(config, redirectUri, state) {
    const ctx = buildTraeDeviceContext();
    const traceId = (config.loginTraceID as string) || state;
    return buildTraeVerificationUrl(config.loginHost as string, traceId, redirectUri, ctx);
  },

  async exchangeToken(config, code) {
    const trimmed = String(code || '').trim();
    const looksCallback = /[?=&]/.test(trimmed) && (trimmed.includes('refreshToken') || trimmed.includes('refresh_token'));
    if (!looksCallback) {
      const clean = trimmed.replace(/^(Cloud-IDE-JWT|Bearer)\s+/i, '');
      return { accessToken: clean, refreshToken: null, expiresIn: (TRAE_CONFIG.tokenLifetimeDays as number) * 24 * 60 * 60, _authMethod: 'imported' } as unknown as Record<string, unknown>;
    }
    const { refreshToken, cloudideToken } = parseTraeCallback(trimmed);
    const result = await fetchTraeExchangeToken(refreshToken, cloudideToken);
    return { ...result, _authMethod: 'oauth' } as unknown as Record<string, unknown>;
  },

  async postExchange(tokens) {
    const userInfo = await fetchTraeUserInfo(tokens.accessToken as string);
    return { userInfo };
  },

  mapTokens(tokens, extra) {
    const expiresIn = (tokens.expiresIn as number)
      || (tokens.expiresAt ? Math.max(60, Number(tokens.expiresAt) - Math.floor(Date.now() / 1000)) : (TRAE_CONFIG.tokenLifetimeDays as number) * 24 * 60 * 60);
    const ui = (extra?.userInfo as Record<string, unknown>) || {};
    const aiRegion = (ui.aiRegion as string) || 'US-East';
    return {
      accessToken: tokens.accessToken as string,
      refreshToken: (tokens.refreshToken as string) || null,
      expiresIn,
      email: (ui.email as string) || undefined,
      displayName: (ui.name as string) || undefined,
      providerSpecificData: {
        authMethod: (tokens._authMethod as string) || 'oauth',
        aiRegion,
        region: (ui.region as string) || aiRegion,
        tenant: (ui.tenant as string) || 'marscode',
        userId: (ui.userId as string) || '',
        scope: traeScopeForRegion(aiRegion),
      },
    };
  },
};

export default trae;
export { TRAE_CONFIG };
