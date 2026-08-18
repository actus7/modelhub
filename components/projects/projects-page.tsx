"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FileIcon,
  FolderPlusIcon,
  Loader2Icon,
  MessageSquareIcon,
  PackageIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { apiJson, apiJsonRequest } from "@/lib/api";
import type { ProjectSummary } from "@/lib/contracts";

export function ProjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(searchParams.get("new") === "1");

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiJson<{ projects: ProjectSummary[] }>("/projects");
      setProjects(data.projects);
    } catch {
      setError("Falha ao carregar projetos.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (createOpen) {
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState({}, "", url.toString());
    }
  }, [createOpen]);

  const handleCreated = (id: string) => {
    setCreateOpen(false);
    router.push(`/projects/${id}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4 md:px-6">
        <div>
          <h1 className="text-base font-semibold">Projetos</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Contexto compartilhado: instruções, arquivos de conhecimento e artefatos para as conversas.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Recarregar"
            onClick={() => void load()}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshCwIcon className="size-4" />
          </Button>
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <PlusIcon className="size-4" />
            <span className="hidden sm:inline">Novo projeto</span>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {projects === null && !error ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton className="h-28 w-full" key={index} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-medium">{error}</p>
              <Button className="mt-3" onClick={() => void load()} size="sm" variant="outline">
                Tentar novamente
              </Button>
            </div>
          </div>
        ) : projects?.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Empty className="max-w-md border-border/60 bg-muted/20">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-full">
                  <FolderPlusIcon className="size-5 text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle>Nenhum projeto ainda</EmptyTitle>
                <EmptyDescription>
                  Organize conversas, arquivos e artefatos em um contexto persistente com instruções próprias.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setCreateOpen(true)} size="sm">
                  <PlusIcon className="size-4" />
                  Criar projeto
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects?.map((project) => (
              <button
                className="group flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                key={project.id}
                onClick={() => router.push(`/projects/${project.id}`)}
                type="button"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{project.name}</p>
                  <p className="mt-0.5 line-clamp-2 min-h-8 text-xs text-muted-foreground">
                    {project.description ?? "Sem descrição."}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MessageSquareIcon className="size-3" />
                    {project.counts.conversations}
                  </span>
                  <span className="flex items-center gap-1">
                    <FileIcon className="size-3" />
                    {project.counts.files}
                  </span>
                  <span className="flex items-center gap-1">
                    <PackageIcon className="size-3" />
                    {project.counts.artifacts}
                  </span>
                  <span className="ml-auto">
                    {new Date(project.updatedAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <CreateProjectDialog onCreated={handleCreated} onOpenChange={setCreateOpen} open={createOpen} />
    </div>
  );
}

export function CreateProjectDialog({
  onCreated,
  onOpenChange,
  open,
}: {
  onCreated: (id: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setInstructions("");
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Informe o nome do projeto.");
      return;
    }
    setCreating(true);
    try {
      const data = await apiJsonRequest<{ project: { id: string } }>("/projects", "POST", {
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
        name: name.trim(),
      });
      toast.success("Projeto criado.");
      onCreated(data.project.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar projeto.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo projeto</DialogTitle>
          <DialogDescription>
            Instruções e arquivos do projeto são injetados no contexto de todas as conversas vinculadas.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!name.trim() ? "" : undefined}>
            <FieldLabel htmlFor="project-name">Nome</FieldLabel>
            <Input
              id="project-name"
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Documentação do produto"
              value={name}
            />
            <FieldDescription>Até 100 caracteres.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="project-description">Descrição</FieldLabel>
            <Input
              id="project-description"
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Para que serve este projeto"
              value={description}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="project-instructions">Instruções</FieldLabel>
            <Textarea
              className="min-h-24"
              id="project-instructions"
              maxLength={20_000}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Diretrizes aplicadas a todas as conversas do projeto (tom, formato, regras…)"
              value={instructions}
            />
            <FieldDescription>Injetadas no system context de cada mensagem enviada no projeto.</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="mt-2 flex justify-end gap-2">
          <Button disabled={creating} onClick={() => onOpenChange(false)} variant="outline">
            Cancelar
          </Button>
          <Button disabled={creating || !name.trim()} onClick={() => void submit()}>
            {creating ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Criar projeto
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
