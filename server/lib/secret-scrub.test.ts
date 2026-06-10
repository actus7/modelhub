import { describe, expect, it } from 'vitest'

import { scrubSecrets } from './secret-scrub'

describe('scrubSecrets', () => {
  it('redige headers de autenticação ecoados em JSON', () => {
    const input = '{"x-api-key": "sk-ant-abcdef1234567890", "message": "unauthorized"}'
    const out = scrubSecrets(input)
    expect(out).not.toContain('sk-ant-abcdef1234567890')
    expect(out).toContain('[REDACTED]')
    expect(out).toContain('unauthorized')
  })

  it('redige tokens Bearer', () => {
    expect(scrubSecrets('Authorization: Bearer abc123def456ghi')).not.toContain('abc123def456ghi')
  })

  it('redige chaves de vendors (sk-, gsk_, xai-, gho_, AIza)', () => {
    const input = [
      'sk-proj-aaaaaaaaaaaaaaa',
      'gsk_bbbbbbbbbbbbbbb',
      'xai-ccccccccccccccc',
      'gho_ddddddddddddddd',
      'AIzaeeeeeeeeeeeeeee',
    ].join(' ')
    const out = scrubSecrets(input)
    expect(out).toBe('[REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED]')
  })

  it('redige key= em query strings', () => {
    expect(scrubSecrets('https://api.example.com/v1?key=secret123&x=1')).toContain('key=[REDACTED]')
  })

  it('redige campos OAuth opacos', () => {
    const out = scrubSecrets('{"refresh_token":"opaque-value-here"}')
    expect(out).not.toContain('opaque-value-here')
  })

  it('preserva texto sem segredos e trata null/undefined', () => {
    expect(scrubSecrets('erro comum 404 model not found')).toBe('erro comum 404 model not found')
    expect(scrubSecrets(null)).toBe('')
    expect(scrubSecrets(undefined)).toBe('')
  })
})
