import { describe, expect, it } from 'vitest'
import { scoreComplexity } from './complexity-scorer'

const msg = (content: string) => [{ role: 'user', content }]

describe('scoreComplexity', () => {
  it('returns simple tier for short casual messages', () => {
    const result = scoreComplexity(msg('Hi, how are you?'))
    expect(result.tier).toBe('simple')
  })

  it('returns simple tier for empty messages', () => {
    const result = scoreComplexity([])
    expect(result.tier).toBe('simple')
    expect(result.rawScore).toBe(0)
  })

  it('returns standard tier for medium-length question', () => {
    const result = scoreComplexity(msg(
      'Can you write a short Python function to reverse a string and explain what it does?'
    ))
    expect(['simple', 'standard']).toContain(result.tier)
  })

  it('detects code_block signal for fenced code', () => {
    const result = scoreComplexity(msg(
      'Debug this:\n```typescript\nconst x = 1\nconst y = 2\nconsole.log(x + y)\n```'
    ))
    expect(result.signals).toContain('code_block')
  })

  it('detects math_notation signal for LaTeX', () => {
    const result = scoreComplexity(msg('Solve $$\\int_0^1 x^2 dx$$ and also prove that the result is correct.'))
    expect(result.signals).toContain('math_notation')
    expect(result.rawScore).toBeGreaterThanOrEqual(15)
  })

  it('detects multi_step signal', () => {
    const result = scoreComplexity(msg('Explain step by step how to implement a B-tree.'))
    expect(result.signals).toContain('multi_step')
  })

  it('returns reasoning tier for complex multi-signal prompt', () => {
    const complexPrompt = `
      Analyze and prove that the following algorithm is correct and has O(n log n) complexity.
      Walk me through each step. Also, compare it to quicksort and evaluate trade-offs.
      $$T(n) = 2T(n/2) + \\Theta(n)$$
      Consider using dynamic programming if applicable.
    `
    const result = scoreComplexity(msg(complexPrompt))
    expect(['complex', 'reasoning']).toContain(result.tier)
    expect(result.rawScore).toBeGreaterThan(40)
  })

  it('detects formal_logic signal', () => {
    const result = scoreComplexity(msg('Therefore, we can conclude that P implies Q.'))
    expect(result.signals).toContain('formal_logic')
  })

  it('detects planning signal', () => {
    const result = scoreComplexity(msg('Design a system architecture for a distributed key-value store.'))
    expect(result.signals).toContain('planning')
  })

  it('scores increase with conversation depth', () => {
    const shallow = scoreComplexity([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ])
    const deep = scoreComplexity(
      Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'Some message',
      }))
    )
    expect(deep.rawScore).toBeGreaterThan(shallow.rawScore)
  })
})
