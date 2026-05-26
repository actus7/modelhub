import type { ProviderModel } from "@/lib/contracts";

export const PUTER_PROVIDER_ID = "puter";
export const PUTER_DEFAULT_MODEL = "xiaomi/mimo-v2.5";

export const PUTER_MODELS: ProviderModel[] = [
  {
    capabilities: { documents: false, images: false },
    id: PUTER_DEFAULT_MODEL,
    name: "Xiaomi MiMo V2.5 (Puter)",
  },
];
