/**
 * Cursor OAuth provider configuration.
 * Flow: Import Token (from local SQLite database)
 * No OAuth flow needed - tokens are extracted from Cursor IDE's state.vscdb
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';

const CURSOR_CONFIG: BaseProviderConfig = {
  clientVersion: '0.45.0',
  clientType: 'desktop',
};

const cursor: OAuthProviderHandler = {
  flowType: 'import_token',

  mapTokens(tokens) {
    return {
      accessToken: tokens.accessToken as string,
      refreshToken: null,
      expiresIn: (tokens.expiresIn as number) || 86400,
      providerSpecificData: {
        machineId: tokens.machineId,
        authMethod: 'imported',
      },
    };
  },
};

export default cursor;
export { CURSOR_CONFIG };
