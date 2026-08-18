"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  HistoryIcon,
  Loader2Icon,
  PinIcon,
  ShareIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CanvasDetail, CanvasKind, ProjectSummary } from "@/lib/contracts";
import {
  getCanvasVersion,
  pinCanvas,
  restoreCanvasVersion,
  revokeCanvasShare,
  shareCanvas,
  updateCanvas,
} from "@/lib/canvas-client";
import { CanvasPreview } from "./canvas-preview";

/** Linguagem usada ao exibir o código-fonte de um canvas que normalmente é renderizado. */
function sourceLanguage(kind: CanvasKind, language: string | null | undefined): string {
  if (kind === "code") return language ?? "text";
  if (kind === "react") return language ?? "tsx";
  if (kind === "html") return "html";
  if (kind === "markdown") return "markdown";
  return "text";
}

const KIND_LABEL: Record<CanvasKind, string> = {
  code: "Código",
  html: "HTML",
  markdown: "Markdown",
  mermaid: "Mermaid",
  react: "React",
};

const KIND_EXTENSION: Record<CanvasKind, string> = {
  code: "txt",
  html: "html",
  markdown: "md",
  mermaid: "mmd",
  react: "tsx",
};

export type CanvasPanelProps = {
  canvas: CanvasDetail | null;
  includeInContext: boolean;
  loading?: boolean;
  onCanvasUpdated: (canvas: CanvasDetail) => void;
  onClose: () => void;
  onIncludeInContextChange: (value: boolean) => void;
};

export function CanvasPanel({
  canvas,
  includeInContext,
  loading = false,
  onCanvasUpdated,
  onClose,
  onIncludeInContextChange,
}: CanvasPanelProps) {
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    setTitle(canvas?.title ?? "");
    setEditingTitle(false);
  }, [canvas?.id, canvas?.title]);

  const saveTitle = useCallback(async () => {
    setEditingTitle(false);
    if (!canvas || !title.trim() || title.trim() === canvas.title) {
      setTitle(canvas?.title ?? "");
      return;
    }
    setSavingTitle(true);
    try {
      onCanvasUpdated(await updateCanvas(canvas.id, { title: title.trim() }));
      toast.success("Título atualizado.");
    } catch {
      toast.error("Falha ao atualizar o título.");
      setTitle(canvas.title);
    } finally {
      setSavingTitle(false);
    }
  }, [canvas, onCanvasUpdated, title]);

  const handleCopy = async () => {
    if (!canvas) return;
    await navigator.clipboard.writeText(canvas.content);
    toast.success("Conteúdo copiado.");
  };

  const handleDownload = () => {
    if (!canvas) return;
    const extension = KIND_EXTENSION[canvas.kind];
    const blob = new Blob([canvas.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${canvas.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "canvas"}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = async () => {
    if (!canvas) return;
    setShareBusy(true);
    try {
      const token = canvas.shareToken ?? (await shareCanvas(canvas.id));
      if (!canvas.shareToken) onCanvasUpdated({ ...canvas, shareToken: token });
      await navigator.clipboard.writeText(`${globalThis.location.origin}/share/${token}`);
      toast.success("Link de compartilhamento copiado.");
    } catch {
      toast.error("Falha ao gerar link de compartilhamento.");
    } finally {
      setShareBusy(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!canvas?.shareToken) return;
    setShareBusy(true);
    try {
      await revokeCanvasShare(canvas.id);
      onCanvasUpdated({ ...canvas, shareToken: null });
      toast.success("Compartilhamento revogado.");
    } catch {
      toast.error("Falha ao revogar o compartilhamento.");
    } finally {
      setShareBusy(false);
    }
  };

  if (!canvas) {
    return (
      <div className="flex h-full items-center justify-center">
        {loading ? (
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum canvas aberto.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        {editingTitle ? (
          <Input
            autoFocus
            className="h-8 flex-1 text-sm"
            disabled={savingTitle}
            value={title}
            onBlur={() => void saveTitle()}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveTitle();
              if (event.key === "Escape") {
                setTitle(canvas.title);
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <button
            className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
            onClick={() => setEditingTitle(true)}
            title="Clique para editar o título"
            type="button"
          >
            {canvas.title}
          </button>
        )}
        <Badge className="shrink-0 text-[10px]" variant="secondary">
          {KIND_LABEL[canvas.kind]}
          {canvas.language && canvas.kind === "code" ? ` · ${canvas.language}` : ""}
        </Badge>
        <Button aria-label="Fechar canvas" size="icon-sm" variant="ghost" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* Ações */}
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border/60 px-2 py-1.5">
        {canvas.kind !== "code" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={showSource ? "Ver resultado renderizado" : "Ver código-fonte"}
                aria-pressed={showSource}
                size="icon-sm"
                variant={showSource ? "secondary" : "ghost"}
                onClick={() => setShowSource((current) => !current)}
              >
                {showSource ? <EyeIcon className="size-3.5" /> : <CodeIcon className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showSource ? "Ver resultado" : "Ver código"}</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="Copiar conteúdo" size="icon-sm" variant="ghost" onClick={() => void handleCopy()}>
              <CopyIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copiar conteúdo</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="Baixar arquivo" size="icon-sm" variant="ghost" onClick={handleDownload}>
              <DownloadIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Baixar</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="Histórico de versões" size="icon-sm" variant="ghost" onClick={() => setVersionsOpen(true)}>
              <HistoryIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Versões</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="Compartilhar canvas" disabled={shareBusy} size="icon-sm" variant="ghost" onClick={() => void handleShare()}>
              {shareBusy ? <Loader2Icon className="size-3.5 animate-spin" /> : <ShareIcon className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{canvas.shareToken ? "Copiar link público" : "Criar link público"}</TooltipContent>
        </Tooltip>
        {canvas.shareToken ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label="Revogar compartilhamento" disabled={shareBusy} size="icon-sm" variant="ghost" onClick={() => void handleRevokeShare()}>
                <TrashIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Revogar link</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="Fixar em projeto" size="icon-sm" variant="ghost" onClick={() => setPinOpen(true)}>
              <PinIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Fixar em projeto</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-2 pl-2">
          <Switch
            aria-label="Incluir canvas no contexto da IA"
            checked={includeInContext}
            id="canvas-ia-context"
            onCheckedChange={onIncludeInContextChange}
          />
          <label className="cursor-pointer text-[11px] leading-tight text-muted-foreground" htmlFor="canvas-ia-context">
            Contexto IA
          </label>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="min-h-0 flex-1 overflow-auto">
        {showSource ? (
          <CanvasPreview
            content={canvas.content}
            kind="code"
            language={sourceLanguage(canvas.kind, canvas.language)}
          />
        ) : (
          <CanvasPreview content={canvas.content} kind={canvas.kind} language={canvas.language} />
        )}
      </div>

      <VersionsDialog
        canvas={canvas}
        onOpenChange={setVersionsOpen}
        onRestored={(updated) => {
          onCanvasUpdated(updated);
          setVersionsOpen(false);
          toast.success("Versão restaurada como nova versão ativa.");
        }}
        open={versionsOpen}
      />
      <PinDialog canvasId={canvas.id} onOpenChange={setPinOpen} open={pinOpen} />
    </div>
  );
}

function VersionsDialog({
  canvas,
  onOpenChange,
  onRestored,
  open,
}: {
  canvas: CanvasDetail;
  onOpenChange: (open: boolean) => void;
  onRestored: (canvas: CanvasDetail) => void;
  open: boolean;
}) {
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);

  const selectVersion = async (version: number) => {
    if (version === previewVersion) {
      setPreviewVersion(null);
      setPreviewContent(null);
      return;
    }
    setLoadingVersion(true);
    setPreviewVersion(version);
    try {
      setPreviewContent((await getCanvasVersion(canvas.id, version)).content);
    } catch {
      toast.error("Falha ao carregar a versão.");
      setPreviewVersion(null);
    } finally {
      setLoadingVersion(false);
    }
  };

  const restore = async (version: number) => {
    setRestoring(version);
    try {
      onRestored(await restoreCanvasVersion(canvas.id, version));
    } catch {
      toast.error("Falha ao restaurar a versão.");
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[80vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Versões — {canvas.title}</DialogTitle>
          <DialogDescription>
            v{canvas.activeVersion} é a versão ativa. Restaurar cria uma nova versão a partir da escolhida.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr] gap-3">
          <ScrollArea className="min-h-0 rounded-lg border border-border/60">
            <div className="flex flex-col gap-0.5 p-1.5">
              {canvas.versions.map((version) => (
                <button
                  className={`flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted ${
                    previewVersion === version.version ? "bg-muted" : ""
                  }`}
                  key={version.version}
                  onClick={() => void selectVersion(version.version)}
                  type="button"
                >
                  <span className="font-medium">
                    v{version.version}
                    {version.version === canvas.activeVersion ? (
                      <Badge className="ml-1.5 h-4 px-1 text-[9px]" variant="outline">ativa</Badge>
                    ) : null}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(version.createdAt).toLocaleString("pt-BR")}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/60">
            {previewVersion === null ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Selecione uma versão para visualizar
              </div>
            ) : loadingVersion || previewContent === null ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
                  <span className="text-xs font-medium">v{previewVersion}</span>
                  {previewVersion !== canvas.activeVersion ? (
                    <Button
                      disabled={restoring !== null}
                      onClick={() => void restore(previewVersion)}
                      size="sm"
                      variant="outline"
                    >
                      {restoring === previewVersion ? <Loader2Icon className="size-3 animate-spin" /> : <HistoryIcon className="size-3" />}
                      Restaurar
                    </Button>
                  ) : (
                    <Badge variant="secondary">atual</Badge>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <CanvasPreview
                    content={previewContent}
                    kind={canvas.kind}
                    language={canvas.language}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PinDialog({
  canvasId,
  onOpenChange,
  open,
}: {
  canvasId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [pinning, setPinning] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    import("@/lib/canvas-client")
      .then(({ listProjects }) => listProjects())
      .then(setProjects)
      .catch(() => toast.error("Falha ao carregar projetos."))
      .finally(() => setLoading(false));
  }, [open]);

  const handlePin = async (projectId: string) => {
    setPinning(projectId);
    try {
      const artifact = await pinCanvas(canvasId, projectId);
      toast.success(`Canvas fixado como artefato "${artifact.title}".`);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already")) {
        toast.info("Este canvas já está fixado neste projeto.");
      } else {
        toast.error("Falha ao fixar o canvas.");
      }
    } finally {
      setPinning(null);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fixar em projeto</DialogTitle>
          <DialogDescription>
            Cria um snapshot imutável do canvas como artefato do projeto selecionado.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Você ainda não tem projetos. Crie um em Projetos para fixar canvases.
          </p>
        ) : (
          <ScrollArea className="-mx-2 max-h-72 px-2">
            <div className="flex flex-col gap-1">
              {projects.map((project) => (
                <button
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60"
                  disabled={pinning !== null}
                  key={project.id}
                  onClick={() => void handlePin(project.id)}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{project.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {project.counts.conversations} conversas · {project.counts.artifacts} artefatos
                    </span>
                  </span>
                  {pinning === project.id ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <PinIcon className="size-4 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
