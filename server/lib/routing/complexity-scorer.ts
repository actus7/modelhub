export type RoutingTier = 'simple' | 'standard' | 'complex' | 'reasoning'

export interface ComplexityScore {
  tier: RoutingTier
  rawScore: number
  signals: string[]
  /** Confiança [0,1] derivada da distância do score à fronteira de tier mais próxima. */
  confidence: number
}

export interface ScoreComplexityOptions {
  /** Quando a request traz tools ativas, o tier mínimo vira "standard". */
  hasTools?: boolean
}

// Limiares: 0-15=simple, 16-40=standard, 41-65=complex, >65=reasoning
const TIER_THRESHOLDS: Record<RoutingTier, number> = {
  simple: 15,
  standard: 40,
  complex: 65,
  reasoning: Infinity,
}

const TIER_ORDER: RoutingTier[] = ['simple', 'standard', 'complex', 'reasoning']

/**
 * Fronteiras numéricas entre tiers (para cálculo de confiança).
 * Derivadas de TIER_THRESHOLDS, excluindo o Infinity final.
 */
const TIER_BOUNDARIES = [TIER_THRESHOLDS.simple, TIER_THRESHOLDS.standard, TIER_THRESHOLDS.complex]

/** Sigmoide sobre a distância (em pontos) até a fronteira mais próxima. */
const CONFIDENCE_SIGMOID_K = 0.15

/**
 * Pings de keep-alive de agentes (ex.: OpenClaw) não devem consumir scoring
 * nem inflar estatísticas de complexidade.
 */
const HEARTBEAT_PATTERN = /\bHEARTBEAT_OK\b/

/** Mensagens curtas sem sinais complexos vão direto para "simple". */
const SHORT_MESSAGE_MAX_CHARS = 50

/** Contexto estimado acima disso (~50k tokens) força tier mínimo "complex". */
const LARGE_CONTEXT_FLOOR_CHARS = 200_000

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text: string } =>
        typeof p === 'object' &&
        p !== null &&
        'type' in p &&
        'text' in p &&
        (p as Record<string, unknown>).type === 'text' &&
        typeof (p as Record<string, unknown>).text === 'string',
      )
      .map((p) => p.text)
      .join('\n')
  }
  return ''
}

// Keywords por dimensão de raciocínio
const MULTI_STEP_KEYWORDS = [
  'step by step', 'passo a passo', 'first.*then', 'sequentially', 'sequencialmente',
  'prove that', 'prove ', 'demonstrate', 'demonstre', 'derive ', 'derive that',
  'walk me through', 'explain in detail', 'in depth', 'em detalhes',
]

const REASONING_KEYWORDS = [
  'analyze', 'analyse', 'analise', 'analise ', 'compare', 'contrast', 'evaluate', 'avalie',
  'justify', 'justifique', 'critique', 'critique ', 'debate', 'argue', 'argumente',
  'trade-off', 'pros and cons', 'prós e contras', 'tradeoff',
]

const MATH_PATTERNS = [
  /\$\$[\s\S]+?\$\$/,
  /\\\[[\s\S]+?\\\]/,
  /\\[a-z]+\{/,
  /\b(integral|derivative|matrix|eigenvalue|eigenvalues|fourier|laplace|gradient|divergence|curl|integral definida|derivada|matriz)\b/i,
  /[∑∫∂∇×·⊕⊗∈∉⊂⊆∪∩≤≥≠≈∞√π]/,
]

const CODE_PATTERN = /```[\s\S]{20,}/
const INLINE_CODE_PATTERN = /`[^`]+`/g

const PLANNING_KEYWORDS = [
  'design a system', 'architect', 'design pattern', 'best approach', 'best practice',
  'trade-off', 'architecture', 'arquitetura', 'como implementar', 'how to implement',
  'strategy', 'estratégia', 'plan for', 'planeje',
]

const DOMAIN_VOCABULARY = new Set([
  'cryptography', 'criptografia', 'concurrency', 'concorrência', 'distributed systems',
  'sistemas distribuídos', 'heuristic', 'heurística', 'polymorphism', 'polimorfismo',
  'recursion', 'recursão', 'dynamic programming', 'programação dinâmica',
  'backtracking', 'memoization', 'memoização', 'amortized', 'amortizado',
  'asymptotic', 'assintótico', 'byzantine', 'consensus', 'consenso',
  'turing complete', 'turing-complete', 'halting problem', 'lambda calculus',
  'monadic', 'functor', 'monad', 'algebraic', 'algebraico',
  'nondeterministic', 'probabilistic', 'probabilístico',
  'optimization', 'otimização', 'gradient descent', 'backpropagation',
  'transformer model', 'attention mechanism', 'neural network', 'rede neural',
])

const FORMAL_LOGIC_PATTERNS = [
  /\b(therefore|thus|hence|consequently|it follows that|portanto|logo|consequentemente)\b/i,
  /\b(iff|if and only if|se e somente se|bicondicional)\b/i,
  /∀|∃|¬|∧|∨|→|↔/,
  /\b(axiom|theorem|lemma|corollary|proof|qed|axioma|teorema|lema|corolário|prova|demonstração)\b/i,
]

function tierFromScore(score: number): RoutingTier {
  for (const tier of TIER_ORDER) {
    if (score <= TIER_THRESHOLDS[tier]) return tier
  }
  return 'reasoning'
}

/** Confiança baseada na distância do score à fronteira de tier mais próxima. */
function confidenceFromScore(score: number): number {
  const minDistance = Math.min(...TIER_BOUNDARIES.map((b) => Math.abs(score - b)))
  return Math.round((1 / (1 + Math.exp(-CONFIDENCE_SIGMOID_K * minDistance))) * 100) / 100
}

function floorTier(tier: RoutingTier, minimum: RoutingTier): RoutingTier {
  return TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(minimum) ? minimum : tier
}

export function scoreComplexity(
  messages: Array<{ role: string; content: unknown }>,
  options: ScoreComplexityOptions = {},
): ComplexityScore {
  if (!messages.length) return { tier: 'simple', rawScore: 0, signals: [], confidence: 1 }

  // System prompts de agentes (Kilo Code, Cline etc.) são densos em keywords
  // técnicas e inflariam toda request para "reasoning" — ficam fora do scoring.
  const scoreable = messages.filter((m) => m.role !== 'system' && m.role !== 'developer')
  if (!scoreable.length) return { tier: 'simple', rawScore: 0, signals: [], confidence: 1 }

  const lastUser = [...scoreable].reverse().find((m) => m.role === 'user')
  const lastText = lastUser ? extractText(lastUser.content) : ''
  const allText = scoreable.map((m) => extractText(m.content)).join('\n')

  // Heartbeat de agente: roteia direto para o tier mais barato sem scoring.
  if (HEARTBEAT_PATTERN.test(lastText)) {
    return { tier: 'simple', rawScore: 0, signals: ['heartbeat'], confidence: 0.99 }
  }

  let score = 0
  const signals: string[] = []

  // 1. Comprimento do último prompt
  if (lastText.length > 2000) { score += 20; signals.push('long_prompt') }
  else if (lastText.length > 500) { score += 10; signals.push('medium_prompt') }

  // 2. Profundidade da conversa
  if (scoreable.length > 16) { score += 10; signals.push('deep_conversation') }
  else if (scoreable.length > 8) { score += 5; signals.push('medium_conversation') }

  // 3. Bloco de código extenso
  if (CODE_PATTERN.test(lastText)) { score += 15; signals.push('code_block') }
  else if ((lastText.match(INLINE_CODE_PATTERN) ?? []).length > 2) { score += 7; signals.push('inline_code') }

  // 4. Notação matemática
  if (MATH_PATTERNS.some((p) => p.test(lastText))) { score += 15; signals.push('math_notation') }

  // 5. Keywords de raciocínio multi-etapa
  const multiStepMatch = MULTI_STEP_KEYWORDS.some((kw) => {
    if (kw.includes('.*')) return new RegExp(kw, 'i').test(lastText)
    return lastText.toLowerCase().includes(kw)
  })
  if (multiStepMatch) { score += 12; signals.push('multi_step') }

  // 6. Keywords de análise/avaliação
  const reasoningMatch = REASONING_KEYWORDS.some((kw) => allText.toLowerCase().includes(kw))
  if (reasoningMatch) { score += 8; signals.push('reasoning_keywords') }

  // 7. Múltiplas perguntas
  const questionCount = (lastText.match(/[?？]/g) ?? []).length
  if (questionCount > 3) { score += 10; signals.push('multi_question') }
  else if (questionCount > 1) { score += 5; signals.push('compound_question') }

  // 8. Vocabulário técnico especializado
  const domainHits = [...DOMAIN_VOCABULARY].filter((term) => allText.toLowerCase().includes(term)).length
  if (domainHits >= 3) { score += 10; signals.push('domain_vocabulary') }
  else if (domainHits >= 1) { score += 5; signals.push('technical_term') }

  // 9. Lógica formal na última mensagem do usuário
  const hasFormalLogic = FORMAL_LOGIC_PATTERNS.some((p) => p.test(lastText))
  if (hasFormalLogic) { score += 15; signals.push('formal_logic') }

  // 10. Contexto muito longo
  if (allText.length > 50000) { score += 8; signals.push('large_context') }

  // 11. Keywords de planejamento/design
  if (PLANNING_KEYWORDS.some((kw) => lastText.toLowerCase().includes(kw))) { score += 8; signals.push('planning') }

  // 12. Negação complexa (estruturas condicionais compostas)
  const negationCount = (lastText.match(/\b(except|unless|provided that|given that|assuming that|only if|a menos que|desde que|exceto quando)\b/gi) ?? []).length
  if (negationCount > 1) { score += 6; signals.push('complex_negation') }

  // 13. Pedido de tabela ou lista estruturada
  if (/\b(create a table|gere uma tabela|list all|liste todos|enumerate|enumere)\b/i.test(lastText)) {
    score += 4; signals.push('structured_output')
  }

  score = Math.min(score, 100)
  let tier = tierFromScore(score)
  let confidence = confidenceFromScore(score)

  // --- Hard overrides (em ordem de precedência) ---

  // Lógica formal pedida explicitamente → modelo de raciocínio, sempre.
  if (hasFormalLogic) {
    tier = 'reasoning'
    confidence = Math.max(confidence, 0.95)
    if (!signals.includes('forced_reasoning')) signals.push('forced_reasoning')
  }

  // Mensagem curta sem nenhum sinal complexo → simple direto.
  const hasComplexSignal = signals.some((s) =>
    ['code_block', 'math_notation', 'formal_logic', 'multi_step', 'long_prompt', 'large_context'].includes(s),
  )
  if (!hasFormalLogic && lastText.length > 0 && lastText.length < SHORT_MESSAGE_MAX_CHARS && !hasComplexSignal) {
    tier = 'simple'
    confidence = Math.max(confidence, 0.9)
    signals.push('short_message')
  }

  // Tools ativas exigem um modelo que saiba usá-las → piso "standard".
  if (options.hasTools && tier === 'simple' && !signals.includes('heartbeat')) {
    tier = 'standard'
    signals.push('tools_floor')
  }

  // Contexto gigante (~50k+ tokens) precisa de janela grande → piso "complex".
  if (allText.length > LARGE_CONTEXT_FLOOR_CHARS) {
    tier = floorTier(tier, 'complex')
    signals.push('large_context_floor')
  }

  return { tier, rawScore: score, signals, confidence }
}
