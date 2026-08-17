"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  DownloadIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { apiJson, apiJsonRequest } from "@/lib/api";
import {
  buildExportFilename,
  conversationToJson,
  conversationToMarkdown,
  downloadTextFile,
} from "@/lib/conversation-export";
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
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Busca server-side (título + conteúdo das mensagens) com debounce.
  const debouncedSearch = useDebouncedValue(searchQuery.trim(), 300);
  const isSearching = debouncedSearch.length >= 2;

  const fetchConversations = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (showArchived) params.set("archived", "true");
      if (search) params.set("q", search);
      const qs = params.toString();
      const data = await apiJson<{ conversations: ConversationSummary[] }>(
        `/conversations${qs ? `?${qs}` : ""}`,
      );
      setConversations(data.conversations);
      setSelectedIds(new Set());
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void fetchConversations(isSearching ? debouncedSearch : "");
  }, [fetchConversations, refreshKey, debouncedSearch, isSearching]);

  // Focus rename input when editing
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  async function handleDelete(id: string) {
    try {
      await apiJsonRequest(`/conversations/${id}`, "DELETE");
      setPendingDelete(null);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) onNewChat();
    } catch {
      // silently fail
    }
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setBulkWorking(true);
    try {
      await Promise.all(ids.map((id) => apiJsonRequest(`/conversations/${id}`, "DELETE")));
      setPendingBulkDelete(false);
      setSelectedIds(new Set());
      setConversations((prev) => prev.filter((c) => !selectedIds.has(c.id)));
      if (activeConversationId && selectedIds.has(activeConversationId)) onNewChat();
    } catch {
      // silently fail
    } finally {
      setBulkWorking(false);
    }
  }

  async function handleBulkArchiveToggle() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setBulkWorking(true);
    try {
      await Promise.all(ids.map((id) => apiJsonRequest(`/conversations/${id}`, "PATCH", { archived: !showArchived })));
      setSelectedIds(new Set());
      setConversations((prev) => prev.filter((c) => !selectedIds.has(c.id)));
      if (activeConversationId && selectedIds.has(activeConversationId)) onNewChat();
    } catch {
      // silently fail
    } finally {
      setBulkWorking(false);
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

  async function handleExportConversation(
    conv: ConversationSummary,
    format: "json" | "md",
  ) {
    try {
      const data = await apiJson<{
        conversation: ConversationSummary;
        messages: Array<{ content: string; createdAt: string; id: string; role: string }>;
      }>(`/conversations/${conv.id}/messages`);

      const filename = buildExportFilename(getConversationTitle(conv.title), format);
      if (format === "json") {
        downloadTextFile(filename, "application/json", conversationToJson(data.conversation, data.messages));
        toast.success("Conversa exportada como JSON.");
      } else {
        downloadTextFile(filename, "text/markdown", conversationToMarkdown(data.conversation, data.messages));
        toast.success("Conversa exportada como Markdown.");
      }
    } catch {
      toast.error("Falha ao exportar a conversa.");
    }
  }

  // Filter + group conversations
  const filteredConversations = useMemo(() => {
    // Busca ativa: o servidor já filtrou por título E conteúdo das mensagens.
    if (isSearching) return conversations;
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => (c.title ?? "").toLowerCase().includes(q));
  }, [conversations, searchQuery, isSearching]);

  const selectedCount = selectedIds.size;
  const allVisibleSelected = filteredConversations.length > 0 && filteredConversations.every((c) => selectedIds.has(c.id));

  function toggleConversationSelected(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      if (allVisibleSelected) return new Set();
      const next = new Set(current);
      filteredConversations.forEach((conversation) => next.add(conversation.id));
      return next;
    });
  }

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
            className="size-8 md:size-7"
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? "Ver conversas ativas" : "Ver arquivadas"}
          >
            <ArchiveIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" className="size-8 md:size-7" onClick={onNewChat} title="Nova conversa">
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
            className="h-9 pl-7 text-base md:h-7 md:text-xs"
          />
        </div>
        {isSearching && (
          <p className="pt-1 text-[10px] text-muted-foreground" aria-live="polite">
            {loading
              ? "Buscando..."
              : `${filteredConversations.length} conversa${filteredConversations.length === 1 ? "" : "s"} encontrada${filteredConversations.length === 1 ? "" : "s"} — título e conteúdo das mensagens`}
          </p>
        )}
      </div>

      {selectedCount > 0 && filteredConversations.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-2 py-1.5">
          <button
            type="button"
            onClick={toggleAllVisible}
            className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded border border-border bg-background",
                allVisibleSelected && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {allVisibleSelected ? <CheckIcon className="size-3" /> : null}
            </span>
            {selectedCount > 0 ? `${selectedCount} selecionada${selectedCount > 1 ? "s" : ""}` : "Selecionar todas"}
          </button>
          {selectedCount > 0 && (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-8 md:size-7"
                onClick={() => void handleBulkArchiveToggle()}
                disabled={bulkWorking}
                title={showArchived ? "Desarquivar selecionadas" : "Arquivar selecionadas"}
              >
                {showArchived ? <ArchiveRestoreIcon className="size-3.5" /> : <ArchiveIcon className="size-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-8 text-destructive hover:text-destructive md:size-7"
                onClick={() => setPendingBulkDelete(true)}
                disabled={bulkWorking}
                title="Excluir selecionadas"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
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
                {group.items.map((conv) => {
                  const selected = selectedIds.has(conv.id);
                  return (
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
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onSelectConversation(conv.id);
                        if (isMobile) onMobileSheetOpenChange(false);
                      }
                    }}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
                      activeConversationId === conv.id && "bg-muted font-medium",
                      selected && "bg-muted/80",
                    )}
                  >
                    <button
                      type="button"
                      aria-label={selected ? "Desmarcar conversa" : "Marcar conversa"}
                      onClick={(e) => toggleConversationSelected(e, conv.id)}
                      className={cn(
                        "shrink-0 items-center justify-center rounded border transition-all",
                        selected || selectedCount > 0
                          ? "flex size-4 border-border bg-background"
                          : "hidden h-0 w-0 border-0 md:group-hover:flex md:group-hover:size-4 md:group-hover:border-border md:group-hover:bg-background",
                        selected && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {selected ? <CheckIcon className="size-3" /> : null}
                    </button>
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
                            className="h-7 w-full rounded border border-border bg-background px-1 text-base focus:outline-none focus:ring-1 focus:ring-primary md:h-5 md:text-xs"
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-7 shrink-0 md:size-5"
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
                            className="size-7 shrink-0 md:size-5"
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-8 md:size-6"
                              onClick={(e) => e.stopPropagation()}
                              title="Exportar conversa"
                            >
                              <DownloadIcon className="size-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onSelect={() => void handleExportConversation(conv, "json")}>
                              Exportar (JSON)
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void handleExportConversation(conv, "md")}>
                              Exportar (Markdown)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-8 md:size-6"
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
                          className="size-8 md:size-6"
                          onClick={(e) => void handleArchiveToggle(e, conv.id, !!conv.archived)}
                          title={conv.archived ? "Desarquivar" : "Arquivar"}
                        >
                          {conv.archived ? <ArchiveRestoreIcon className="size-3" /> : <ArchiveIcon className="size-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-8 md:size-6"
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
                  );
                })}
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
        <AlertDialog open={pendingBulkDelete} onOpenChange={setPendingBulkDelete}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir conversas selecionadas?</AlertDialogTitle>
              <AlertDialogDescription>
                {selectedCount} conversa{selectedCount === 1 ? "" : "s"} serão removidas do histórico.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void handleBulkDelete()}>
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
      <AlertDialog open={pendingBulkDelete} onOpenChange={setPendingBulkDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversas selecionadas?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCount} conversa{selectedCount === 1 ? "" : "s"} serão removidas do histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleBulkDelete()}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
