import cerebrasFetch, { models as cerebrasModels } from "./cerebras";
import ollamaFetch, { models as ollamaModels, fetchOllamaModels } from "./ollama";
import cloudflareWorkersAiFetch, { models as cloudflareworkersaiModels, fetchCloudflareModels } from "./cloudflareworkersai";
import codestralFetch, { models as codestralModels } from "./codestral";
import cohereFetch, { models as cohereModels, fetchCohereModels } from "./cohere";
import deepseekFetch, { models as deepseekModels } from "./deepseek";
import duckaiFetch, { DUCKAI_MODELS, fetchDuckAiModels } from "./duckai";
import fireworksFetch, { models as fireworksModels } from "./fireworks";
import gatewayFetch, { GATEWAY_MODELS, fetchGatewayModels } from "./gateway";
import githubModelsFetch, { models as githubmodelsModels } from "./githubmodels";
import googleAiStudioFetch, { models as googleaistudioModels, fetchGoogleAiStudioModels } from "./googleaistudio";
import groqFetch, { models as groqModels } from "./groq";

import huggingFaceFetch, { models as huggingfaceModels } from "./huggingface";
import mistralFetch, { models as mistralModels } from "./mistral";
import moonshotFetch, { models as moonshotModels } from "./moonshot";
import nvidiaNimFetch, { models as nvidianimModels } from "./nvidianim";
import openaiFetch, { models as openaiModels } from "./openai";
import qwenFetch, { models as qwenModels } from "./qwen";
import xaiFetch, { models as xaiModels } from "./xai";
import zaiFetch, { models as zaiModels } from "./zai";
import zaiCodingFetch, { models as zaiCodingModels } from "./zaicoding";
import openCodeZenFetch, { models as opencodezenModels } from "./opencodezen";
import opengatewayFetch, { models as opengatewayModels } from "./opengateway";
import openrouterFetch, { models as openrouterModels } from "./openrouter";
import perplexityFetch, { models as perplexityModels } from "./perplexity";
import pollinationsFetch, { POLLINATIONS_MODELS, fetchPollinationsModels } from "./pollinations";
import puterFetch, { PUTER_MODELS } from "./puter";
import quillbotFetch, { QUILLBOT_MODELS } from "./quillbot";
import togetheraiFetch, { models as togetheraiModels } from "./togetherai";
import vercelGatewayFetch, { models as vercelgatewayModels } from "./vercelgateway";
import { DEFAULT_MODELS_CACHE_TTL_MS, getCachedModels } from "../lib/model-cache";
import { createOpenAiFetchModels } from "../lib/openai-compatible";
import type { ProviderModel } from "../lib/provider-core";

type ProviderHandler = (req: Request) => Response | Promise<Response>;

type ProviderEntry = {
  clientOnly?: boolean;
  handler: ProviderHandler;
  models: readonly ProviderModel[];
  fetchModels?: (credentials?: Record<string, string>) => Promise<ProviderModel[]>;
};

export const providerRegistry: Record<string, ProviderEntry> = {
  cerebras: {
    handler: cerebrasFetch,
    models: cerebrasModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.cerebras.ai/v1/models', apiKeyEnv: 'CEREBRAS_API_KEY', providerName: 'Cerebras' }),
  },
  cloudflareworkersai: { handler: cloudflareWorkersAiFetch, models: cloudflareworkersaiModels, fetchModels: fetchCloudflareModels },
  codestral: {
    handler: codestralFetch,
    models: codestralModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://codestral.mistral.ai/v1/models', apiKeyEnv: 'CODESTRAL_API_KEY', providerName: 'Mistral Codestral' }),
  },
  cohere: { handler: cohereFetch, models: cohereModels, fetchModels: fetchCohereModels },
  deepseek: {
    handler: deepseekFetch,
    models: deepseekModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.deepseek.com/v1/models', apiKeyEnv: 'DEEPSEEK_API_KEY', providerName: 'DeepSeek' }),
  },
  duckai: { handler: duckaiFetch, models: DUCKAI_MODELS, fetchModels: fetchDuckAiModels },
  fireworks: {
    handler: fireworksFetch,
    models: fireworksModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.fireworks.ai/inference/v1/models', apiKeyEnv: 'FIREWORKS_API_KEY', providerName: 'Fireworks AI' }),
  },
  gateway: { handler: gatewayFetch, models: GATEWAY_MODELS, fetchModels: fetchGatewayModels },
  githubmodels: {
    handler: githubModelsFetch,
    models: githubmodelsModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://models.inference.ai.azure.com/models', apiKeyEnv: 'GITHUB_TOKEN', providerName: 'GitHub Models' }),
  },
  googleaistudio: { handler: googleAiStudioFetch, models: googleaistudioModels, fetchModels: fetchGoogleAiStudioModels },
  groq: {
    handler: groqFetch,
    models: groqModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.groq.com/openai/v1/models', apiKeyEnv: 'GROQ_API_KEY', providerName: 'Groq' }),
  },

  huggingface: {
    handler: huggingFaceFetch,
    models: huggingfaceModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://router.huggingface.co/v1/models', apiKeyEnv: 'HUGGINGFACE_API_KEY', providerName: 'HuggingFace' }),
  },
  mistral: {
    handler: mistralFetch,
    models: mistralModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.mistral.ai/v1/models', apiKeyEnv: 'MISTRAL_API_KEY', providerName: 'Mistral' }),
  },
  nvidianim: {
    handler: nvidiaNimFetch,
    models: nvidianimModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://integrate.api.nvidia.com/v1/models', apiKeyEnv: 'NVIDIA_NIM_API_KEY', providerName: 'NVIDIA NIM' }),
  },
  opencodezen: {
    handler: openCodeZenFetch,
    models: opencodezenModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.opencode.ai/v1/models', apiKeyEnv: 'OPENCODE_ZEN_API_KEY', providerName: 'OpenCode Zen' }),
  },
  opengateway: {
    handler: opengatewayFetch,
    models: opengatewayModels,
  },
  openrouter: {
    handler: openrouterFetch,
    models: openrouterModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://openrouter.ai/api/v1/models', apiKeyEnv: 'OPENROUTER_API_KEY', providerName: 'OpenRouter' }),
  },
  perplexity: {
    handler: perplexityFetch,
    models: perplexityModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.perplexity.ai/models', apiKeyEnv: 'PERPLEXITY_API_KEY', providerName: 'Perplexity' }),
  },
  pollinations: { handler: pollinationsFetch, models: POLLINATIONS_MODELS, fetchModels: fetchPollinationsModels },
  puter: { clientOnly: true, handler: puterFetch, models: PUTER_MODELS },
  quillbot: { handler: quillbotFetch, models: QUILLBOT_MODELS },
  togetherai: {
    handler: togetheraiFetch,
    models: togetheraiModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.together.xyz/v1/models', apiKeyEnv: 'TOGETHER_API_KEY', providerName: 'Together AI' }),
  },
  vercelgateway: {
    handler: vercelGatewayFetch,
    models: vercelgatewayModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://ai-gateway.vercel.sh/v1/models', apiKeyEnv: 'VERCEL_AI_GATEWAY_API_KEY', providerName: 'Vercel AI Gateway' }),
  },
  ollama: {
    handler: ollamaFetch,
    models: ollamaModels,
    fetchModels: fetchOllamaModels,
  },
  openai: {
    handler: openaiFetch,
    models: openaiModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.openai.com/v1/models', apiKeyEnv: 'OPENAI_API_KEY', providerName: 'OpenAI', filter: (m) => /^(gpt-|o\d|chatgpt)/i.test(m.id) }),
  },
  xai: {
    handler: xaiFetch,
    models: xaiModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.x.ai/v1/models', apiKeyEnv: 'XAI_API_KEY', providerName: 'xAI' }),
  },
  moonshot: {
    handler: moonshotFetch,
    models: moonshotModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.moonshot.ai/v1/models', apiKeyEnv: 'MOONSHOT_API_KEY', providerName: 'Moonshot' }),
  },
  qwen: {
    handler: qwenFetch,
    models: qwenModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models', apiKeyEnv: 'DASHSCOPE_API_KEY', providerName: 'Qwen' }),
  },
  zai: {
    handler: zaiFetch,
    models: zaiModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.z.ai/api/paas/v4/models', apiKeyEnv: 'ZAI_API_KEY', providerName: 'Z.ai' }),
  },
  zaicoding: {
    handler: zaiCodingFetch,
    models: zaiCodingModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.z.ai/api/paas/v4/models', apiKeyEnv: 'ZAI_CODING_API_KEY', providerName: 'Z.ai GLM Coding Plan' }),
  },
};

export function isProviderAvailableViaExternalApi(providerId: string): boolean {
  return providerRegistry[providerId]?.clientOnly !== true;
}

export type GetProviderModelsOptions = {
  credentials?: Record<string, string>;
  cacheKeySuffix?: string;
  staleWhileRevalidate?: boolean;
};

/** Get models for a provider, using dynamic fetch + cache when available. */
export async function getProviderModels(
  providerId: string,
  options: GetProviderModelsOptions = {},
): Promise<readonly ProviderModel[]> {
  const entry = providerRegistry[providerId];
  if (!entry) return [];

  if (entry.fetchModels) {
    return getCachedModels(
      providerId,
      () => entry.fetchModels?.(options.credentials) ?? Promise.resolve([]),
      entry.models,
      DEFAULT_MODELS_CACHE_TTL_MS,
      {
        cacheKeySuffix: options.cacheKeySuffix,
        staleWhileRevalidate: options.staleWhileRevalidate,
      },
    )
  }

  return entry.models;
}
