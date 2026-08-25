import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock Prisma before importing the module — use vi.hoisted to make mocks available
const { mockProviderConnection, mockOAuthTransaction } = vi.hoisted(() => ({
  mockProviderConnection: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  mockOAuthTransaction: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('./db', () => ({
  prisma: {
    providerConnection: mockProviderConnection,
    oAuthTransaction: mockOAuthTransaction,
  },
}));

// Mock crypto to use real encryption (ENCRYPTION_KEY is set in vitest.setup.ts)
vi.mock('./crypto', async () => {
  const actual = await vi.importActual<typeof import('./crypto')>('./crypto');
  return actual;
});

import {
  createConnection,
  getConnections,
  getActiveConnection,
  updateConnection,
  deleteConnection,
  createOAuthTransaction,
  consumeOAuthTransaction,
  expireOAuthTransactions,
} from './provider-connections';
import { hashState } from './oauth/pkce';
import { encryptCredential } from './crypto';

// Helper to create a mock connection row with properly encrypted accessToken
function mockConnectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    userId: 'user-1',
    providerId: 'claude',
    label: 'Account 1',
    authType: 'oauth',
    isActive: true,
    priority: 0,
    email: null,
    displayName: null,
    accessToken: encryptCredential('mock-access-token'),
    refreshToken: null,
    idToken: null,
    apiKey: null,
    expiresIn: 3600,
    expiresAt: null,
    lastRefreshAt: null,
    scope: null,
    providerSpecificData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Connection CRUD ────────────────────────────────────────────────

describe('createConnection', () => {
  it('auto-generates label when not provided', async () => {
    mockProviderConnection.count.mockResolvedValue(2);
    mockProviderConnection.create.mockResolvedValue(mockConnectionRow({ label: 'Account 3' }));

    const result = await createConnection({
      userId: 'user-1',
      providerId: 'claude',
      authType: 'oauth',
      accessToken: 'test-token',
    });

    expect(mockProviderConnection.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', providerId: 'claude' },
    });
    expect(result.label).toBe('Account 3');
  });

  it('uses provided label', async () => {
    mockProviderConnection.create.mockResolvedValue(mockConnectionRow({ label: 'My Account' }));

    const result = await createConnection({
      userId: 'user-1',
      providerId: 'claude',
      label: 'My Account',
      authType: 'oauth',
      accessToken: 'test-token',
    });

    expect(result.label).toBe('My Account');
    expect(mockProviderConnection.count).not.toHaveBeenCalled();
  });
});

describe('getConnections', () => {
  it('returns decrypted connections', async () => {
    mockProviderConnection.findMany.mockResolvedValue([
      mockConnectionRow({ email: 'test@test.com' }),
    ]);

    const results = await getConnections('user-1');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('conn-1');
  });

  it('filters by providerId when provided', async () => {
    mockProviderConnection.findMany.mockResolvedValue([]);
    await getConnections('user-1', 'claude');
    expect(mockProviderConnection.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', providerId: 'claude' },
      orderBy: expect.any(Array),
    });
  });
});

describe('getActiveConnection', () => {
  it('returns null when no active connection', async () => {
    mockProviderConnection.findFirst.mockResolvedValue(null);
    const result = await getActiveConnection('user-1', 'claude');
    expect(result).toBeNull();
  });

  it('queries with isActive=true and priority desc', async () => {
    mockProviderConnection.findFirst.mockResolvedValue(null);
    await getActiveConnection('user-1', 'claude');
    expect(mockProviderConnection.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', providerId: 'claude', isActive: true },
      orderBy: { priority: 'desc' },
    });
  });
});

describe('updateConnection', () => {
  it('encrypts accessToken on update', async () => {
    mockProviderConnection.update.mockResolvedValue(mockConnectionRow());

    await updateConnection('conn-1', 'user-1', { accessToken: 'new-token' });

    expect(mockProviderConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: expect.objectContaining({
        accessToken: expect.objectContaining({ set: expect.any(String) }),
      }),
    });
  });
});

describe('deleteConnection', () => {
  it('deletes with userId filter', async () => {
    mockProviderConnection.deleteMany.mockResolvedValue({ count: 1 });
    await deleteConnection('conn-1', 'user-1');
    expect(mockProviderConnection.deleteMany).toHaveBeenCalledWith({
      where: { id: 'conn-1', userId: 'user-1' },
    });
  });
});

// ─── OAuth Transaction Lifecycle ────────────────────────────────────

describe('createOAuthTransaction', () => {
  it('creates transaction with hashed state', async () => {
    mockOAuthTransaction.create.mockResolvedValue({});

    await createOAuthTransaction({
      userId: 'user-1',
      providerId: 'claude',
      state: 'my-state-value',
      codeVerifier: 'my-verifier',
      flowType: 'authorization_code_pkce',
    });

    expect(mockOAuthTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stateHash: hashState('my-state-value'),
        flowType: 'authorization_code_pkce',
      }),
    });
  });
});

describe('consumeOAuthTransaction', () => {
  it('returns null for non-existent state', async () => {
    mockOAuthTransaction.findFirst.mockResolvedValue(null);
    const result = await consumeOAuthTransaction('bad-state', 'user-1');
    expect(result).toBeNull();
  });

  it('consumes transaction atomically', async () => {
    mockOAuthTransaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      providerId: 'claude',
      codeVerifier: null,
      deviceCode: null,
      redirectUri: 'http://localhost:3000/callback',
      flowType: 'authorization_code_pkce',
      meta: null,
    });
    mockOAuthTransaction.update.mockResolvedValue({});

    const result = await consumeOAuthTransaction('valid-state', 'user-1');

    expect(result).toBeTruthy();
    expect(result!.providerId).toBe('claude');
    expect(mockOAuthTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { consumed: { set: true } },
    });
  });
});

describe('expireOAuthTransactions', () => {
  it('deletes expired transactions', async () => {
    mockOAuthTransaction.deleteMany.mockResolvedValue({ count: 5 });
    const count = await expireOAuthTransactions();
    expect(count).toBe(5);
    expect(mockOAuthTransaction.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });
});

// ─── User Isolation ─────────────────────────────────────────────────

describe('user isolation', () => {
  it('getConnections filters by userId', async () => {
    mockProviderConnection.findMany.mockResolvedValue([]);
    await getConnections('user-1');
    expect(mockProviderConnection.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: expect.any(Array),
    });
  });

  it('getActiveConnection filters by userId', async () => {
    mockProviderConnection.findFirst.mockResolvedValue(null);
    await getActiveConnection('user-1', 'claude');
    expect(mockProviderConnection.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', providerId: 'claude', isActive: true },
      orderBy: { priority: 'desc' },
    });
  });

  it('consumeOAuthTransaction filters by userId', async () => {
    mockOAuthTransaction.findFirst.mockResolvedValue(null);
    await consumeOAuthTransaction('state', 'user-1');
    expect(mockOAuthTransaction.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'user-1' }),
    });
  });
});
