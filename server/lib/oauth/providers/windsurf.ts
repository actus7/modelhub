/**
 * Windsurf OAuth provider configuration.
 * Flow: Authorization Code (implicit token in callback → RegisterUser → apiKey)
 * Special: Firebase JWT → RegisterUser → apiKey used as credential
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';
import { extractJsonPath } from '../helpers';

const WINDSURF_CONFIG: BaseProviderConfig = {
  clientId: '3GUryQ7ldAeKEuD2obYnppsnmj58eP5u',
  authBaseUrl: 'https://www.windsurf.com',
  signInPath: '/windsurf/signin',
  registerApiBaseUrl: 'https://register.windsurf.com',
  registerPath: '/exa.seat_management_pb.SeatManagementService/RegisterUser',
  oneTimeAuthPath: '/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken',
  currentUserPath: '/exa.seat_management_pb.SeatManagementService/GetCurrentUser',
  defaultApiServerUrl: 'https://server.codeium.com',
  callbackPath: '/windsurf-auth-callback',
  userAgent: 'antigravity-cockpit-tools',
};

async function windsurfSeatRequest(baseUrl: string, path: string, body: Record<string, unknown>) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': WINDSURF_CONFIG.userAgent as string },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Windsurf ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`Windsurf ${path} invalid JSON`); }
}

function parseWindsurfCallback(raw: string, expectedState?: string) {
  const text = String(raw || '').trim();
  let queryStr = text;
  if (text.includes('?')) queryStr = text.slice(text.indexOf('?') + 1);
  if (text.startsWith('#')) queryStr = text.slice(1);
  const params = Object.fromEntries(new URLSearchParams(queryStr));
  const pick = (keys: string[]) => {
    for (const k of keys) { const v = params[k]; if (v && String(v).trim()) return String(v).trim(); }
    return null;
  };
  const err = pick(['error']);
  if (err) {
    const desc = pick(['error_description']);
    throw new Error(desc ? `Windsurf auth failed: ${err} (${desc})` : `Windsurf auth failed: ${err}`);
  }
  const accessToken = pick(['access_token', 'token']);
  if (!accessToken) throw new Error('Windsurf callback missing access_token');
  const state = pick(['state']);
  if (expectedState && state && state !== expectedState) throw new Error('Windsurf callback state mismatch');
  return { firebaseIdToken: accessToken };
}

async function fetchWindsurfRegisterUser(firebaseIdToken: string) {
  const data = await windsurfSeatRequest(WINDSURF_CONFIG.registerApiBaseUrl as string, WINDSURF_CONFIG.registerPath as string, {
    firebase_id_token: firebaseIdToken,
  });
  const apiKey = extractJsonPath(data, [['apiKey'], ['api_key']]);
  if (!apiKey) throw new Error('Windsurf RegisterUser missing apiKey');
  const apiServerUrl = extractJsonPath(data, [['apiServerUrl'], ['api_server_url']]) || WINDSURF_CONFIG.defaultApiServerUrl as string;
  const name = extractJsonPath(data, [['name']]);
  return { apiKey, apiServerUrl, name };
}

async function fetchWindsurfUserInfo(apiServerUrl: string, firebaseIdToken: string) {
  try {
    const authRes = await windsurfSeatRequest(apiServerUrl, WINDSURF_CONFIG.oneTimeAuthPath as string, { firebaseIdToken });
    const authToken = extractJsonPath(authRes, [['authToken'], ['auth_token']]);
    if (!authToken) return { email: null, name: null };
    const userRes = await windsurfSeatRequest(apiServerUrl, WINDSURF_CONFIG.currentUserPath as string, { authToken, includeSubscription: true });
    const user = (userRes.user || userRes) as Record<string, unknown>;
    return {
      email: extractJsonPath(user, [['email']]),
      name: extractJsonPath(user, [['name']]),
    };
  } catch { return { email: null, name: null }; }
}

const windsurf: OAuthProviderHandler = {
  flowType: 'authorization_code',
  callbackPath: WINDSURF_CONFIG.callbackPath as string,

  buildAuthUrl(config, redirectUri, state) {
    const params = new URLSearchParams({
      response_type: 'token',
      client_id: config.clientId as string,
      redirect_uri: redirectUri,
      state,
      prompt: 'login',
      redirect_parameters_type: 'query',
      workflow: 'onboarding',
    });
    return `${config.authBaseUrl}${config.signInPath}?${params.toString()}`;
  },

  async exchangeToken(config, code, _redirectUri, _codeVerifier, state) {
    const trimmed = String(code || '').trim();
    const looksCallback = trimmed.includes('?') || trimmed.includes('access_token=');
    if (!looksCallback) {
      const clean = trimmed.replace(/^Bearer\s+/i, '');
      if (clean.startsWith('sk-ws-')) {
        return { accessToken: clean, refreshToken: null, expiresIn: null, apiServerUrl: WINDSURF_CONFIG.defaultApiServerUrl, firebaseIdToken: null, _authMethod: 'imported' } as unknown as Record<string, unknown>;
      }
      const reg = await fetchWindsurfRegisterUser(clean);
      return { accessToken: reg.apiKey, refreshToken: null, expiresIn: null, apiServerUrl: reg.apiServerUrl, firebaseIdToken: clean, _authMethod: 'imported' } as unknown as Record<string, unknown>;
    }
    const { firebaseIdToken } = parseWindsurfCallback(trimmed, state);
    const reg = await fetchWindsurfRegisterUser(firebaseIdToken);
    return { accessToken: reg.apiKey, refreshToken: null, expiresIn: null, apiServerUrl: reg.apiServerUrl, firebaseIdToken, _authMethod: 'oauth' } as unknown as Record<string, unknown>;
  },

  async postExchange(tokens) {
    if (!tokens.firebaseIdToken) return { userInfo: { email: null, name: null } };
    const info = await fetchWindsurfUserInfo(tokens.apiServerUrl as string, tokens.firebaseIdToken as string);
    return { userInfo: info };
  },

  mapTokens(tokens, extra) {
    const userInfo = extra?.userInfo as Record<string, unknown> | undefined;
    return {
      accessToken: tokens.accessToken as string,
      refreshToken: null,
      expiresIn: null,
      email: (userInfo?.email as string) || undefined,
      displayName: (userInfo?.name as string) || undefined,
      providerSpecificData: {
        authMethod: (tokens._authMethod as string) || 'oauth',
        apiServerUrl: tokens.apiServerUrl,
        firebaseIdToken: tokens.firebaseIdToken,
      },
    };
  },
};

export default windsurf;
export { WINDSURF_CONFIG };
