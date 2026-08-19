"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  FileIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  PackageIcon,
  PencilIcon,
  RefreshCwIcon,
  ShareIcon,
  Trash2Icon,
  UploadIcon,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiJson, apiJsonRequest } from "@/lib/api";
import type {
  ProjectArtifactSummary,
  ProjectDetail,
  ProjectFileSummary,
} from "@/lib/contracts";

type ProjectConversationSummary = {
  archived: boolean;
  createdAt: string;
  id: string;
  modelId: string | null;
  providerId: string | null;
  title: string;
  updatedAt: string;
};

export function ProjectDetailPage({
  projectId,
}: {
  projectId: string;
}) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [conversations, setConversations] = useState<ProjectConversationSummary[]>([]);
  const [files, setFiles] = useState<ProjectFileSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ProjectArtifactSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [workingArtifact, setWorkingArtifact] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadRequestRef = useRef(0);
  const router = useRouter();

  const loadAll = useCallback(async (id: string) => {
    const requestId = ++loadRequestRef.current;
    setError(null);
    try {
      const [projectData, conversationsData, filesData, artifactsData] = await Promise.all([
        apiJson<{ project: ProjectDetail }>(`/projects/${id}`),
        apiJson<{ conversations: ProjectConversationSummary[] }>(`/projects/${id}/conversations`),
        apiJson<{ files: ProjectFileSummary[] }>(`/projects/${id}/files`),
        apiJson<{ artifacts: ProjectArtifactSummary[] }>(`/projects/${id}/artifacts`),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setProject(projectData.project);
      setConversations(conversationsData.conversations);
      setFiles(filesData.files);
      setArtifacts(artifactsData.artifacts);
    } catch {
      if (requestId === loadRequestRef.current) {
        setError("Falha ao carregar o projeto.");
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadAll(projectId);
    return () => {
      loadRequestRef.current += 1;
    };
  }, [projectId, loadAll]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!projectId || !fileList?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const formData = new FormData();
        formData.append("file", file);
        const data = await apiJson<{ file: ProjectFileSummary }>(`/projects/${projectId}/files`, {
          body: formData,
          method: "POST",
        });
        setFiles((current) => [data.file, ...current]);
      }
      toast.success("Arquivo(s) enviado(s).");
    } catch (error_) {
      toast.error(error_ instanceof Error ? error_.message : "Falha no upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!projectId) return;
    try {
      await apiJsonRequest(`/projects/${projectId}/files/${fileId}`, "DELETE");
      setFiles((current) => current.filter((file) => file.id !== fileId));
    } catch {
      toast.error("Falha ao excluir o arquivo.");
    }
  };

  const handleRefreshArtifact = async (artifact: ProjectArtifactSummary) => {
    if (!projectId || !artifact.sourceCanvasId) return;
    setWorkingArtifact(artifact.id);
    try {
      await apiJsonRequest(
        `/projects/${projectId}/artifacts/${artifact.id}/refresh`,
        "POST",
        { canvasId: artifact.sourceCanvasId },
      );
      toast.success("Artefato atualizado a partir do canvas.");
      if (projectId) {
        const artifactsData = await apiJson<{ artifacts: ProjectArtifactSummary[] }>(
          `/projects/${projectId}/artifacts`,
        );
        setArtifacts(artifactsData.artifacts);
      }
    } catch (error_) {
      toast.error(error_ instanceof Error ? error_.message : "Falha ao atualizar o artefato.");
    } finally {
      setWorkingArtifact(null);
    }
  };

  const handleDeleteArtifact = async (artifactId: string) => {
    if (!projectId) return;
    try {
      await apiJsonRequest(`/projects/${projectId}/artifacts/${artifactId}`, "DELETE");
      setArtifacts((current) => current.filter((artifact) => artifact.id !== artifactId));
    } catch {
      toast.error("Falha ao excluir o artefato.");
    }
  };

  const handleShareArtifact = async (artifact: ProjectArtifactSummary) => {
    if (!artifact.shareToken) {
      toast.error("Este artefato não possui link de compartilhamento.");
      return;
    }
    try {
      await navigator.clipboard.writeText(`${globalThis.location.origin}/share/${artifact.shareToken}`);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  };

  const handleDeleteProject = async () => {
    if (!projectId) return;
    try {
      await apiJsonRequest(`/projects/${projectId}`, "DELETE");
      toast.success("Projeto excluído.");
      router.push("/projects");
    } catch {
      toast.error("Falha ao excluir o projeto.");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-medium">{error ?? "Projeto não encontrado."}</p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/projects">Voltar para projetos</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Cabeçalho */}
      <div className="shrink-0 border-b border-border/60 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild aria-label="Voltar" size="icon-sm" variant="ghost">
            <Link href="/projects">
              <ArrowLeftIcon className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{project.name}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {project.description ?? "Sem descrição"}
              {" · "}
              {project.counts.conversations} conversas · {project.counts.files} arquivos ·{" "}
              {project.counts.artifacts} artefatos
            </p>
          </div>
          <Button
            aria-label="Editar projeto"
            onClick={() => setEditOpen(true)}
            size="icon-sm"
            variant="ghost"
          >
            <PencilIcon className="size-4" />
          </Button>
          <Button
            aria-label="Excluir projeto"
            onClick={() => setDeleteOpen(true)}
            size="icon-sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
          >
            <Trash2Icon className="size-4" />
          </Button>
          <Button asChild size="sm">
            <Link href={`/chat?project=${project.id}&new=1`}>
              <MessageSquarePlusIcon className="size-4" />
              <span className="hidden sm:inline">Nova conversa</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Seções */}
      <Tabs className="flex min-h-0 flex-1 flex-col" defaultValue="conversations">
        <TabsList className="mx-4 mt-3 w-fit md:mx-6">
          <TabsTrigger value="conversations">Conversas</TabsTrigger>
          <TabsTrigger value="files">Arquivos</TabsTrigger>
          <TabsTrigger value="artifacts">Artefatos</TabsTrigger>
        </TabsList>

        <TabsContent className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6" value="conversations">
          {conversations.length === 0 ? (
            <Empty className="mx-auto max-w-md border-border/60 bg-muted/20">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-full">
                  <MessageSquarePlusIcon className="size-5 text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle>Nenhuma conversa</EmptyTitle>
                <EmptyDescription>
                  As conversas vinculadas a este projeto aparecem aqui.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild size="sm">
                  <Link href={`/chat?project=${project.id}&new=1`}>Iniciar conversa</Link>
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              {conversations.map((conversation) => (
                <Link
                  className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
                  href={`/chat?conversation=${conversation.id}`}
                  key={conversation.id}
                >
                  <MessageSquarePlusIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{conversation.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {conversation.providerId ?? "—"}
                      {conversation.modelId ? ` · ${conversation.modelId}` : ""} ·{" "}
                      {new Date(conversation.updatedAt).toLocaleDateString("pt-BR")}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6" value="files">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Arquivos de conhecimento: o texto extraído é injetado no contexto das conversas do projeto.
              </p>
              <input
                accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.doc,.docx"
                className="hidden"
                multiple
                onChange={(event) => void handleUpload(event.target.files)}
                ref={fileInputRef}
                type="file"
              />
              <Button
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                variant="outline"
              >
                {uploading ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <UploadIcon className="size-4" />
                )}
                Enviar
              </Button>
            </div>
            {files.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum arquivo enviado ainda.
              </p>
            ) : (
              files.map((file) => (
                <div
                  className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3"
                  key={file.id}
                >
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{file.fileName}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {file.mimeType} · {(file.byteSize / 1024).toFixed(1)} KB ·{" "}
                      {new Date(file.createdAt).toLocaleDateString("pt-BR")}
                    </span>
                  </span>
                  <Button
                    asChild
                    aria-label={`Abrir ${file.fileName}`}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <a href={`/projects/${project.id}/files/${file.id}/content`} rel="noreferrer" target="_blank">
                      <FileIcon className="size-4" />
                    </a>
                  </Button>
                  <Button
                    aria-label={`Excluir ${file.fileName}`}
                    onClick={() => void handleDeleteFile(file.id)}
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6" value="artifacts">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {artifacts.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum artefato. Fixe um canvas do chat para criar o primeiro snapshot.
              </p>
            ) : (
              artifacts.map((artifact) => (
                <div
                  className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3"
                  key={artifact.id}
                >
                  <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{artifact.title}</span>
                      <Badge variant="secondary">{artifact.kind}</Badge>
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      v{artifact.currentVersion} ·{" "}
                      {new Date(artifact.updatedAt).toLocaleDateString("pt-BR")}
                      {artifact.sourceCanvasId ? " · originado de canvas" : ""}
                    </span>
                  </span>
                  {artifact.sourceCanvasId ? (
                    <Button
                      aria-label="Atualizar a partir do canvas"
                      disabled={workingArtifact === artifact.id}
                      onClick={() => void handleRefreshArtifact(artifact)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      {workingArtifact === artifact.id ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <RefreshCwIcon className="size-4" />
                      )}
                    </Button>
                  ) : null}
                  {artifact.shareToken ? (
                    <Button
                      aria-label="Copiar link público"
                      onClick={() => void handleShareArtifact(artifact)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <ShareIcon className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    aria-label="Excluir artefato"
                    onClick={() => void handleDeleteArtifact(artifact.id)}
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      <EditProjectDialog
        onOpenChange={setEditOpen}
        onSaved={(updated) => {
          setProject(updated);
          setEditOpen(false);
        }}
        open={editOpen}
        project={project}
      />

      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              O projeto &quot;{project.name}&quot; e todas as suas conversas, arquivos e artefatos serão
              excluídos permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDeleteProject()}
            >
              Excluir projeto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditProjectDialog({
  project,
  onOpenChange,
  onSaved,
  open,
}: {
  project: ProjectDetail;
  onOpenChange: (open: boolean) => void;
  onSaved: (project: ProjectDetail) => void;
  open: boolean;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [instructions, setInstructions] = useState(project.instructions ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(project.name);
      setDescription(project.description ?? "");
      setInstructions(project.instructions ?? "");
    }
  }, [open, project]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Informe o nome do projeto.");
      return;
    }
    setSaving(true);
    try {
      const data = await apiJsonRequest<{ project: ProjectDetail }>(
        `/projects/${project.id}`,
        "PATCH",
        {
          description: description.trim() || null,
          instructions: instructions.trim() || null,
          name: name.trim(),
        },
      );
      toast.success("Projeto atualizado.");
      onSaved(data.project);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar o projeto.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar projeto</DialogTitle>
          <DialogDescription>Instruções aplicadas ao contexto de todas as conversas.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="edit-project-name">Nome</FieldLabel>
            <Input
              id="edit-project-name"
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-project-description">Descrição</FieldLabel>
            <Input
              id="edit-project-description"
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-project-instructions">Instruções</FieldLabel>
            <Textarea
              className="min-h-24"
              id="edit-project-instructions"
              maxLength={20_000}
              onChange={(event) => setInstructions(event.target.value)}
              value={instructions}
            />
            <FieldDescription>Injetadas no system context das conversas do projeto.</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="mt-2 flex justify-end gap-2">
          <Button disabled={saving} onClick={() => onOpenChange(false)} variant="outline">
            Cancelar
          </Button>
          <Button disabled={saving || !name.trim()} onClick={() => void submit()}>
            {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
