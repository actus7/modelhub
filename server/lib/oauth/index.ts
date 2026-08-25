/**
 * OAuth infrastructure — main barrel export.
 *
 * Re-exports everything needed by the rest of the application:
 * - Provider registry and helpers
 * - PKCE utilities
 * - Token/JWT helpers
 * - Types
 */

export type {
  FlowType,
  MappedTokens,
  AuthData,
  DeviceCodeResult,
  PollTokenResult,
  BaseProviderConfig,
  OAuthProviderHandler,
} from './types';

export { generatePKCE, generateCodeVerifier, generateCodeChallenge, generateState, hashState } from './pkce';

export {
  decodeJwtPayload,
  extractEmailFromAccessToken,
  decodeXaiIdTokenEmail,
  extractCodexAccountInfo,
  validateXaiOAuthEndpoint,
  extractJsonPath,
  assertValidAwsRegion,
  fetchKiroProfileArn,
} from './helpers';

export {
  getProvider,
  getProviderNames,
  getAllProviders,
  generateAuthData,
  exchangeTokens,
  requestDeviceCode,
  pollForToken,
  PROVIDERS,
} from './providers';
