"use client";

import { useEffect, useState } from "react";
import { MonitorCogIcon, MoonStarIcon, SunMediumIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function getCurrentThemeLabel(theme: string, resolvedTheme: string | undefined) {
  if (theme === "system") {
    return `Sistema (${resolvedTheme === "dark" ? "escuro" : "claro"})`;
  }

  if (theme === "dark") {
    return "Escuro";
  }

  return "Claro";
}

export function ModeToggle() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const currentTheme = theme ?? "system";

  function getNextTheme() {
    if (currentTheme === "system") return "light";
    if (currentTheme === "light") return "dark";
    return "system";
  }

  function getIcon() {
    if (!mounted) return <SunMediumIcon />;
    if (resolvedTheme === "dark") return <MoonStarIcon />;
    if (theme === "system") return <MonitorCogIcon />;
    return <SunMediumIcon />;
  }

  const nextTheme = getNextTheme();
  const label = mounted
    ? `Tema atual: ${getCurrentThemeLabel(currentTheme, resolvedTheme)}. Clique para alternar.`
    : "Alternar tema";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTheme(nextTheme)}
          aria-label={label}
          suppressHydrationWarning
        >
          {getIcon()}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
