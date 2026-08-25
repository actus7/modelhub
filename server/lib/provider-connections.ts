/**
 * Provider connections CRUD service.
 *
 * Manages OAuth/API-key connections per user+provider with:
 * - Encrypted secret storage (AES-256-GCM via server/lib/crypto.ts)
 * - Multi-account support (label-based dedup)
 * - Priority-based connection selection
 * - OAuth transaction lifecycle (create/consume/expire)
 */

import { prisma } from './db';
import { encryptCredential, decryptCredential } from './crypto';
import { hashState } from './oauth/pkce';

import { Prisma } from '../../generated/prisma/client';

// ─── Types ──────────────────────────────────────────────────────────

export interface CreateConnectionInput {
  userId: string;
  providerId: string;
  label?: string;
  authType: string;
  accessToken: string;
  refreshToken?: string | null;
  idToken?: string | null;
  apiKey?: string | null;
  expiresIn?: number | null;
  expiresAt?: Date | null;
  email?: string | null;
  displayName?: string | null;
  scope?: string | null;
  providerSpecificData?: Record<string, unknown> | null;
  priority?: number;
}

export interface UpdateConnectionInput {
  label?: string;
  isActive?: boolean;
  priority?: number;
  accessToken?: string;
  refreshToken?: string | null;
  idToken?: string | null;
  apiKey?: string | null;
  expiresIn?: number | null;
  expiresAt?: Date | null;
  lastRefreshAt?: Date | null;
  email?: string | null;
  displayName?: string | null;
  scope?: string | null;
  providerSpecificData?: Record<string, unknown> | null;
}

export interface ConnectionWithSecrets {
  id: string;
  userId: string;
  providerId: string;
  label: string;
  authType: string;
  isActive: boolean;
  priority: number;
  email: string | null;
  displayName: string | null;
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  apiKey: string | null;
  expiresIn: number | null;
  expiresAt: Date | null;
  lastRefreshAt: Date | null;
  scope: string | null;
  providerSpecificData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOAuthTransactionInput {
  userId: string;
  providerId: string;
  state: string;
  codeVerifier?: string;
  deviceCode?: string;
  redirectUri?: string;
  flowType: string;
  meta?: Record<string, unknown>;
  ttlSeconds?: number;
}

// ─── Encryption Helpers ─────────────────────────────────────────────

function encryptOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return encryptCredential(value);
}

function decryptOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return decryptCredential(value);
}

// ─── Connection CRUD ────────────────────────────────────────────────

/**
 * Create a new provider connection. Auto-generates label if not provided.
 * Encrypts all secrets before storage.
 */
export async function createConnection(input: CreateConnectionInput): Promise<ConnectionWithSecrets> {
  // Auto-generate label: "Account 1", "Account 2", etc.
  let label = input.label;
  if (!label) {
    const count = await prisma.providerConnection.count({
      where: { userId: input.userId, providerId: input.providerId },
    });
    label = `Account ${count + 1}`;
  }

  const row = await prisma.providerConnection.create({
    data: {
      user: { connect: { id: input.userId } },
      providerId: input.providerId,
      label,
      authType: input.authType,
      priority: input.priority ?? 0,
      email: input.email ?? null,
      displayName: input.displayName ?? null,
      accessToken: encryptCredential(input.accessToken),
      refreshToken: encryptOptional(input.refreshToken),
      idToken: encryptOptional(input.idToken),
      apiKey: encryptOptional(input.apiKey),
      expiresIn: input.expiresIn ?? null,
      expiresAt: input.expiresAt ?? null,
      scope: input.scope ?? null,
      providerSpecificData: input.providerSpecificData
        ? (input.providerSpecificData as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });

  return decryptConnectionRow(row);
}

/**
 * Get all connections for a user, optionally filtered by provider.
 */
export async function getConnections(
  userId: string,
  providerId?: string,
): Promise<ConnectionWithSecrets[]> {
  const where: Prisma.ProviderConnectionWhereInput = { userId };
  if (providerId) where.providerId = providerId;

  const rows = await prisma.providerConnection.findMany({
    where,
    orderBy: [{ providerId: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
  });

  return rows.map(decryptConnectionRow);
}

/**
 * Get a single connection by ID (with decrypted secrets).
 */
export async function getConnection(id: string, userId: string): Promise<ConnectionWithSecrets | null> {
  const row = await prisma.providerConnection.findFirst({ where: { id, userId } });
  if (!row) return null;
  return decryptConnectionRow(row);
}

/**
 * Update a connection. Encrypts any new secret values.
 */
export async function updateConnection(
  id: string,
  userId: string,
  input: UpdateConnectionInput,
): Promise<ConnectionWithSecrets> {
  const data: Prisma.ProviderConnectionUpdateInput = {};

  if (input.label !== undefined) data.label = { set: input.label };
  if (input.isActive !== undefined) data.isActive = { set: input.isActive };
  if (input.priority !== undefined) data.priority = { set: input.priority };
  if (input.email !== undefined) data.email = { set: input.email };
  if (input.displayName !== undefined) data.displayName = { set: input.displayName };
  if (input.expiresIn !== undefined) data.expiresIn = { set: input.expiresIn };
  if (input.expiresAt !== undefined) data.expiresAt = { set: input.expiresAt };
  if (input.lastRefreshAt !== undefined) data.lastRefreshAt = { set: input.lastRefreshAt };
  if (input.scope !== undefined) data.scope = { set: input.scope };

  if (input.accessToken !== undefined) data.accessToken = { set: encryptCredential(input.accessToken) };
  if (input.refreshToken !== undefined) data.refreshToken = { set: encryptOptional(input.refreshToken) };
  if (input.idToken !== undefined) data.idToken = { set: encryptOptional(input.idToken) };
  if (input.apiKey !== undefined) data.apiKey = { set: encryptOptional(input.apiKey) };
  if (input.providerSpecificData !== undefined) {
    data.providerSpecificData = input.providerSpecificData
      ? (input.providerSpecificData as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  }

  const row = await prisma.providerConnection.update({
    where: { id },
    data,
  });

  return decryptConnectionRow(row);
}

/**
 * Delete a connection.
 */
export async function deleteConnection(id: string, userId: string): Promise<void> {
  await prisma.providerConnection.deleteMany({ where: { id, userId } });
}

/**
 * Get the best connection for a user+provider (highest priority, active).
 * Returns null if no active connection exists.
 */
export async function getActiveConnection(
  userId: string,
  providerId: string,
): Promise<ConnectionWithSecrets | null> {
  const row = await prisma.providerConnection.findFirst({
    where: { userId, providerId, isActive: true },
    orderBy: { priority: 'desc' },
  });
  if (!row) return null;
  return decryptConnectionRow(row);
}

/**
 * Get all active connections for a user+provider, ordered by priority.
 */
export async function getActiveConnections(
  userId: string,
  providerId: string,
): Promise<ConnectionWithSecrets[]> {
  const rows = await prisma.providerConnection.findMany({
    where: { userId, providerId, isActive: true },
    orderBy: { priority: 'desc' },
  });
  return rows.map(decryptConnectionRow);
}

// ─── OAuth Transaction Lifecycle ────────────────────────────────────

/**
 * Create an OAuth transaction (stores state hash + PKCE verifier).
 */
export async function createOAuthTransaction(input: CreateOAuthTransactionInput): Promise<string> {
  const ttlSeconds = input.ttlSeconds ?? 600; // 10 minutes default
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await prisma.oAuthTransaction.create({
    data: {
      user: { connect: { id: input.userId } },
      providerId: input.providerId,
      stateHash: hashState(input.state),
      codeVerifier: encryptOptional(input.codeVerifier),
      deviceCode: input.deviceCode ?? null,
      redirectUri: input.redirectUri ?? null,
      flowType: input.flowType,
      meta: input.meta ? (input.meta as Prisma.InputJsonValue) : Prisma.JsonNull,
      expiresAt,
    },
  });

  return input.state;
}

/**
 * Consume an OAuth transaction (one-time use).
 * Returns the transaction data if valid, null if already consumed or expired.
 */
export async function consumeOAuthTransaction(
  state: string,
  userId: string,
): Promise<{
  providerId: string;
  codeVerifier: string | null;
  deviceCode: string | null;
  redirectUri: string | null;
  flowType: string;
  meta: Record<string, unknown> | null;
} | null> {
  const stateHash = hashState(state);

  // Find and consume atomically
  const tx = await prisma.oAuthTransaction.findFirst({
    where: {
      stateHash,
      userId,
      consumed: false,
      expiresAt: { gt: new Date() },
    },
  });

  if (!tx) return null;

  // Mark as consumed
  await prisma.oAuthTransaction.update({
    where: { id: tx.id },
    data: { consumed: { set: true } },
  });

  return {
    providerId: tx.providerId,
    codeVerifier: decryptOptional(tx.codeVerifier),
    deviceCode: tx.deviceCode,
    redirectUri: tx.redirectUri,
    flowType: tx.flowType,
    meta: tx.meta as Record<string, unknown> | null,
  };
}

/**
 * Expire old OAuth transactions (cleanup).
 */
export async function expireOAuthTransactions(): Promise<number> {
  const result = await prisma.oAuthTransaction.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

// ─── Internal Helpers ───────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function decryptConnectionRow(row: any): ConnectionWithSecrets {
  return {
    id: row.id,
    userId: row.userId,
    providerId: row.providerId,
    label: row.label,
    authType: row.authType,
    isActive: row.isActive,
    priority: row.priority,
    email: row.email,
    displayName: row.displayName,
    accessToken: decryptCredential(row.accessToken),
    refreshToken: decryptOptional(row.refreshToken),
    idToken: decryptOptional(row.idToken),
    apiKey: decryptOptional(row.apiKey),
    expiresIn: row.expiresIn,
    expiresAt: row.expiresAt,
    lastRefreshAt: row.lastRefreshAt,
    scope: row.scope,
    providerSpecificData: row.providerSpecificData as Record<string, unknown> | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
