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

  it('returns standard tier for a code generation request', () => {
    const result = scoreComplexity(msg(
      'Faça um exemplo em Python de pelo menos 10 linhas que envolva bastante custo computacional para executar.'
    ))
    expect(result.tier).toBe('standard')
  })

  it('returns standard tier for a comparison with recommendation', () => {
    const result = scoreComplexity(msg(
      'Compare REST e GraphQL para uma aplicação SaaS pequena. Dê prós, contras e recomendação.'
    ))
    expect(result.tier).toBe('standard')
  })

  it('returns complex tier for a multi-component architecture request', () => {
    const result = scoreComplexity(msg(
      'Desenhe uma arquitetura para um gateway multi-provider de IA com autenticação, rate limit, fallback, logs de uso e dashboard. Liste componentes, fluxos e riscos.'
    ))
    expect(result.tier).toBe('complex')
  })

  it('returns reasoning tier for a multi-objective decision request', () => {
    const result = scoreComplexity(msg(
      'Resolva passo a passo: tenho 3 provedores com custo, latência e taxa de erro diferentes. Como decidir dinamicamente qual modelo usar por tarefa, mantendo orçamento mensal e fallback seguro?'
    ))
    expect(result.tier).toBe('reasoning')
  })

  it('does not promote a simple step-by-step request to reasoning', () => {
    const result = scoreComplexity(msg('Explique passo a passo como ferver água.'))
    expect(result.tier).not.toBe('reasoning')
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

  it('routes autonomous iterative multi-agent creation to reasoning', () => {
    const result = scoreComplexity(msg(`
      Atue como um sistema multiagente autônomo de refinamento iterativo composto por dois papéis:
      Agente Criador e Agente Crítico. Crie o jogo fapibird.
      Realize 3 rodadas consecutivas. Em cada rodada apresente Crítica, Ajustes e Entrega.
      Encerre somente após a terceira rodada com o artefato totalmente polido.
    `))
    expect(result.tier).toBe('reasoning')
    expect(result.signals).toEqual(expect.arrayContaining([
      'autonomous_multi_agent',
      'iterative_refinement',
      'complex_deliverable',
      'autonomous_workflow_floor',
    ]))
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('routes the full Portuguese creator/critic workflow to reasoning', () => {
    const result = scoreComplexity(msg(`
      Atue como um sistema multiagente autônomo de refinamento iterativo composto por dois papéis:
      Agente Criador: Responsável por gerar o rascunho inicial e implementar todas as melhorias estruturais, visuais e conceituais exigidas a cada ciclo.
      Agente Crítico: Um revisor rigoroso e implacável de padrão "AAA" que não aceita soluções genéricas, superficiais ou incompletas. Seu foco é apontar falhas de profundidade, narrativa, acabamento, consistência e detalhes ausentes.
      Objetivo da tarefa: criar o jogo fapibird.
      Realize 3 rodadas consecutivas de refinamento autônomo. Em cada rodada, apresente Crítica, Ajustes e Entrega. O loop se encerra após a terceira rodada com a versão final totalmente polida e comentada.
    `))
    expect(result.tier).toBe('reasoning')
    expect(result.rawScore).toBeGreaterThanOrEqual(50)
    expect(result.signals).toEqual(expect.arrayContaining([
      'autonomous_multi_agent',
      'iterative_refinement',
      'quality_review',
      'autonomous_workflow_floor',
    ]))
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

  it('exclui system prompts do scoring (não infla para reasoning)', () => {
    const agentSystemPrompt = `You are a coding agent. Analyze trade-offs, evaluate architecture,
      use dynamic programming, recursion, memoization, optimization, neural network, cryptography.
      Therefore prove theorem axiom corollary. ${'x'.repeat(3000)}`
    const result = scoreComplexity([
      { role: 'system', content: agentSystemPrompt },
      { role: 'user', content: 'oi, tudo bem?' },
    ])
    expect(result.tier).toBe('simple')
  })

  it('detecta heartbeat e roteia para simple sem scoring', () => {
    const result = scoreComplexity(msg('HEARTBEAT_OK ping'))
    expect(result.tier).toBe('simple')
    expect(result.signals).toContain('heartbeat')
    expect(result.confidence).toBeGreaterThanOrEqual(0.99)
  })

  it('força reasoning quando há lógica formal na última mensagem', () => {
    const result = scoreComplexity(msg('Prove the theorem: if and only if P, therefore Q.'))
    expect(result.tier).toBe('reasoning')
    expect(result.signals).toContain('forced_reasoning')
    expect(result.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('força simple para mensagem curta sem sinais complexos', () => {
    const deepButShortLast = [
      ...Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'mensagem anterior da conversa',
      })),
      { role: 'user', content: 'ok, valeu!' },
    ]
    const result = scoreComplexity(deepButShortLast)
    expect(result.tier).toBe('simple')
    expect(result.signals).toContain('short_message')
  })

  it('aplica piso standard quando há tools ativas', () => {
    const result = scoreComplexity(msg('ok, valeu!'), { hasTools: true })
    expect(result.tier).toBe('standard')
    expect(result.signals).toContain('tools_floor')
  })

  it('não aplica tools_floor em heartbeat', () => {
    const result = scoreComplexity(msg('HEARTBEAT_OK'), { hasTools: true })
    expect(result.tier).toBe('simple')
  })

  it('aplica piso complex para contexto gigante', () => {
    const result = scoreComplexity([
      { role: 'user', content: 'a'.repeat(250_000) },
      { role: 'user', content: 'resuma' },
    ])
    expect(['complex', 'reasoning']).toContain(result.tier)
    expect(result.signals).toContain('large_context_floor')
  })

  it('retorna confidence entre 0 e 1', () => {
    const result = scoreComplexity(msg('Can you write a Python function to parse CSV files and explain it?'))
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })
})
