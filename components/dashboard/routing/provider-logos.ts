/**
 * Provedores com logo versionado em public/providers/<id>.svg (issue #249).
 * Origem: @lobehub/icons-static-svg (MIT).
 */
const PROVIDERS_WITH_LOGO = new Set([
  "bytepluscoding",
  "cerebras",
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
  "ollamacloud",
  "opencodego",
  "opencodezen",
  "openai",
  "openrouter",
  "perplexity",
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
