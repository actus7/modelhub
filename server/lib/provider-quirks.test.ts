import { describe, expect, it } from 'vitest'

import {
  DEEPSEEK_MAX_TOKENS_LIMIT,
  capMaxTokens,
  injectOpenRouterCacheControl,
  normalizeMistralToolCallIds,
  renameMaxTokensForOpenAi,
} from './provider-quirks'

describe('normalizeMistralToolCallIds', () => {
  it('mantém IDs já válidos ([A-Za-z0-9]{9})', () => {
    const body = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'abc123XYZ', type: 'function', function: { name: 'f', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'abc123XYZ', content: 'ok' },
      ],
    }
    normalizeMistralToolCallIds(body)
    const messages = body.messages as Array<Record<string, unknown>>
    expect((messages[0].tool_calls as Array<{ id: string }>)[0].id).toBe('abc123XYZ')
    expect(messages[1].tool_call_id).toBe('abc123XYZ')
  })

  it('reescreve IDs inválidos de forma consistente entre assistant e tool', () => {
    const body = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'call_invalid-long-id', type: 'function', function: { name: 'f', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_invalid-long-id', content: 'ok' },
      ],
    }
    normalizeMistralToolCallIds(body)
    const messages = body.messages as Array<Record<string, unknown>>
    const rewritten = (messages[0].tool_calls as Array<{ id: string }>)[0].id
    expect(rewritten).toMatch(/^[A-Za-z0-9]{9}$/)
    expect(messages[1].tool_call_id).toBe(rewritten)
  })

  it('não colide com IDs válidos pré-existentes', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          tool_calls: [
            { id: 'tc0000001', type: 'function', function: { name: 'a', arguments: '{}' } },
            { id: 'invalid!', type: 'function', function: { name: 'b', arguments: '{}' } },
          ],
        },
      ],
    }
    normalizeMistralToolCallIds(body)
    const toolCalls = (body.messages[0] as Record<string, unknown>).tool_calls as Array<{ id: string }>
    expect(toolCalls[0].id).toBe('tc0000001')
    expect(toolCalls[1].id).toMatch(/^[A-Za-z0-9]{9}$/)
    expect(toolCalls[1].id).not.toBe('tc0000001')
  })

  it('ignora body sem messages', () => {
    expect(normalizeMistralToolCallIds({})).toEqual({})
  })
})

describe('capMaxTokens', () => {
  it('reduz max_tokens acima do limite', () => {
    const body = capMaxTokens({ max_tokens: 32000 }, DEEPSEEK_MAX_TOKENS_LIMIT)
    expect(body.max_tokens).toBe(8192)
  })

  it('mantém max_tokens dentro do limite', () => {
    expect(capMaxTokens({ max_tokens: 1000 }, 8192).max_tokens).toBe(1000)
  })

  it('ignora body sem max_tokens', () => {
    expect(capMaxTokens({}, 8192).max_tokens).toBeUndefined()
  })
})

describe('renameMaxTokensForOpenAi', () => {
  it('renomeia para o-series', () => {
    const body = renameMaxTokensForOpenAi({ max_tokens: 4096 }, 'o3')
    expect(body.max_tokens).toBeUndefined()
    expect(body.max_completion_tokens).toBe(4096)
  })

  it('renomeia para gpt-5 com prefixo de provedor', () => {
    const body = renameMaxTokensForOpenAi({ max_tokens: 2048 }, 'copilot/gpt-5-mini')
    expect(body.max_tokens).toBeUndefined()
    expect(body.max_completion_tokens).toBe(2048)
  })

  it('não altera modelos gpt-4', () => {
    const body = renameMaxTokensForOpenAi({ max_tokens: 2048 }, 'gpt-4o')
    expect(body.max_tokens).toBe(2048)
    expect(body.max_completion_tokens).toBeUndefined()
  })

  it('preserva max_completion_tokens explícito', () => {
    const body = renameMaxTokensForOpenAi({ max_tokens: 100, max_completion_tokens: 200 }, 'o4-mini')
    expect(body.max_tokens).toBeUndefined()
    expect(body.max_completion_tokens).toBe(200)
  })
})

describe('injectOpenRouterCacheControl', () => {
  it('injeta cache_control na última mensagem system de modelos anthropic/*', () => {
    const body = {
      messages: [
        { role: 'system', content: 'instruções' },
        { role: 'user', content: 'oi' },
      ],
      tools: [{ type: 'function', function: { name: 'f' } }],
    }
    injectOpenRouterCacheControl(body, 'anthropic/claude-sonnet-4.6')
    const system = (body.messages as Array<Record<string, unknown>>)[0]
    expect(system.content).toEqual([
      { type: 'text', text: 'instruções', cache_control: { type: 'ephemeral' } },
    ])
    const tools = body.tools as Array<Record<string, unknown>>
    expect(tools[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('injeta no último bloco quando o content é array', () => {
    const body = {
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
      ],
    }
    injectOpenRouterCacheControl(body, 'anthropic/claude-haiku-4.5')
    const blocks = (body.messages[0] as Record<string, unknown>).content as Array<Record<string, unknown>>
    expect(blocks[0].cache_control).toBeUndefined()
    expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('não altera modelos de outros vendors', () => {
    const body = { messages: [{ role: 'system', content: 'x' }] }
    injectOpenRouterCacheControl(body, 'openai/gpt-4o')
    expect((body.messages[0] as Record<string, unknown>).content).toBe('x')
  })
})
