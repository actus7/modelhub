import { describe, expect, it } from 'vitest'
import { detectTaskCategory } from './task-detector'

const msg = (content: string) => [{ role: 'user', content }]

describe('detectTaskCategory', () => {
  it('returns null for unrelated message', () => {
    const result = detectTaskCategory(msg('Tell me a joke.'))
    expect(result).toBeNull()
  })

  it('detects coding category', () => {
    const result = detectTaskCategory(msg('Write a Python function to parse JSON.'))
    expect(result).not.toBeNull()
    expect(result?.category).toBe('coding')
  })

  it('detects data_analysis category', () => {
    const result = detectTaskCategory(msg('Analyze this dataset and compute statistics.'))
    expect(result?.category).toBe('data_analysis')
  })

  it('detects email category', () => {
    const result = detectTaskCategory(msg('Draft an email to my manager requesting a day off.'))
    expect(result?.category).toBe('email')
  })

  it('detects calendar category', () => {
    const result = detectTaskCategory(msg('Schedule a meeting for tomorrow at 3pm.'))
    expect(result?.category).toBe('calendar')
  })

  it('detects image_generation category', () => {
    const result = detectTaskCategory(msg('Generate an image of a sunset over mountains.'))
    expect(result?.category).toBe('image_generation')
  })

  it('detects web_browsing category', () => {
    const result = detectTaskCategory(msg('Search the web for recent news about AI.'))
    expect(result?.category).toBe('web_browsing')
  })

  it('detects trading category', () => {
    const result = detectTaskCategory(msg('What is the current price of Bitcoin?'))
    expect(result?.category).toBe('trading')
  })

  it('returns high confidence for tool name prefix match', () => {
    const result = detectTaskCategory(msg('Send a message'), ['gmail_send', 'gmail_read'])
    expect(result?.category).toBe('email')
    expect(result?.confidence).toBe(0.95)
  })

  it('returns confidence above threshold for clear keyword match', () => {
    const result = detectTaskCategory(msg('Write code to implement a binary search algorithm.'))
    expect(result?.confidence).toBeGreaterThanOrEqual(0.4)
  })

  it('Portuguese email detection works', () => {
    const result = detectTaskCategory(msg('Escreva um email para meu chefe pedindo férias.'))
    expect(result?.category).toBe('email')
  })
})
