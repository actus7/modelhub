export type TaskCategory =
  | 'coding'
  | 'web_browsing'
  | 'data_analysis'
  | 'image_generation'
  | 'video_generation'
  | 'social_media'
  | 'email'
  | 'calendar'
  | 'trading'

interface CategoryConfig {
  keywords: string[]
  toolPrefixes?: string[]
  confidence: number
}

const CATEGORY_CONFIG: Record<TaskCategory, CategoryConfig> = {
  coding: {
    keywords: [
      'code', 'function', 'method', 'class', 'algorithm', 'debug', 'bug', 'error',
      'typescript', 'javascript', 'python', 'rust', 'golang', 'java', 'c++', 'c#',
      'sql', 'query', 'api', 'endpoint', 'regex', 'implement', 'refactor', 'unit test',
      'lint', 'compile', 'build', 'deploy', 'git', 'commit', 'pull request', 'pr',
      'código', 'função', 'método', 'classe', 'algoritmo', 'depurar', 'implementar',
      'escreva um script', 'write a script', 'write code', 'escreva código',
    ],
    toolPrefixes: ['code_', 'exec_', 'run_code', 'bash_', 'shell_'],
    confidence: 0.6,
  },
  web_browsing: {
    keywords: [
      'browse', 'search the web', 'google', 'look up', 'find online', 'website',
      'navigate to', 'click on', 'open url', 'web search', 'internet', 'online',
      'buscar na web', 'pesquisar na internet', 'abrir site', 'navegar para',
    ],
    toolPrefixes: ['browser_', 'web_', 'navigate_', 'search_web', 'fetch_url'],
    confidence: 0.7,
  },
  data_analysis: {
    keywords: [
      'analyze data', 'dataset', 'csv', 'excel', 'spreadsheet', 'statistics',
      'correlation', 'regression', 'visualization', 'chart', 'graph', 'plot',
      'aggregate', 'pivot', 'group by', 'filter data', 'data frame', 'pandas',
      'analisar dados', 'conjunto de dados', 'estatísticas', 'visualização', 'gráfico',
      'média', 'mediana', 'desvio padrão', 'percentil',
    ],
    toolPrefixes: ['data_', 'analyze_', 'query_', 'chart_'],
    confidence: 0.6,
  },
  image_generation: {
    keywords: [
      'generate an image', 'create an image', 'draw', 'illustrate', 'render',
      'image of', 'picture of', 'photo of', 'artwork', 'dalle', 'midjourney',
      'gere uma imagem', 'crie uma imagem', 'desenhe', 'ilustre', 'imagem de',
      'foto de', 'arte de', 'visual de',
    ],
    toolPrefixes: ['image_gen', 'generate_image', 'dalle_', 'midjourney_', 'stable_diffusion'],
    confidence: 0.75,
  },
  video_generation: {
    keywords: [
      'generate a video', 'create a video', 'animate', 'animation', 'video clip',
      'motion', 'gere um vídeo', 'crie um vídeo', 'anime', 'animação', 'clipe de vídeo',
    ],
    toolPrefixes: ['video_gen', 'generate_video', 'animate_'],
    confidence: 0.8,
  },
  social_media: {
    keywords: [
      'tweet', 'post on', 'instagram', 'linkedin post', 'facebook', 'tiktok',
      'social media', 'caption', 'hashtag', 'viral', 'engagement',
      'postar no', 'publicar no', 'redes sociais', 'legenda', 'hashtag',
    ],
    toolPrefixes: ['twitter_', 'instagram_', 'linkedin_', 'facebook_', 'tiktok_', 'social_'],
    confidence: 0.7,
  },
  email: {
    keywords: [
      'send email', 'write email', 'compose email', 'reply to email', 'email to',
      'enviar email', 'escrever email', 'compor email', 'responder email', 'email para',
      'draft an email', 'redigir um email',
    ],
    toolPrefixes: ['gmail_', 'email_', 'send_email', 'mail_', 'outlook_'],
    confidence: 0.7,
  },
  calendar: {
    keywords: [
      'schedule', 'meeting', 'appointment', 'calendar', 'event', 'remind',
      'agendar', 'reunião', 'compromisso', 'calendário', 'evento', 'lembrete',
      'book a time', 'reserve', 'set a meeting',
    ],
    toolPrefixes: ['gcal_', 'calendar_', 'schedule_', 'meeting_'],
    confidence: 0.7,
  },
  trading: {
    keywords: [
      'buy stock', 'sell stock', 'trade', 'portfolio', 'market', 'price of',
      'comprar ação', 'vender ação', 'investimento', 'ativo', 'bolsa', 'mercado',
      'crypto', 'bitcoin', 'ethereum', 'forex', 'futures', 'options',
    ],
    toolPrefixes: ['trade_', 'stock_', 'market_', 'crypto_', 'portfolio_'],
    confidence: 0.65,
  },
}

function extractLastUserText(messages: Array<{ role: string; content: unknown }>): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) return ''
  if (typeof lastUser.content === 'string') return lastUser.content
  if (Array.isArray(lastUser.content)) {
    return lastUser.content
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

export function detectTaskCategory(
  messages: Array<{ role: string; content: unknown }>,
  toolNames?: string[],
): { category: TaskCategory; confidence: number } | null {
  const text = extractLastUserText(messages).toLowerCase()
  if (!text) return null

  let bestMatch: { category: TaskCategory; confidence: number } | null = null

  for (const [category, config] of Object.entries(CATEGORY_CONFIG) as Array<[TaskCategory, CategoryConfig]>) {
    // Tool name prefix matching — highest priority
    if (toolNames?.length && config.toolPrefixes?.length) {
      const toolMatch = toolNames.some((tool) =>
        config.toolPrefixes!.some((prefix) => tool.toLowerCase().startsWith(prefix.toLowerCase())),
      )
      if (toolMatch) {
        return { category, confidence: 0.95 }
      }
    }

    // Keyword matching
    const hits = config.keywords.filter((kw) => text.includes(kw.toLowerCase())).length
    if (hits > 0) {
      const confidence = Math.min(config.confidence + (hits - 1) * 0.05, 0.95)
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { category, confidence }
      }
    }
  }

  return bestMatch
}
