import type { ProviderRuntime, UiProvider } from "@/lib/contracts";

type ProxyTarget = {
  pathSegment: string
  target: string
}

const serverPublicRuntime: ProviderRuntime = {
  authMode: 'none',
  externalApi: true,
  kind: 'server',
  openAiCompatible: false,
  transport: 'modelhub-proxy',
}

const serverGatewayRuntime: ProviderRuntime = {
  authMode: 'none',
  externalApi: true,
  kind: 'server',
  openAiCompatible: true,
  transport: 'openai-compatible',
}

const serverApiKeyRuntime: ProviderRuntime = {
  authMode: 'api-key',
  externalApi: true,
  kind: 'server',
  openAiCompatible: true,
  transport: 'openai-compatible',
}

const browserSessionRuntime: ProviderRuntime = {
  authMode: 'browser-session',
  externalApi: false,
  kind: 'client',
  openAiCompatible: false,
  transport: 'browser-sdk',
}

const utilityRuntime: ProviderRuntime = {
  authMode: 'none',
  externalApi: false,
  kind: 'server',
  openAiCompatible: false,
  transport: 'passthrough-proxy',
}

function gatewayProvider(provider: Omit<UiProvider, 'category' | 'runtime'>): UiProvider {
  return { ...provider, category: 'gateway', runtime: serverGatewayRuntime }
}

function publicWebProvider(provider: Omit<UiProvider, 'category' | 'runtime'>): UiProvider {
  return { ...provider, category: 'public-web', runtime: serverPublicRuntime }
}

function apiProvider(provider: Omit<UiProvider, 'category' | 'runtime'>): UiProvider {
  return { ...provider, category: 'api-provider', runtime: serverApiKeyRuntime }
}

function browserProvider(provider: Omit<UiProvider, 'category' | 'runtime'>): UiProvider {
  return { ...provider, category: 'browser-sdk', runtime: browserSessionRuntime }
}

function utilityProvider(provider: Omit<UiProvider, 'category' | 'runtime'>): UiProvider {
  return { ...provider, category: 'utility', runtime: utilityRuntime }
}

export const PROVIDER_CATALOG: readonly UiProvider[] = [
  gatewayProvider({
    id: 'gateway',
    label: 'Gateway (Chat)',
    base: '/gateway',
    hasModels: true,
    signupUrl: 'https://vercel.com/docs/ai-gateway',
    signupLabel: 'Chave Vercel AI Gateway (recomendada: o demo público labs pode falhar)',
  }),
  utilityProvider({ id: 'embeddings', label: 'Embeddings (RAG)', base: '/embeddings', hasModels: false }),
  publicWebProvider({ id: 'duckai', label: 'Duck.ai', base: '/duckai', hasModels: true }),
  publicWebProvider({ id: 'quillbot', label: 'Quillbot AI', base: '/quillbot', hasModels: true }),
  publicWebProvider({ id: 'pollinations', label: 'Pollinations AI', base: '/pollinations', hasModels: true }),
  browserProvider({
    id: 'puter',
    label: 'Puter Xiaomi MiMo',
    base: '/puter',
    hasModels: true,
    signupUrl: 'https://puter.com',
    signupLabel: 'Entrar ou criar conta Puter',
  }),
  apiProvider({
    id: 'deepseek',
    label: 'DeepSeek',
    base: '/deepseek',
    hasModels: true,
    requiredEnv: 'DEEPSEEK_API_KEY',
    requiredKeys: [{ envName: 'DEEPSEEK_API_KEY', label: 'API Key', placeholder: 'sk-...' }],
    signupUrl: 'https://platform.deepseek.com/api_keys',
    signupLabel: 'Obter chave no DeepSeek',
  }),
  apiProvider({
    id: 'perplexity',
    label: 'Perplexity',
    base: '/perplexity',
    hasModels: true,
    requiredEnv: 'PERPLEXITY_API_KEY',
    requiredKeys: [{ envName: 'PERPLEXITY_API_KEY', label: 'API Key', placeholder: 'pplx-...' }],
    signupUrl: 'https://www.perplexity.ai/settings/api',
    signupLabel: 'Obter chave no Perplexity',
  }),
  apiProvider({
    id: 'togetherai',
    label: 'Together AI',
    base: '/togetherai',
    hasModels: true,
    requiredEnv: 'TOGETHER_API_KEY',
    requiredKeys: [{ envName: 'TOGETHER_API_KEY', label: 'API Key', placeholder: 'sk-...' }],
    signupUrl: 'https://api.together.xyz/settings/api-keys',
    signupLabel: 'Obter chave no Together AI',
  }),
  apiProvider({
    id: 'fireworks',
    label: 'Fireworks AI',
    base: '/fireworks',
    hasModels: true,
    requiredEnv: 'FIREWORKS_API_KEY',
    requiredKeys: [{ envName: 'FIREWORKS_API_KEY', label: 'API Key', placeholder: 'sk-...' }],
    signupUrl: 'https://app.fireworks.ai/login',
    signupLabel: 'Obter chave no Fireworks AI',
  }),
  apiProvider({
    id: 'openrouter',
    label: 'OpenRouter',
    base: '/openrouter',
    hasModels: true,
    requiredEnv: 'OPENROUTER_API_KEY',
    requiredKeys: [{ envName: 'OPENROUTER_API_KEY', label: 'API Key', placeholder: 'sk-or-...' }],
    signupUrl: 'https://openrouter.ai/keys',
    signupLabel: 'Obter chave no OpenRouter',
  }),
  apiProvider({
    id: 'googleaistudio',
    label: 'Google AI Studio',
    base: '/googleaistudio',
    hasModels: true,
    requiredEnv: 'GOOGLE_AI_STUDIO_API_KEY',
    requiredKeys: [{ envName: 'GOOGLE_AI_STUDIO_API_KEY', label: 'API Key', placeholder: 'AIza...' }],
    signupUrl: 'https://aistudio.google.com/apikey',
    signupLabel: 'Obter chave no Google AI Studio',
  }),
  apiProvider({
    id: 'nvidianim',
    label: 'NVIDIA NIM',
    base: '/nvidianim',
    hasModels: true,
    requiredEnv: 'NVIDIA_NIM_API_KEY',
    requiredKeys: [{ envName: 'NVIDIA_NIM_API_KEY', label: 'NVIDIA API Key', placeholder: 'nvapi-xxxx...' }],
    signupUrl: 'https://build.nvidia.com/explore/discover',
    signupLabel: 'Obter chave grátis na NVIDIA (build.nvidia.com)',
  }),
  apiProvider({
    id: 'mistral',
    label: 'Mistral',
    base: '/mistral',
    hasModels: true,
    requiredEnv: 'MISTRAL_API_KEY',
    requiredKeys: [{ envName: 'MISTRAL_API_KEY', label: 'API Key', placeholder: 'sk-...' }],
    signupUrl: 'https://console.mistral.ai/api-keys',
    signupLabel: 'Obter chave na Mistral',
  }),
  apiProvider({
    id: 'codestral',
    label: 'Mistral Codestral',
    base: '/codestral',
    hasModels: true,
    requiredEnv: 'CODESTRAL_API_KEY',
    requiredKeys: [{ envName: 'CODESTRAL_API_KEY', label: 'API Key', placeholder: 'sk-...' }],
    signupUrl: 'https://console.mistral.ai/api-keys',
    signupLabel: 'Obter chave Codestral (console Mistral)',
  }),
  apiProvider({
    id: 'huggingface',
    label: 'HuggingFace',
    base: '/huggingface',
    hasModels: true,
    requiredEnv: 'HUGGINGFACE_API_KEY',
    requiredKeys: [{ envName: 'HUGGINGFACE_API_KEY', label: 'API Token', placeholder: 'hf_...' }],
    signupUrl: 'https://huggingface.co/settings/tokens',
    signupLabel: 'Obter token no HuggingFace',
  }),
  apiProvider({
    id: 'vercelgateway',
    label: 'Vercel AI Gateway',
    base: '/vercelgateway',
    hasModels: true,
    requiredEnv: 'VERCEL_AI_GATEWAY_API_KEY',
    requiredKeys: [{ envName: 'VERCEL_AI_GATEWAY_API_KEY', label: 'API Key', placeholder: 'vg_...' }],
    signupUrl: 'https://vercel.com/docs/ai-gateway',
    signupLabel: 'Obter chave na Vercel',
  }),
  apiProvider({
    id: 'opengateway',
    label: 'OpenGateway',
    base: '/opengateway',
    hasModels: true,
    requiredEnv: 'OPENGATEWAY_API_KEY',
    requiredKeys: [{ envName: 'OPENGATEWAY_API_KEY', label: 'API Key', placeholder: 'ogw_live_...' }],
    signupUrl: 'https://gitlawb.com/opengateway/keys',
    signupLabel: 'Obter chave no OpenGateway',
  }),
  apiProvider({
    id: 'opencodezen',
    label: 'OpenCode Zen',
    base: '/opencodezen',
    hasModels: true,
    requiredEnv: 'OPENCODE_ZEN_API_KEY',
    requiredKeys: [{ envName: 'OPENCODE_ZEN_API_KEY', label: 'API Key', placeholder: 'ocz-...' }],
    signupUrl: 'https://opencode.ai',
    signupLabel: 'Obter chave no OpenCode Zen',
  }),
  apiProvider({
    id: 'cerebras',
    label: 'Cerebras',
    base: '/cerebras',
    hasModels: true,
    requiredEnv: 'CEREBRAS_API_KEY',
    requiredKeys: [{ envName: 'CEREBRAS_API_KEY', label: 'API Key', placeholder: 'csk-...' }],
    signupUrl: 'https://cloud.cerebras.ai/',
    signupLabel: 'Obter chave na Cerebras',
  }),
  apiProvider({
    id: 'groq',
    label: 'Groq',
    base: '/groq',
    hasModels: true,
    requiredEnv: 'GROQ_API_KEY',
    requiredKeys: [{ envName: 'GROQ_API_KEY', label: 'API Key', placeholder: 'gsk_...' }],
    signupUrl: 'https://console.groq.com/keys',
    signupLabel: 'Obter chave no Groq',
  }),
  apiProvider({
    id: 'cohere',
    label: 'Cohere',
    base: '/cohere',
    hasModels: true,
    requiredEnv: 'COHERE_API_KEY',
    requiredKeys: [{ envName: 'COHERE_API_KEY', label: 'API Key', placeholder: 'co-...' }],
    signupUrl: 'https://dashboard.cohere.com/api-keys',
    signupLabel: 'Obter chave na Cohere',
  }),
  apiProvider({
    id: 'githubmodels',
    label: 'GitHub Models',
    base: '/githubmodels',
    hasModels: true,
    requiredEnv: 'GITHUB_TOKEN',
    requiredKeys: [{ envName: 'GITHUB_TOKEN', label: 'Personal Access Token', placeholder: 'ghp_...' }],
    signupUrl: 'https://github.com/settings/tokens',
    signupLabel: 'Gerar token no GitHub',
  }),
  apiProvider({
    id: 'cloudflareworkersai',
    label: 'Cloudflare Workers AI',
    base: '/cloudflareworkersai',
    hasModels: true,
    requiredEnv: 'CLOUDFLARE_API_TOKEN',
    requiredKeys: [
      { envName: 'CLOUDFLARE_API_TOKEN', label: 'API Token', placeholder: 'Bearer token...' },
      { envName: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID', placeholder: 'Seu Account ID' },
    ],
    signupUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    signupLabel: 'Obter token na Cloudflare',
  }),
]

const PROXY_TARGETS: readonly ProxyTarget[] = [
  {
    pathSegment: 'embeddings',
    target: 'https://ai-gateway-embeddings-demo.labs.vercel.dev',
  },
  {
    pathSegment: 'gateway',
    target: 'https://ai-sdk-gateway-demo.labs.vercel.dev',
  },
] as const

function parseCsvSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isProviderEnabled(providerId: string): boolean {
  const normalizedProviderId = providerId.trim().toLowerCase()
  const enabledProviders = parseCsvSet(process.env.ENABLED_PROVIDERS)
  if (enabledProviders.size > 0) {
    return enabledProviders.has(normalizedProviderId)
  }

  const disabledProviders = parseCsvSet(process.env.DISABLED_PROVIDERS)
  return !disabledProviders.has(normalizedProviderId)
}

export function getAvailableProviders(): UiProvider[] {
  return PROVIDER_CATALOG.filter(
    (provider) => isProviderEnabled(provider.id),
  )
}

export function getProxyTarget(pathname: string): ProxyTarget | undefined {
  return PROXY_TARGETS.find((target) => pathname.startsWith(`/${target.pathSegment}/`))
}

