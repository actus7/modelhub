"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AuthUser,
  ProviderCatalogResponse,
  ProviderCredentialSummary,
  UiProvider,
} from "@/lib/contracts";
import { toast } from "sonner";

import { apiFetch, apiJson } from "@/lib/api";

type AppStateValue = {
  authReady: boolean;
  credentials: ProviderCredentialSummary[];
  providers: UiProvider[];
  refreshAll: () => Promise<void>;
  refreshCredentials: () => Promise<void>;
  refreshUser: () => Promise<void>;
  user: AuthUser | null;
};

const AppStateContext = createContext<AppStateValue | null>(null);

async function fetchUser(): Promise<AuthUser> {
  const response = await apiFetch("/user/me");
  if (!response.ok) {
    throw new Error(response.status === 401 ? "unauthorized" : `HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { user: AuthUser };
  return payload.user;
}

async function fetchProviders(): Promise<UiProvider[]> {
  const payload = await apiJson<ProviderCatalogResponse>("/providers/catalog");
  return payload.providers;
}

async function fetchCredentials(): Promise<ProviderCredentialSummary[]> {
  const payload = await apiJson<{ credentials: ProviderCredentialSummary[] }>("/user/credentials");
  return payload.credentials;
}

async function hydrateAppState(options: {
  setAuthReady: React.Dispatch<React.SetStateAction<boolean>>;
  setCredentials: React.Dispatch<React.SetStateAction<ProviderCredentialSummary[]>>;
  setProviders: React.Dispatch<React.SetStateAction<UiProvider[]>>;
  setUser: React.Dispatch<React.SetStateAction<AuthUser | null>>;
}) {
  // Middleware already guards these routes server-side, so the user is
  // authenticated when this runs. Fetch everything in parallel to avoid
  // the sequential waterfall (user → providers + credentials).
  const results = await Promise.allSettled([fetchUser(), fetchProviders(), fetchCredentials()]);

  const userResult = results[0];
  const providersResult = results[1];
  const credentialsResult = results[2];

  if (userResult.status === "rejected") {
    const error = userResult.reason;
    if (error instanceof Error && error.message === "unauthorized") {
      startTransition(() => {
        options.setAuthReady(true);
        options.setCredentials([]);
        options.setProviders([]);
        options.setUser(null);
      });
      return;
    }
    throw error;
  }

  startTransition(() => {
    options.setAuthReady(true);
    options.setUser(userResult.value);
    options.setProviders(providersResult.status === "fulfilled" ? providersResult.value : []);
    options.setCredentials(credentialsResult.status === "fulfilled" ? credentialsResult.value : []);
  });
}

export function AppStateProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [providers, setProviders] = useState<UiProvider[]>([]);
  const [credentials, setCredentials] = useState<ProviderCredentialSummary[]>([]);

  const refreshUser = useCallback(async () => {
    try {
      const nextUser = await fetchUser();
      startTransition(() => {
        setUser(nextUser);
      });
    } catch (error) {
      console.error("Failed to refresh user", error);
      toast.error("Não foi possível atualizar os dados do usuário.");
    }
  }, []);

  const refreshCredentials = useCallback(async () => {
    try {
      const nextCredentials = await fetchCredentials();
      startTransition(() => {
        setCredentials(nextCredentials);
      });
    } catch (error) {
      console.error("Failed to refresh credentials", error);
      toast.error("Não foi possível atualizar as credenciais.");
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await hydrateAppState({
      setAuthReady,
      setCredentials,
      setProviders,
      setUser,
    });
  }, []);

  useEffect(() => {
    hydrateAppState({
      setAuthReady,
      setCredentials,
      setProviders,
      setUser,
    }).catch((error) => {
      console.error("Failed to hydrate app state", error);
      toast.error("Não foi possível carregar sua sessão.");
      setAuthReady(true);
      setCredentials([]);
      setProviders([]);
      setUser(null);
    });
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      authReady,
      credentials,
      providers,
      refreshAll,
      refreshCredentials,
      refreshUser,
      user,
    }),
    [authReady, credentials, providers, refreshAll, refreshCredentials, refreshUser, user],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within AppStateProvider");
  }

  return context;
}
