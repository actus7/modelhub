import { describe, expect, it } from 'vitest';

import {
  generatePKCE,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  hashState,
} from './oauth/pkce';

import {
  decodeJwtPayload,
  extractEmailFromAccessToken,
  decodeXaiIdTokenEmail,
  extractCodexAccountInfo,
  extractJsonPath,
  assertValidAwsRegion,
} from './oauth/helpers';

import { encryptCredential, decryptCredential } from './crypto';

import { getProvider, getProviderNames } from './oauth/providers';

// ─── PKCE ───────────────────────────────────────────────────────────

describe('PKCE generation', () => {
  it('generates verifier, challenge, and state', () => {
    const { codeVerifier, codeChallenge, state } = generatePKCE();
    expect(codeVerifier).toBeTruthy();
    expect(codeChallenge).toBeTruthy();
    expect(state).toBeTruthy();
    // verifier is base64url, 43 chars for 32 bytes
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // challenge is base64url SHA-256
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // state is base64url, 43 chars for 32 bytes
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('verifier and challenge are different', () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    expect(codeVerifier).not.toBe(codeChallenge);
  });

  it('generates unique values on each call', () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state).not.toBe(b.state);
  });

  it('supports custom byte length (xAI uses 96)', () => {
    const verifier = generateCodeVerifier(96);
    // 96 bytes → 128 base64 chars → 128 base64url chars (no padding)
    expect(verifier.length).toBe(128);
  });

  it('challenge is deterministic from verifier', () => {
    const verifier = generateCodeVerifier();
    const c1 = generateCodeChallenge(verifier);
    const c2 = generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });
});

// ─── State Hashing ──────────────────────────────────────────────────

describe('hashState', () => {
  it('produces deterministic SHA-256 hex', () => {
    const state = 'test-state-value';
    const h1 = hashState(state);
    const h2 = hashState(state);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different states produce different hashes', () => {
    expect(hashState('a')).not.toBe(hashState('b'));
  });
});

// ─── Token Encryption Round-Trip ────────────────────────────────────

describe('token encryption round-trip', () => {
  it('encrypts and decrypts a token', () => {
    const plaintext = 'sk-test-access-token-12345';
    const encrypted = encryptCredential(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decryptCredential(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypted format is iv:ciphertext:tag', () => {
    const encrypted = encryptCredential('test');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    // iv is 12 bytes = 24 hex chars
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/);
    // tag is 16 bytes = 32 hex chars
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('different encryptions of same value produce different ciphertexts', () => {
    const a = encryptCredential('same-value');
    const b = encryptCredential('same-value');
    expect(a).not.toBe(b);
    // But both decrypt to the same value
    expect(decryptCredential(a)).toBe('same-value');
    expect(decryptCredential(b)).toBe('same-value');
  });

  it('handles empty-ish values gracefully', () => {
    // encryptCredential should work with any non-empty string
    const encrypted = encryptCredential('x');
    expect(decryptCredential(encrypted)).toBe('x');
  });
});

// ─── JWT Helpers ────────────────────────────────────────────────────

describe('decodeJwtPayload', () => {
  it('decodes a valid JWT payload', () => {
    // Build a minimal JWT: header.payload.signature
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ email: 'test@example.com', sub: 'user123' })).toString('base64url');
    const jwt = `${header}.${payload}.sig`;
    const decoded = decodeJwtPayload(jwt);
    expect(decoded).toEqual({ email: 'test@example.com', sub: 'user123' });
  });

  it('returns null for invalid JWT', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
  });
});

describe('extractEmailFromAccessToken', () => {
  it('extracts email from JWT', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ email: 'user@test.com' })).toString('base64url');
    const jwt = `${header}.${payload}.sig`;
    expect(extractEmailFromAccessToken(jwt)).toBe('user@test.com');
  });

  it('falls back to preferred_username', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ preferred_username: 'fallback@test.com' })).toString('base64url');
    const jwt = `${header}.${payload}.sig`;
    expect(extractEmailFromAccessToken(jwt)).toBe('fallback@test.com');
  });

  it('returns undefined for non-JWT', () => {
    expect(extractEmailFromAccessToken('opaque-token')).toBeUndefined();
  });
});

describe('decodeXaiIdTokenEmail', () => {
  it('returns undefined for non-JWT', () => {
    expect(decodeXaiIdTokenEmail(undefined)).toBeUndefined();
    expect(decodeXaiIdTokenEmail('not-jwt')).toBeUndefined();
  });
});

describe('extractCodexAccountInfo', () => {
  it('returns empty for invalid token', () => {
    expect(extractCodexAccountInfo(undefined)).toEqual({});
    expect(extractCodexAccountInfo('bad')).toEqual({});
  });

  it('extracts email and chatgpt claims', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        email: 'codex@test.com',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_123',
          chatgpt_plan_type: 'plus',
        },
      }),
    ).toString('base64url');
    const jwt = `${header}.${payload}.sig`;
    const info = extractCodexAccountInfo(jwt);
    expect(info.email).toBe('codex@test.com');
    expect(info.chatgptAccountId).toBe('acct_123');
    expect(info.chatgptPlanType).toBe('plus');
  });
});

// ─── JSON Path Extraction ───────────────────────────────────────────

describe('extractJsonPath', () => {
  it('extracts nested string value', () => {
    const obj = { Result: { LoginHost: 'https://login.example.com' } };
    expect(extractJsonPath(obj, [['Result', 'LoginHost']])).toBe('https://login.example.com');
  });

  it('tries multiple paths', () => {
    const obj = { data: { email: 'test@test.com' } };
    expect(extractJsonPath(obj, [['Result', 'Email'], ['data', 'email']])).toBe('test@test.com');
  });

  it('returns null when no path matches', () => {
    expect(extractJsonPath({}, [['a', 'b']])).toBeNull();
    expect(extractJsonPath(null, [['a']])).toBeNull();
  });

  it('converts numbers to strings', () => {
    expect(extractJsonPath({ count: 42 }, [['count']])).toBe('42');
  });
});

// ─── AWS Region Validation ──────────────────────────────────────────

describe('assertValidAwsRegion', () => {
  it('accepts valid regions', () => {
    expect(assertValidAwsRegion('us-east-1')).toBe('us-east-1');
    expect(assertValidAwsRegion('eu-west-2')).toBe('eu-west-2');
    expect(assertValidAwsRegion('ap-southeast-1')).toBe('ap-southeast-1');
  });

  it('rejects invalid regions', () => {
    expect(() => assertValidAwsRegion('')).toThrow('Invalid region');
    expect(() => assertValidAwsRegion('invalid')).toThrow('Invalid region');
    expect(() => assertValidAwsRegion('us-east-1; rm -rf /')).toThrow('Invalid region');
  });
});

// ─── Provider Registry ──────────────────────────────────────────────

describe('provider registry', () => {
  it('has all 22 providers', () => {
    const names = getProviderNames();
    expect(names).toHaveLength(22);
  });

  it('includes all expected providers', () => {
    const expected = [
      'claude', 'codex', 'xai', 'grok-cli', 'gemini-cli', 'antigravity',
      'iflow', 'qoder', 'github', 'gitlab', 'cline', 'clinepass',
      'kimchi', 'kilocode', 'kiro', 'cursor', 'kimi', 'codebuddy-cn',
      'codebuddy-intl', 'trae', 'zed', 'windsurf',
    ];
    const names = getProviderNames();
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it('each provider has a flowType and mapTokens', () => {
    for (const name of getProviderNames()) {
      const provider = getProvider(name);
      expect(provider.flowType).toBeTruthy();
      expect(typeof provider.mapTokens).toBe('function');
    }
  });

  it('kimi-coding alias resolves to kimi', () => {
    const provider = getProvider('kimi-coding');
    expect(provider.flowType).toBe('device_code');
  });

  it('throws for unknown provider', () => {
    expect(() => getProvider('nonexistent')).toThrow('Unknown provider');
  });

  it('authorization_code providers have buildAuthUrl', () => {
    const authCodeProviders = getProviderNames().filter((name) => {
      const p = getProvider(name);
      return p.flowType === 'authorization_code' || p.flowType === 'authorization_code_pkce';
    });
    for (const name of authCodeProviders) {
      const provider = getProvider(name);
      expect(typeof provider.buildAuthUrl).toBe('function');
    }
  });

  it('device_code providers have requestDeviceCode and pollToken', () => {
    const deviceProviders = getProviderNames().filter((name) => {
      return getProvider(name).flowType === 'device_code';
    });
    expect(deviceProviders.length).toBeGreaterThan(0);
    for (const name of deviceProviders) {
      const provider = getProvider(name);
      expect(typeof provider.requestDeviceCode).toBe('function');
      expect(typeof provider.pollToken).toBe('function');
    }
  });
});
