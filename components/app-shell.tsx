"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ActivityIcon,
  CircleHelpIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  Loader2Icon,
  LogOutIcon,
  MessageSquareTextIcon,
  PlugIcon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/client";
import { useAppState } from "@/components/app-state-provider";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";



function LoadingShell() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="gap-3">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-40" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <div
          className="flex h-svh flex-col items-center justify-center gap-2"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">A carregar a sessão…</span>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function getPageCopy(pathname: string) {
  if (pathname.startsWith("/dashboard")) {
    return {
      description: "Indicadores, chaves e atividade recente da conta.",
      title: "Dashboard",
    };
  }

  if (pathname.startsWith("/chat")) {
    return {
      description: "Converse com seus modelos e acompanhe o histórico.",
      title: "Chat",
    };
  }

  if (pathname.startsWith("/setup")) {
    return {
      description: "Conecte e teste suas integrações de IA.",
      title: "Integrações",
    };
  }

  if (pathname.startsWith("/account")) {
    return {
      description: "Gerencie preferências, acesso e segurança.",
      title: "Conta",
    };
  }

  return {
    description: "",
    title: "ModelHub",
  };
}

function getUserInitials(email: string) {
  const [local] = email.split("@");
  return (local ?? "MH").slice(0, 2).toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authReady, user } = useAppState();
  const pageCopy = getPageCopy(pathname);

  useEffect(() => {
    if (authReady && !user) {
      router.replace("/auth/sign-in");
    }
  }, [authReady, router, user]);

  async function handleLogout() {
    try {
      await authClient.signOut();
      toast.success("Sessão encerrada.");
      startTransition(() => {
        router.replace("/auth/sign-in");
        router.refresh();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao encerrar sessão.");
    }
  }

  if (!authReady || !user) {
    return <LoadingShell />;
  }

  return (
    <SidebarProvider className="min-h-0 h-svh">
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="gap-3 p-4">
          <Link href="/dashboard" className="flex items-center gap-3 rounded-xl">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <ActivityIcon />
            </div>
            <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-semibold">ModelHub</span>
              <span className="truncate text-xs text-sidebar-foreground/70">Gateway unificado para IA</span>
            </div>
          </Link>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navegação</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/dashboard"} tooltip="Dashboard">
                    <Link href="/dashboard">
                      <LayoutDashboardIcon />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/chat"} tooltip="Chat">
                    <Link href="/chat">
                      <MessageSquareTextIcon />
                      <span>Chat</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/setup"} tooltip="Integrações">
                    <Link href="/setup">
                      <PlugIcon />
                      <span>Integrações</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>Ajuda</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="Documentação"
                  >
                    <a href="https://github.com/Geeks-Zone/modelhub#readme" target="_blank" rel="noreferrer">
                      <FileTextIcon />
                      <span>Docs</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="Suporte"
                  >
                    <a href="https://github.com/Geeks-Zone/modelhub/issues" target="_blank" rel="noreferrer">
                      <CircleHelpIcon />
                      <span>Suporte</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter className="gap-3 p-4">
          <div className="flex items-center gap-3 rounded-xl border border-sidebar-border/70 bg-sidebar-accent/50 p-3 group-data-[collapsible=icon]:hidden">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/10 text-sidebar-primary">
              <UserRoundIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.email}</p>
              <p className="text-xs text-sidebar-foreground/70">Conta ativa</p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={handleLogout} aria-label="Sair">
              <LogOutIcon />
            </Button>
          </div>
          <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={user.email}>
                <span>{getUserInitials(user.email)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Sair" onClick={handleLogout}>
                <LogOutIcon />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="overflow-hidden">
        <header className="shrink-0 border-b border-border/60 bg-background/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger />
              <div className="min-w-0 flex flex-col">
                <span className="truncate text-sm font-medium">{pageCopy.title}</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">{pageCopy.description}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ModeToggle />
            </div>
          </div>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
