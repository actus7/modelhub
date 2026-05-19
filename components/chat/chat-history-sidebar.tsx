"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiJson, apiJsonRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

type ConversationSummary = {
  id: string;
  title: string | null;
  providerId: string | null;
  modelId: string | null;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  refreshKey: number;
  mobileSheetOpen: boolean;
  onMobileSheetOpenChange: (open: boolean) => void;
};

export function ChatHistorySidebar({
  activeConversationId,
  onSelectConversation,
  onNewChat,
  refreshKey,
  mobileSheetOpen,
  onMobileSheetOpenChange,
}: Props) {
  const isMobile = useIsMobile();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const query = showArchived ? "?archived=true" : "";
      const data = await apiJson<{ conversations: ConversationSummary[] }>(`/conversations${query}`);
      setConversations(data.conversations);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations, refreshKey]);

  // Focus rename input when editing
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  async function handleDelete(id: string) {
    try {
      await apiJsonRequest(`/conversations/${id}`, "DELETE");
      setPendingDelete(null);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) onNewChat();
    } catch {
      // silently fail
    }
  }

  async function handleArchiveToggle(e: React.MouseEvent, id: string, currentlyArchived: boolean) {
    e.stopPropagation();
    try {
      await apiJsonRequest(`/conversations/${id}`, "PATCH", { archived: !currentlyArchived });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) onNewChat();
    } catch {
      // silently fail
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    try {
      await apiJsonRequest(`/conversations/${id}`, "PATCH", { title: renameValue.trim() });
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: renameValue.trim() } : c)),
      );
    } catch {
      // silently fail
    }
    setRenamingId(null);
  }

  function getDateGroup(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    if (date >= today) return "Hoje";
    if (date >= yesterday) return "Ontem";
    if (date >= weekAgo) return "Últimos 7 dias";
    if (date >= monthAgo) return "Últimos 30 dias";
    return "Anteriores";
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "agora";
    if (diffMins < 60) return `${diffMins}min`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  function getConversationTitle(title: string | null) {
    if (!title) {
      return "Nova conversa";
    }

    return title.replace(/^t[ií]tulo:\s*/i, "").trim() || "Nova conversa";
  }

  // Filter + group conversations
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => (c.title ?? "").toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const groupedConversations = useMemo(() => {
    const groups: { label: string; items: ConversationSummary[] }[] = [];
    const groupMap = new Map<string, ConversationSummary[]>();
    const order = ["Hoje", "Ontem", "Últimos 7 dias", "Últimos 30 dias", "Anteriores"];

    for (const conv of filteredConversations) {
      const group = getDateGroup(conv.updatedAt);
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(conv);
    }

    for (const label of order) {
      const items = groupMap.get(label);
      if (items?.length) groups.push({ label, items });
    }

    return groups;
  }, [filteredConversations]);

  const listContent = (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <HistoryIcon className="size-3.5" />
          Histórico
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant={showArchived ? "default" : "ghost"}
            size="icon-xs"
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? "Ver conversas ativas" : "Ver arquivadas"}
          >
            <ArchiveIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onNewChat} title="Nova conversa">
            <MessageSquarePlusIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="shrink-0 border-b border-border/40 px-2 py-1.5">
        <div className="relative">
          <SearchIcon className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar conversas..."
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
        <div className="flex flex-col gap-0.5 p-2">
          {loading && conversations.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              {searchQuery ? "Nenhum resultado" : "Nenhuma conversa salva"}
            </p>
          ) : (
            groupedConversations.map((group) => (
              <div key={group.label}>
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((conv) => (
                  <div
                    key={conv.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (renamingId === conv.id) return;
                      onSelectConversation(conv.id);
                      if (isMobile) onMobileSheetOpenChange(false);
                    }}
                    onKeyDown={(e) => {
                      if (renamingId === conv.id) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectConversation(conv.id);
                        if (isMobile) onMobileSheetOpenChange(false);
                      }
                    }}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
                      activeConversationId === conv.id && "bg-muted font-medium",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      {renamingId === conv.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handleRename(conv.id);
                              if (e.key === "Escape") setRenamingId(null);
                              e.stopPropagation();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="h-5 w-full rounded border border-border bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-5 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRename(conv.id);
                            }}
                          >
                            <CheckIcon className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-5 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingId(null);
                            }}
                          >
                            <XIcon className="size-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <p className="truncate text-xs">{getConversationTitle(conv.title)}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatDate(conv.updatedAt)}
                          </p>
                        </>
                      )}
                    </div>
                    {renamingId !== conv.id && (
                      <div className="flex shrink-0 gap-0.5 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(conv.id);
                            setRenameValue(conv.title || "");
                          }}
                          title="Renomear"
                        >
                          <PencilIcon className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-6"
                          onClick={(e) => void handleArchiveToggle(e, conv.id, !!conv.archived)}
                          title={conv.archived ? "Desarquivar" : "Arquivar"}
                        >
                          {conv.archived ? <ArchiveRestoreIcon className="size-3" /> : <ArchiveIcon className="size-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(conv);
                          }}
                          title="Excluir"
                        >
                          <Trash2Icon className="size-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <Sheet open={mobileSheetOpen} onOpenChange={onMobileSheetOpenChange}>
          <SheetContent side="right" className="w-72 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Histórico de conversas</SheetTitle>
              <SheetDescription>Lista de conversas anteriores</SheetDescription>
            </SheetHeader>
            {listContent}
          </SheetContent>
        </Sheet>
        <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDelete
                  ? `A conversa "${getConversationTitle(pendingDelete.title)}" será removida do histórico.`
                  : "Esta conversa será removida do histórico."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => pendingDelete ? void handleDelete(pendingDelete.id) : undefined}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <div className="hidden h-full min-h-0 w-64 shrink-0 flex-col border-l border-border/60 bg-background/50 md:flex">
        {listContent}
      </div>
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `A conversa "${getConversationTitle(pendingDelete.title)}" será removida do histórico.`
                : "Esta conversa será removida do histórico."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingDelete ? void handleDelete(pendingDelete.id) : undefined}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
