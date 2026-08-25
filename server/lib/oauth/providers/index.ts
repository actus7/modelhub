/**
 * OAuth provider registry — barrel export.
 *
 * All 22 providers are registered here. Provides getProvider, generateAuthData,
 * exchangeTokens, requestDeviceCode, pollForToken.
 */

import type { AuthData, BaseProviderConfig, DeviceCodeResult, FlowType, MappedTokens, OAuthProviderHandler, PollTokenResult } from '../types';
import { generatePKCE } from '../pkce';
import { fetchKiroProfileArn } from '../helpers';

import claude from './claude';
import codex from './codex';
import xai from './xai';
import grokCli from './grok-cli';
import geminiCli from './gemini-cli';
import antigravity from './antigravity';
import iflow from './iflow';
import qoder from './qoder';
import github from './github';
import gitlab from './gitlab';
import cline from './cline';
import clinepass from './clinepass';
import kimchi from './kimchi';
import kilocode from './kilocode';
import kiro from './kiro';
import cursor from './cursor';
import kimi from './kimi';
import codebuddyCn from './codebuddy-cn';
import codebuddyIntl from './codebuddy-intl';
import trae from './trae';
import zed from './zed';
import windsurf from './windsurf';

// ─── Provider Registry ──────────────────────────────────────────────

const PROVIDERS: Record<string, OAuthProviderHandler> = {
  claude,
  codex,
  xai,
  'grok-cli': grokCli,
  'gemini-cli': geminiCli,
  antigravity,
  iflow,
  qoder,
  github,
  kiro,
  cursor,
  kimi,
  kilocode,
  cline,
  clinepass,
  gitlab,
  'codebuddy-cn': codebuddyCn,
  'codebuddy-intl': codebuddyIntl,
  kimchi,
  trae,
  windsurf,
  zed,
};

// ─── Public API ─────────────────────────────────────────────────────

/** Get provider handler by name. */
export function getProvider(name: string): OAuthProviderHandler {
  // Legacy kimi-coding → kimi (dual-auth merge)
  const key = name === 'kimi-coding' ? 'kimi' : name;
  const provider = PROVIDERS[key];
  if (!provider) throw new Error(`Unknown provider: ${name}`);
  return provider;
}

/** Get all registered provider names. */
export function getProviderNames(): string[] {
  return Object.keys(PROVIDERS);
}

/** Get the full provider registry (read-only). */
export function getAllProviders(): Readonly<Record<string, OAuthProviderHandler>> {
  return PROVIDERS;
}

/**
 * Generate auth data for a provider.
 * Used to start an OAuth flow — returns the auth URL, state, PKCE verifier, etc.
 */
export async function generateAuthData(
  providerName: string,
  redirectUri: string,
  meta?: Record<string, unknown>,
): Promise<AuthData> {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig({} as BaseProviderConfig, meta || {})
    : ({} as BaseProviderConfig);

  const pkceBytes = provider.pkceVerifierBytes || 32;
  const { codeVerifier: pkceVerifier, codeChallenge, state: pkceState } = generatePKCE(pkceBytes);

  // Trae uses loginTraceID (set by prepareConfig) as the callback matcher
  const state = (config.loginTraceID as string) || pkceState;
  // Zed: codeVerifier carries the encoded RSA private key
  const codeVerifier = (config.privateKey as string) || pkceVerifier;

  let authUrl: string | null = null;
  if (provider.flowType === 'device_code') {
    authUrl = null;
  } else if (provider.flowType === 'authorization_code_pkce' && provider.buildAuthUrl) {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, codeChallenge, meta || {});
  } else if (provider.buildAuthUrl) {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, undefined, meta || {});
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || '/callback',
  };
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeTokens(
  providerName: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  state: string,
  meta?: Record<string, unknown>,
): Promise<MappedTokens> {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig({} as BaseProviderConfig, meta || {})
    : ({} as BaseProviderConfig);

  if (!provider.exchangeToken) throw new Error(`Provider ${providerName} does not support code exchange`);
  const tokens = await provider.exchangeToken(config, code, redirectUri, codeVerifier, state, meta || {});

  let extra: Record<string, unknown> | null = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

/**
 * Request device code (for device_code flow).
 */
export async function requestDeviceCode(
  providerName: string,
  codeChallenge?: string,
  options?: Record<string, unknown>,
): Promise<DeviceCodeResult> {
  const provider = getProvider(providerName);
  if (provider.flowType !== 'device_code') {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  if (!provider.requestDeviceCode) throw new Error(`Provider ${providerName} missing requestDeviceCode`);
  return await provider.requestDeviceCode({} as BaseProviderConfig, codeChallenge, options || {});
}

/**
 * Poll for token (for device_code flow).
 */
export async function pollForToken(
  providerName: string,
  deviceCode: string,
  codeVerifier?: string,
  extraData?: Record<string, unknown>,
): Promise<PollTokenResult> {
  const provider = getProvider(providerName);
  if (provider.flowType !== 'device_code') {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  if (!provider.pollToken) throw new Error(`Provider ${providerName} missing pollToken`);

  const result = await provider.pollToken({} as BaseProviderConfig, deviceCode, codeVerifier, extraData);

  if (result.ok) {
    if (result.data.access_token) {
      let extra: Record<string, unknown> | null = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data);
      }
      const tokens = provider.mapTokens(result.data, extra);
      // Kiro IDC/Builder-ID tokens lack profileArn; resolve it
      if (providerName === 'kiro' && !tokens.providerSpecificData?.profileArn) {
        const profileArn = await fetchKiroProfileArn(tokens.accessToken);
        if (profileArn) tokens.providerSpecificData = { ...tokens.providerSpecificData, profileArn };
      }
      return { success: true, tokens };
    } else {
      if (result.data.error === 'authorization_pending' || result.data.error === 'slow_down') {
        return {
          success: false,
          error: result.data.error as string,
          errorDescription: (result.data.error_description as string) || (result.data.message as string),
          pending: result.data.error === 'authorization_pending',
        };
      } else {
        return {
          success: false,
          error: (result.data.error as string) || 'no_access_token',
          errorDescription: (result.data.error_description as string) || (result.data.message as string) || 'No access token received',
        };
      }
    }
  }

  return { success: false, error: result.data.error as string, errorDescription: result.data.error_description as string };
}

export { PROVIDERS };
