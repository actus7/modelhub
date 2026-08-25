/**
 * Provedores com logo versionado em public/providers/<id>.svg (issue #249).
 * Origem: @lobehub/icons-static-svg (MIT, devDependency usada só como fonte).
 * Para adicionar um novo: ver scripts/add-provider-logo.mjs.
 */
const PROVIDERS_WITH_LOGO = new Set([
  "bytepluscoding",
  "cerebras",
  "cloudflareworkersai",
  "cohere",
  "copilot",
  "deepseek",
  "fireworks",
  "gateway",
  "githubmodels",
  "googleaistudio",
  "groq",
  "huggingface",
  "mistral",
  "moonshot",
  "nvidianim",
  "ollama",
  "ollamacloud",
  "opencodego",
  "opencodezen",
  "openai",
  "openrouter",
  "perplexity",
  "pollinations",
  "qwen",
  "qwentoken",
  "togetherai",
  "zai",
  "zaicoding",
])

export function providerLogoSrc(providerId: string): string | undefined {
  return PROVIDERS_WITH_LOGO.has(providerId)
    ? `/providers/${providerId}.svg`
    : undefined
}
