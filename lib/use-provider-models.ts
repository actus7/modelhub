"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ProviderModel, UiProvider } from "@/lib/contracts";
import { apiJson } from "@/lib/api";

function resolveSelectedModel(
  current: string,
  nextModels: ProviderModel[],
  providerId: string,
): string {
  if (current && nextModels.some((m) => m.id === current)) {
    return current;
  }

  const persisted =
    typeof globalThis.window !== "undefined"
      ? globalThis.localStorage.getItem(`selected-model:${providerId}`)
      : null;
  if (persisted && nextModels.some((m) => m.id === persisted)) {
    return persisted;
  }

  return nextModels[0]?.id ?? "";
}

function dedupeModels(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  const out: ProviderModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({ ...model, id });
  }
  return out;
}

type UseProviderModelsInput = {
  selectedProvider: UiProvider | null;
  selectedProviderId: string;
  selectedProviderReady: boolean;
};

type UseProviderModelsReturn = {
  loading: boolean;
  models: ProviderModel[];
  selectedModel: ProviderModel | null;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
};

export function useProviderModels(input: UseProviderModelsInput): UseProviderModelsReturn {
  const {
    selectedProvider,
    selectedProviderId,
    selectedProviderReady,
  } = input;

  const [models, setModels] = useState<ProviderModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedProviderId || !selectedProvider) return;

    if (!selectedProvider.hasModels) {
      setModels([]);
      setSelectedModelId("");
      return;
    }

    if (!selectedProviderReady) {
      setModels([]);
      setSelectedModelId("");
      return;
    }

    if (selectedProvider.localModels?.length) {
      const uniqueModels = dedupeModels(selectedProvider.localModels);
      setLoading(false);
      setModels(uniqueModels);
      setSelectedModelId((current) =>
        resolveSelectedModel(current, uniqueModels, selectedProvider.id),
      );
      return;
    }

    let cancelled = false;
    setLoading(true);

    const handleModels = (nextModels: ProviderModel[], errorLabel: string) => {
      if (cancelled) return;
      const uniqueModels = dedupeModels(nextModels);

      if (uniqueModels.length === 0) {
        toast.error(errorLabel, { duration: 8000 });
      }

      setModels(uniqueModels);
      setSelectedModelId((current) =>
        resolveSelectedModel(current, uniqueModels, selectedProvider.id),
      );
    };

    const handleError = (error: unknown, label: string) => {
      if (cancelled) return;
      toast.error(error instanceof Error ? error.message : label);
      setModels([]);
      setSelectedModelId("");
    };

    const handleFinally = () => {
      if (!cancelled) setLoading(false);
    };

    apiJson<{ models: ProviderModel[] }>(`${selectedProvider.base}/api/models`)
      .then((payload) => handleModels(payload.models ?? [], "Nenhum modelo disponível."))
      .catch((e) => handleError(e, "Falha ao carregar modelos."))
      .finally(handleFinally);

    return () => {
      cancelled = true;
    };
  }, [
    selectedProvider,
    selectedProviderId,
    selectedProviderReady,
  ]);

  useEffect(() => {
    if (!selectedProvider || !selectedModelId || typeof globalThis.window === "undefined") return;
    globalThis.localStorage.setItem(`selected-model:${selectedProvider.id}`, selectedModelId);
  }, [selectedModelId, selectedProvider]);

  const selectedModel = models.find((m) => m.id === selectedModelId) ?? null;

  return { loading, models, selectedModel, selectedModelId, setSelectedModelId };
}
