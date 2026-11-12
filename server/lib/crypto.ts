/**
 * Módulo de criptografia para proteção de credenciais e API keys.
 *
 * - Credenciais de provedores: AES-256-GCM (IV 12 bytes, tag 16 bytes)
 * - API Keys: PBKDF2-HMAC-SHA256 com `ENCRYPTION_KEY` como pepper (determinístico)
 */

import "../env";

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";

// ─── Configurações ──────────────────────────────────────────────────

const AES_ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const API_KEY_KDF_DIGEST = "sha256";
const API_KEY_KDF_ITERATIONS = 210_000;
const API_KEY_DERIVED_KEY_BYTES = 32;

/** Chave mestra para encriptar credenciais. DEVE ser definida em produção. */
function getEncryptionKey(): Buffer {
  const raw = process.env["ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error("ENCRYPTION_KEY env var is required for credential encryption");
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)");
  }
  return buf;
}

// ─── Credenciais de provedores (AES-256-GCM) ───────────────────────

/** Encripta um valor. Retorna `iv:ciphertext:tag` em hex */
export function encryptCredential(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${encrypted}:${tag}`;
}

/** Decripta um valor armazenado no formato `iv:ciphertext:tag` */
export function decryptCredential(stored: string): string {
  const key = getEncryptionKey();
  const [ivHex, cipherHex, tagHex] = stored.split(":");
  if (!ivHex || !cipherHex || !tagHex) {
    throw new Error("Invalid encrypted credential format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  let decrypted = decipher.update(cipherHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ─── API Keys ──────────────────────────────────────────────────────

/** Gera uma API Key raw e retorna { raw, hash, prefix } */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `sk-${randomBytes(32).toString("hex")}`;
  const hash = hashApiKey(raw);
  const prefix = raw.slice(0, 11); // "sk-" + 8 chars
  return { raw, hash, prefix };
}

/**
 * Faz hash determinístico de uma API key para armazenamento/lookup.
 *
 * Usa PBKDF2 com `ENCRYPTION_KEY` como pepper: alto custo computacional contra
 * brute-force (resolve o alerta de CodeQL) e saída estável para o mesmo input,
 * viabilizando `findFirst({ where: { key: hashApiKey(token) } })`.
 */
export function hashApiKey(raw: string): string {
  const pepper = getEncryptionKey();
  const derived = pbkdf2Sync(
    raw,
    pepper,
    API_KEY_KDF_ITERATIONS,
    API_KEY_DERIVED_KEY_BYTES,
    API_KEY_KDF_DIGEST,
  );
  return `pbkdf2_${API_KEY_KDF_DIGEST}$${API_KEY_KDF_ITERATIONS}$${derived.toString("hex")}`;
}
