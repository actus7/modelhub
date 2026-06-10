import { createHash } from 'node:crypto'

import { scrubSecrets } from './secret-scrub'

/**
 * Troca de token em 2 estágios do GitHub Copilot (padrão portado do Manifest:
 * packages/backend/src/routing/proxy/copilot-token.service.ts).
 *
 * Tokens Copilot (`tid=...`) expiram em ~30 minutos, então guardar um deles
 * como credencial quebra rápido. Em vez disso o usuário fornece o token OAuth
 * do GitHub de longa duração (gho_/ghu_/ghp_/github_pat_) e nós trocamos por
 * um token Copilot curto sob demanda:
 *   1. GET https://api.github.com/copilot_internal/v2/token
 *      Header: Authorization: token <github_oauth_token>
 *   2. Resposta: { "token": "tid=...", "expires_at": <unix_seconds> }
 *   3. Usar o token retornado como Bearer contra api.githubcopilot.com
 */

const TOKEN_ENDPOINT = 'https://api.github.com/copilot_internal/v2/token'

/** Margem de segurança: renova 2 minutos antes da expiração real. */
const EXPIRY_BUFFER_MS = 2 * 60 * 1000

const GITHUB_TOKEN_RE = /^(gho_|ghu_|ghp_|ghs_|github_pat_)/

type CachedToken = {
  token: string
  expiresAt: number
}

/** Cache em memória keyed pelo hash do token GitHub (evita reter o token cru como chave). */
const cache = new Map<string, CachedToken>()

function cacheKey(githubToken: string): string {
  return createHash('sha256').update(githubToken).digest('base64url')
}

function evictExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) cache.delete(key)
  }
}

export function isGithubOAuthToken(token: string): boolean {
  return GITHUB_TOKEN_RE.test(token)
}

/** Limpa o cache — apenas para testes. */
export function clearCopilotTokenCache(): void {
  cache.clear()
}

async function exchange(githubToken: string): Promise<CachedToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'GET',
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`[copilot] token exchange failed: ${res.status} ${scrubSecrets(body).slice(0, 300)}`)
    throw new Error(`Copilot token exchange failed: ${res.status}`)
  }

  const data = (await res.json()) as { token?: string; expires_at?: number }
  if (!data.token || !data.expires_at) {
    throw new Error('Invalid Copilot token exchange response')
  }

  return { token: data.token, expiresAt: data.expires_at * 1000 }
}

/**
 * Resolve a credencial Copilot: tokens GitHub de longa duração são trocados
 * (com cache) por um token Copilot curto; qualquer outro valor (ex.: um token
 * `tid=...` colado direto) passa intacto.
 */
export async function resolveCopilotToken(rawToken: string): Promise<string> {
  if (!isGithubOAuthToken(rawToken)) return rawToken

  const key = cacheKey(rawToken)
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && now < cached.expiresAt - EXPIRY_BUFFER_MS) {
    return cached.token
  }

  evictExpired(now)
  const result = await exchange(rawToken)
  cache.set(key, result)
  return result.token
}
