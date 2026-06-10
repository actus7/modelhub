import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCopilotTokenCache, isGithubOAuthToken, resolveCopilotToken } from './copilot-token'

const fetchMock = vi.fn()

beforeEach(() => {
  clearCopilotTokenCache()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function tokenResponse(token: string, expiresInSeconds: number): Response {
  return new Response(
    JSON.stringify({ token, expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('isGithubOAuthToken', () => {
  it('reconhece prefixos de tokens GitHub', () => {
    expect(isGithubOAuthToken('gho_abc')).toBe(true)
    expect(isGithubOAuthToken('ghu_abc')).toBe(true)
    expect(isGithubOAuthToken('github_pat_abc')).toBe(true)
    expect(isGithubOAuthToken('tid=xyz')).toBe(false)
    expect(isGithubOAuthToken('sk-something')).toBe(false)
  })
})

describe('resolveCopilotToken', () => {
  it('passa tokens não-GitHub intactos sem chamar a rede', async () => {
    const result = await resolveCopilotToken('tid=already-a-copilot-token')
    expect(result).toBe('tid=already-a-copilot-token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('troca token GitHub por token Copilot e cacheia', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tid=short-lived', 1800))

    const first = await resolveCopilotToken('gho_longlived123')
    const second = await resolveCopilotToken('gho_longlived123')

    expect(first).toBe('tid=short-lived')
    expect(second).toBe('tid=short-lived')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/copilot_internal/v2/token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'token gho_longlived123' }),
      }),
    )
  })

  it('renova quando o token cacheado está perto de expirar', async () => {
    // expira em 60s — dentro do buffer de 2 min, então a segunda chamada renova
    fetchMock.mockResolvedValueOnce(tokenResponse('tid=first', 60))
    fetchMock.mockResolvedValueOnce(tokenResponse('tid=second', 1800))

    expect(await resolveCopilotToken('gho_tok')).toBe('tid=first')
    expect(await resolveCopilotToken('gho_tok')).toBe('tid=second')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('lança erro descritivo quando o exchange falha', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad credentials', { status: 401 }))
    await expect(resolveCopilotToken('gho_invalid')).rejects.toThrow('Copilot token exchange failed: 401')
  })

  it('lança erro quando a resposta não tem token', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await expect(resolveCopilotToken('gho_weird')).rejects.toThrow('Invalid Copilot token exchange response')
  })
})
