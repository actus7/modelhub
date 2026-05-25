"use client";

import type { ComponentProps } from "react";
import { NeonAuthUIProvider } from "@neondatabase/auth/react";
import { ThemeProvider } from "next-themes";

import { authClient } from "@/lib/auth/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const uiAuthClient = authClient as unknown as ComponentProps<typeof NeonAuthUIProvider>["authClient"];

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <NeonAuthUIProvider authClient={uiAuthClient} redirectTo="/chat">
        <TooltipProvider delayDuration={100}>
          {children}
          <Toaster richColors />
        </TooltipProvider>
      </NeonAuthUIProvider>
    </ThemeProvider>
  );
}
