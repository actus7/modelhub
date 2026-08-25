/**
 * Kiro OAuth provider configuration.
 * Flow: Device Code (AWS SSO OIDC)
 * Special: multi-method (Builder-ID, IDC, Google, GitHub)
 * Requires client registration first, then device authorization.
 */

import type { BaseProviderConfig, OAuthProviderHandler } from '../types';
import { assertValidAwsRegion, extractEmailFromAccessToken } from '../helpers';

const KIRO_CONFIG: BaseProviderConfig = {
  clientName: 'Kiro',
  clientType: 'public',
  scopes: ['codewhisperer:completions', 'codewhisperer:analysis'],
  grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
  issuerUrl: 'https://identitycenter.amazonaws.com',
  startUrl: 'https://kiro.awsapps.com/start',
};

const kiro: OAuthProviderHandler = {
  flowType: 'device_code',

  async requestDeviceCode(config, _codeChallenge, options) {
    const trimmedRegion = typeof options?.region === 'string' ? (options.region as string).trim() : '';
    const region = trimmedRegion || 'us-east-1';
    assertValidAwsRegion(region);
    const trimmedStartUrl = typeof options?.startUrl === 'string' ? (options.startUrl as string).trim() : '';
    const startUrl = trimmedStartUrl || (config.startUrl as string);
    const authMethod = options?.authMethod === 'idc' ? 'idc' : 'builder-id';

    const registerClientUrl = `https://oidc.${region}.amazonaws.com/client/register`;
    const deviceAuthUrl = `https://oidc.${region}.amazonaws.com/device_authorization`;

    // Step 1: Register client
    const registerRes = await fetch(registerClientUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        clientName: config.clientName,
        clientType: config.clientType,
        scopes: config.scopes,
        grantTypes: config.grantTypes,
        issuerUrl: config.issuerUrl,
      }),
    });
    if (!registerRes.ok) throw new Error(`Client registration failed: ${await registerRes.text()}`);
    const clientInfo = (await registerRes.json()) as Record<string, unknown>;

    // Step 2: Request device authorization
    const deviceRes = await fetch(deviceAuthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        clientId: clientInfo.clientId,
        clientSecret: clientInfo.clientSecret,
        startUrl,
      }),
    });
    if (!deviceRes.ok) throw new Error(`Device authorization failed: ${await deviceRes.text()}`);
    const deviceData = (await deviceRes.json()) as Record<string, unknown>;

    return {
      device_code: deviceData.deviceCode as string,
      user_code: deviceData.userCode as string,
      verification_uri: deviceData.verificationUri as string,
      verification_uri_complete: deviceData.verificationUriComplete as string,
      expires_in: deviceData.expiresIn as number,
      interval: (deviceData.interval as number) || 5,
      _clientId: clientInfo.clientId,
      _clientSecret: clientInfo.clientSecret,
      _region: region,
      _authMethod: authMethod,
      _startUrl: startUrl,
    };
  },

  async pollToken(_config, deviceCode, _codeVerifier, extraData) {
    const region = (extraData?._region as string) || 'us-east-1';
    assertValidAwsRegion(region);
    const tokenUrl = `https://oidc.${region}.amazonaws.com/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        clientId: extraData?._clientId,
        clientSecret: extraData?._clientSecret,
        deviceCode,
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      const text = await response.text();
      data = { error: 'invalid_response', error_description: text };
    }

    if (data.accessToken) {
      return {
        ok: true,
        data: {
          access_token: data.accessToken,
          refresh_token: data.refreshToken,
          expires_in: data.expiresIn,
          profile_arn: data.profileArn || null,
          _clientId: extraData?._clientId,
          _clientSecret: extraData?._clientSecret,
          _region: extraData?._region,
          _authMethod: extraData?._authMethod,
          _startUrl: extraData?._startUrl,
        },
      };
    }

    return {
      ok: false,
      data: {
        error: (data.error as string) || 'authorization_pending',
        error_description: (data.error_description as string) || (data.message as string),
      },
    };
  },

  mapTokens(tokens) {
    const email = extractEmailFromAccessToken(tokens.access_token as string);
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: (tokens.expires_in as number) || null,
      email,
      providerSpecificData: {
        profileArn: (tokens.profile_arn as string) || null,
        clientId: tokens._clientId,
        clientSecret: tokens._clientSecret,
        region: (tokens._region as string) || 'us-east-1',
        authMethod: (tokens._authMethod as string) || 'builder-id',
        startUrl: (tokens._startUrl as string) || KIRO_CONFIG.startUrl,
      },
    };
  },
};

export default kiro;
export { KIRO_CONFIG };
