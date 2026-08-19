"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { apiJson } from "@/lib/api";
import { isValidAccentColor, type AccentColorId } from "@/lib/accent-colors";

export const ACCENT_STORAGE_KEY = "modelhub-accent";

type AccentContextValue = {
  accent: AccentColorId | null;
  setAccent: (accent: AccentColorId | null) => void;
};

const AccentContext = createContext<AccentContextValue | undefined>(undefined);

function applyAccentToDocument(accent: AccentColorId | null) {
  const root = document.documentElement;
  if (accent && accent !== "default") {
    root.setAttribute("data-accent", accent);
  } else {
    root.removeAttribute("data-accent");
  }
}

/**
 * Aplica a preferência de accent do usuário (UserSettings.accentColor) em
 * runtime. A pintura inicial acontece via script inline no layout (anti-flash,
 * lendo o localStorage); este provider sincroniza com o valor do servidor.
 */
export function AccentProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState<AccentColorId | null>(null);
  const localChangeVersionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function loadAccent() {
      const loadVersion = localChangeVersionRef.current;
      const locallyApplied = document.documentElement.getAttribute("data-accent");
      if (isValidAccentColor(locallyApplied)) {
        setAccentState(locallyApplied);
      }

      try {
        const data = await apiJson<{ settings?: { accentColor?: string | null } }>(
          "/user/settings",
        );
        if (cancelled || loadVersion !== localChangeVersionRef.current) return;
        if (data.settings && "accentColor" in data.settings) {
          const stored = data.settings.accentColor;
          const next = isValidAccentColor(stored) ? stored : "default";
          setAccentState(next);
          applyAccentToDocument(next);
          try {
            if (next === "default") {
              window.localStorage.removeItem(ACCENT_STORAGE_KEY);
            } else {
              window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
            }
          } catch {
            // localStorage bloqueado: o valor do servidor ainda vale nesta aba.
          }
        }
      } catch {
        // Sem sessão ou offline: mantém o que o script inline aplicou.
      }
    }

    void loadAccent();
    return () => {
      cancelled = true;
    };
  }, []);

  const setAccent = useCallback((next: AccentColorId | null) => {
    localChangeVersionRef.current += 1;
    setAccentState(next);
    applyAccentToDocument(next);
    try {
      if (next && next !== "default") {
        window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
      } else {
        window.localStorage.removeItem(ACCENT_STORAGE_KEY);
      }
    } catch {
      // localStorage bloqueado: apenas não persiste localmente.
    }
  }, []);

  return <AccentContext.Provider value={{ accent, setAccent }}>{children}</AccentContext.Provider>;
}

export function useAccent(): AccentContextValue {
  const ctx = useContext(AccentContext);
  if (!ctx) throw new Error("useAccent must be used within AccentProvider");
  return ctx;
}
