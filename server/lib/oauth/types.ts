/**
 * Core types for the OAuth provider infrastructure.
 *
 * Ported from 9router with adaptations for Prisma/Postgres multi-tenant model.
 */

// ─── Flow Types ─────────────────────────────────────────────────────

/** OAuth flow type supported by a provider. */
export type FlowType =
  | 'authorization_code_pkce'
  | 'authorization_code'
  | 'device_code'
  | 'browser_token'
  | 'import_token';

// ─── Token Mapping ──────────────────────────────────────────────────

/** Standardized token result returned after exchange/poll. */
export interface MappedTokens {
  accessToken: string;
  refreshToken?: string | null;
  idToken?: string | null;
  expiresIn?: number | null;
  expiresAt?: string | null;
  scope?: string | null;
  email?: string | null;
  displayName?: string | null;
  name?: string | null;
  apiKey?: string | null;
  projectId?: string | null;
  providerSpecificData?: Record<string, unknown> | null;
}

// ─── Auth Data ──────────────────────────────────────────────────────

/** Result of generateAuthData — used to start an OAuth flow. */
export interface AuthData {
  authUrl: string | null;
  state: string;
  codeVerifier: string;
  codeChallenge?: string;
  redirectUri: string;
  flowType: FlowType;
  fixedPort?: number;
  callbackPath: string;
}

// ─── Device Code ────────────────────────────────────────────────────

/** Result of requestDeviceCode. */
export interface DeviceCodeResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  codeVerifier?: string;
  [key: string]: unknown;
}

/** Result of pollForToken. */
export interface PollTokenResult {
  success: boolean;
  tokens?: MappedTokens;
  error?: string;
  errorDescription?: string;
  pending?: boolean;
}

// ─── Provider Config ────────────────────────────────────────────────

/** Base provider configuration that all providers share. */
export interface BaseProviderConfig {
  [key: string]: unknown;
}

/** Provider handler interface — each provider implements this. */
export interface OAuthProviderHandler {
  flowType: FlowType;
  fixedPort?: number;
  callbackPath?: string;
  pkceVerifierBytes?: number;

  /** Optional: mutate config before use (e.g. discovery, key generation). */
  prepareConfig?(config: BaseProviderConfig, meta?: Record<string, unknown>): Promise<BaseProviderConfig>;

  /** Build the authorization URL (authorization_code flows). */
  buildAuthUrl?(
    config: BaseProviderConfig,
    redirectUri: string,
    state: string,
    codeChallenge?: string,
    meta?: Record<string, unknown>,
  ): string;

  /** Exchange authorization code for tokens (authorization_code flows). */
  exchangeToken?(
    config: BaseProviderConfig,
    code: string,
    redirectUri: string,
    codeVerifier?: string,
    state?: string,
    meta?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /** Request a device code (device_code flows). */
  requestDeviceCode?(
    config: BaseProviderConfig,
    codeChallenge?: string,
    options?: Record<string, unknown>,
  ): Promise<DeviceCodeResult>;

  /** Poll for token using device code (device_code flows). */
  pollToken?(
    config: BaseProviderConfig,
    deviceCode: string,
    codeVerifier?: string,
    extraData?: Record<string, unknown>,
  ): Promise<{ ok: boolean; data: Record<string, unknown> }>;

  /** Optional post-exchange hook (fetch user info, copilot tokens, etc.). */
  postExchange?(tokens: Record<string, unknown>): Promise<Record<string, unknown> | null>;

  /** Map raw token response to standardized MappedTokens. */
  mapTokens(tokens: Record<string, unknown>, extra?: Record<string, unknown> | null): MappedTokens;
}
