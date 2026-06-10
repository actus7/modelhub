import type { ProviderRuntime, UiProvider } from "@/lib/contracts";

import { parseCsvSet } from "./env-utils";

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
  apiProvider({
    id: 'xiaomiaistudio',
    label: 'Xiaomi AI Studio',
    base: '/xiaomiaistudio',
    hasModels: true,
    requiredEnv: 'XIAOMI_STUDIO_COOKIE',
    requiredKeys: [{
      envName: 'XIAOMI_STUDIO_COOKIE',
      label: 'Cookie de sessao',
      placeholder: 'sessionid=...; token=...',
    }],
    signupUrl: 'https://aistudio.xiaomimimo.com',
    signupLabel: 'Logar no AI Studio e copiar cookies (DevTools > Application > Cookies)',
  }),
  browserProvider({
    id: 'puter',
    label: 'Puter Xiaomi MiMo',
    base: '/puter',
    hasModels: true,
    signupUrl: 'https://puter.com',
    signupLabel: 'Entrar ou criar conta Puter',
  }),
  apiProvider({
    id: 'openai',
    label: 'OpenAI',
    base: '/openai',
    hasModels: true,
    requiredEnv: 'OPENAI_API_KEY',
    requiredKeys: [{ envName: 'OPENAI_API_KEY', label: 'API Key', placeholder: 'sk-...' }],
    signupUrl: 'https://platform.openai.com/api-keys',
    signupLabel: 'Obter chave na OpenAI',
  }),
  apiProvider({
    id: 'xai',
    label: 'xAI (Grok)',
    base: '/xai',
    hasModels: true,
    requiredEnv: 'XAI_API_KEY',
    requiredKeys: [{ envName: 'XAI_API_KEY', label: 'API Key', placeholder: 'xai-...' }],
    signupUrl: 'https://console.x.ai/',
    signupLabel: 'Obter chave na xAI',
  }),
  apiProvider({
    id: 'xaisubscription',
    label: 'xAI Grok (Assinatura)',
    base: '/xaisubscription',
    hasModels: true,
    requiredEnv: 'XAI_OAUTH_TOKEN',
    requiredKeys: [{ envName: 'XAI_OAUTH_TOKEN', label: 'OAuth access token', placeholder: 'Bearer token da assinatura Grok' }],
    signupUrl: 'https://x.ai',
    signupLabel: 'Entrar na xAI',
  }),
  apiProvider({
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    base: '/moonshot',
    hasModels: true,
    requiredEnv: 'MOONSHOT_API_KEY',
    requiredKeys: [{ envName: 'MOONSHOT_API_KEY', label: 'API Key', placeholder: 'sk-...' }],
    signupUrl: 'https://platform.moonshot.ai/console/api-keys',
    signupLabel: 'Obter chave na Moonshot',
  }),
  apiProvider({
    id: 'qwen',
    label: 'Qwen (Alibaba)',
    base: '/qwen',
    hasModels: true,
    requiredEnv: 'DASHSCOPE_API_KEY',
    requiredKeys: [{ envName: 'DASHSCOPE_API_KEY', label: 'DashScope API Key', placeholder: 'sk-...' }],
    signupUrl: 'https://bailian.console.alibabacloud.com/',
    signupLabel: 'Obter chave no DashScope (Alibaba Cloud)',
  }),
  apiProvider({
    id: 'qwentoken',
    label: 'Qwen Token Plan (Assinatura)',
    base: '/qwentoken',
    hasModels: true,
    requiredEnv: 'QWEN_TOKEN_PLAN_API_KEY',
    requiredKeys: [{ envName: 'QWEN_TOKEN_PLAN_API_KEY', label: 'Token Plan API Key', placeholder: 'sk-sp-...' }],
    signupUrl: 'https://home.qwencloud.com/api-keys',
    signupLabel: 'Obter chave do Qwen Token Plan',
  }),
  apiProvider({
    id: 'bytepluscoding',
    label: 'BytePlus ModelArk Coding Plan (Assinatura)',
    base: '/bytepluscoding',
    hasModels: true,
    requiredEnv: 'BYTEPLUS_CODING_API_KEY',
    requiredKeys: [{ envName: 'BYTEPLUS_CODING_API_KEY', label: 'Coding Plan API Key', placeholder: 'Chave ModelArk Coding Plan' }],
    signupUrl: 'https://www.byteplus.com/en/activity/codingplan',
    signupLabel: 'Assinar o ModelArk Coding Plan',
  }),
  apiProvider({
    id: 'commandcode',
    label: 'Command Code (Assinatura)',
    base: '/commandcode',
    hasModels: true,
    requiredEnv: 'COMMAND_CODE_API_KEY',
    requiredKeys: [{ envName: 'COMMAND_CODE_API_KEY', label: 'Command Code API Key', placeholder: 'Chave Command Code' }],
    signupUrl: 'https://commandcode.ai/studio',
    signupLabel: 'Obter chave no Command Code Studio',
  }),
  apiProvider({
    id: 'xiaomitoken',
    label: 'Xiaomi MiMo Token Plan (Assinatura)',
    base: '/xiaomitoken',
    hasModels: true,
    requiredEnv: 'XIAOMI_TOKEN_PLAN_API_KEY',
    requiredKeys: [{ envName: 'XIAOMI_TOKEN_PLAN_API_KEY', label: 'Token Plan API Key', placeholder: 'tp-...' }],
    signupUrl: 'https://platform.xiaomimimo.com',
    signupLabel: 'Obter chave do MiMo Token Plan',
  }),
  apiProvider({
    id: 'zai',
    label: 'Z.ai (GLM)',
    base: '/zai',
    hasModels: true,
    requiredEnv: 'ZAI_API_KEY',
    requiredKeys: [{ envName: 'ZAI_API_KEY', label: 'API Key', placeholder: 'API key' }],
    signupUrl: 'https://z.ai/manage-apikey/apikey-list',
    signupLabel: 'Obter chave na Z.ai',
  }),
  apiProvider({
    id: 'zaicoding',
    label: 'Z.ai GLM Coding Plan (Assinatura)',
    base: '/zaicoding',
    hasModels: true,
    requiredEnv: 'ZAI_CODING_API_KEY',
    requiredKeys: [{ envName: 'ZAI_CODING_API_KEY', label: 'Coding Plan API Key', placeholder: 'Chave do GLM Coding Plan' }],
    signupUrl: 'https://z.ai/subscribe',
    signupLabel: 'Assinar o GLM Coding Plan',
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
    id: 'opencodego',
    label: 'OpenCode Go (Assinatura)',
    base: '/opencodego',
    hasModels: true,
    requiredEnv: 'OPENCODE_GO_API_KEY',
    requiredKeys: [{ envName: 'OPENCODE_GO_API_KEY', label: 'OpenCode Go API Key', placeholder: 'Chave OpenCode Go' }],
    signupUrl: 'https://opencode.ai',
    signupLabel: 'Obter chave do OpenCode Go',
  }),
  apiProvider({
    id: 'copilot',
    label: 'GitHub Copilot (Assinatura)',
    base: '/copilot',
    hasModels: true,
    requiredEnv: 'COPILOT_TOKEN',
    requiredKeys: [{ envName: 'COPILOT_TOKEN', label: 'Copilot session token', placeholder: 'tid=...' }],
    signupUrl: 'https://github.com/features/copilot',
    signupLabel: 'Entrar no GitHub Copilot',
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
      { envName: 'CLOUDFLARE_API_TOKEN', label: 'API Token', placeholder: 'cfut_...' },
      { envName: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID', placeholder: 'Ex: 023e105f4ecef8ad9ca31a8372d0c353' },
    ],
    signupUrl: 'https://developers.cloudflare.com/fundamentals/setup/find-account-and-zone-ids/',
    signupLabel: 'Como encontrar o Account ID na Cloudflare',
  }),
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    base: '/ollama',
    category: 'api-provider',
    hasModels: true,
    runtime: {
      authMode: 'none',
      externalApi: false,
      kind: 'server',
      openAiCompatible: true,
      transport: 'openai-compatible',
    },
  },
  apiProvider({
    id: 'ollamacloud',
    label: 'Ollama Cloud (Assinatura)',
    base: '/ollamacloud',
    hasModels: true,
    requiredEnv: 'OLLAMA_CLOUD_API_KEY',
    requiredKeys: [{ envName: 'OLLAMA_CLOUD_API_KEY', label: 'Ollama API Key', placeholder: 'Ollama Cloud API key' }],
    signupUrl: 'https://ollama.com',
    signupLabel: 'Obter chave no Ollama Cloud',
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

