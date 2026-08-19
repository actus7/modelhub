import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import {
  extractDocumentText,
  getAttachmentValidationError,
  readUploadedFile,
  resolveAttachmentKind,
} from "../lib/conversation-attachments";
import { prisma } from "../lib/db";
import { jsonErrorResponse } from "../lib/provider-core";
import { authenticateAccess, protectedCors, securityHeaders } from "../lib/security";
import { requireAuth } from "./route-helpers";

const app = new Hono().basePath("/projects");
app.use("*", securityHeaders);
app.use("*", protectedCors);
app.use("*", async (c, next) => {
  const authError = await authenticateAccess(c);
  if (authError) return authError;
  return next();
});

const CONTEXT_PER_FILE_CHAR_CAP = 20_000;
const CONTEXT_TOTAL_CHAR_CAP = 60_000;

const projectCreateSchema = z.object({
  description: z.string().max(2000).optional(),
  instructions: z.string().max(20_000).optional(),
  name: z.string().trim().min(1).max(100),
});

const projectUpdateSchema = z.object({
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(20_000).nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
});

async function requireProject(c: Context, userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  return project ?? null;
}

type AuthorizedProject = {
  project: NonNullable<Awaited<ReturnType<typeof requireProject>>>;
  projectId: string;
  userId: string;
};

async function authorizeProject(c: Context): Promise<AuthorizedProject | Response> {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const projectId = c.req.param("id");
  if (!projectId) return jsonErrorResponse(404, "Project not found");

  const project = await requireProject(c, userId, projectId);
  if (!project) return jsonErrorResponse(404, "Project not found");

  return { project, projectId, userId };
}

// GET /projects — lista projetos do usuário com contadores
app.get("/", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const projects = await prisma.project.findMany({
    where: { userId },
    select: {
      _count: { select: { artifacts: true, conversations: true, files: true } },
      createdAt: true,
      description: true,
      id: true,
      name: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return c.json({
    projects: projects.map((project) => ({
      counts: {
        artifacts: project._count.artifacts,
        conversations: project._count.conversations,
        files: project._count.files,
      },
      createdAt: project.createdAt,
      description: project.description,
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    })),
  });
});

// POST /projects — cria projeto
app.post("/", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const parsed = projectCreateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid project payload");
  }

  const project = await prisma.project.create({
    data: {
      description: parsed.data.description ?? null,
      instructions: parsed.data.instructions ?? null,
      name: parsed.data.name,
      userId,
    },
    select: { createdAt: true, description: true, id: true, instructions: true, name: true, updatedAt: true },
  });

  return c.json({ project }, 201);
});

// GET /projects/:id — detalhe
app.get("/:id", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;

  const counts = await prisma.project.findUnique({
    where: { id: auth.projectId },
    select: { _count: { select: { artifacts: true, conversations: true, files: true } } },
  });

  return c.json({
    project: {
      counts: {
        artifacts: counts?._count.artifacts ?? 0,
        conversations: counts?._count.conversations ?? 0,
        files: counts?._count.files ?? 0,
      },
      createdAt: auth.project.createdAt,
      description: auth.project.description,
      id: auth.project.id,
      instructions: auth.project.instructions,
      name: auth.project.name,
      updatedAt: auth.project.updatedAt,
    },
  });
});

// PATCH /projects/:id — atualiza nome/descrição/instruções
app.patch("/:id", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId } = auth;

  const parsed = projectUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid project payload");
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: parsed.data,
    select: { createdAt: true, description: true, id: true, instructions: true, name: true, updatedAt: true },
  });

  return c.json({ project });
});

// DELETE /projects/:id — remove projeto (cascata: conversas, arquivos, artefatos)
app.delete("/:id", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;

  await prisma.project.delete({ where: { id: auth.projectId } });
  return c.json({ success: true });
});

// GET /projects/:id/conversations — conversas do projeto
app.get("/:id/conversations", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId } = auth;

  const conversations = await prisma.conversation.findMany({
    where: { projectId, userId: auth.userId },
    select: {
      archived: true,
      createdAt: true,
      id: true,
      modelId: true,
      providerId: true,
      title: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return c.json({ conversations });
});

// POST /projects/:id/files — upload de arquivo de conhecimento
app.post("/:id/files", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId } = auth;

  const formData = await c.req.raw.formData().catch(() => null);
  if (!formData) {
    return jsonErrorResponse(400, "Invalid multipart payload");
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    return jsonErrorResponse(400, "File is required");
  }

  const validationError = getAttachmentValidationError(fileValue);
  if (validationError) {
    return jsonErrorResponse(400, validationError);
  }

  const kind = resolveAttachmentKind(fileValue.type);
  if (!kind) {
    return jsonErrorResponse(400, "Unsupported file type");
  }

  const buffer = await readUploadedFile(fileValue);
  const extraction =
    kind === "document"
      ? await extractDocumentText({ buffer, mimeType: fileValue.type })
      : { extractedText: null, extractionStatus: "completed" as const };

  const file = await prisma.projectFile.create({
    data: {
      blob: buffer,
      byteSize: fileValue.size,
      extractedText: extraction.extractedText,
      fileName: fileValue.name,
      mimeType: fileValue.type,
      projectId,
    },
    select: { byteSize: true, createdAt: true, fileName: true, id: true, mimeType: true },
  });

  return c.json({ file }, 201);
});

// GET /projects/:id/files — lista arquivos
app.get("/:id/files", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId } = auth;

  const files = await prisma.projectFile.findMany({
    where: { projectId },
    select: { byteSize: true, createdAt: true, fileName: true, id: true, mimeType: true },
    orderBy: { createdAt: "desc" },
  });

  return c.json({ files });
});

// GET /projects/:id/files/:fileId/content — serve o binário autenticado
app.get("/:id/files/:fileId/content", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId } = auth;
  const fileId = c.req.param("fileId");

  const file = await prisma.projectFile.findFirst({
    where: { id: fileId, projectId },
    select: { blob: true, fileName: true, mimeType: true },
  });

  if (!file) {
    return jsonErrorResponse(404, "File not found");
  }

  return new Response(new Uint8Array(file.blob), {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
      "Content-Type": file.mimeType,
    },
  });
});

// DELETE /projects/:id/files/:fileId
app.delete("/:id/files/:fileId", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId } = auth;
  const fileId = c.req.param("fileId");

  const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId }, select: { id: true } });
  if (!file) return jsonErrorResponse(404, "File not found");

  await prisma.projectFile.delete({ where: { id: file.id } });
  return c.json({ success: true });
});

// GET /projects/:id/artifacts — artefatos do projeto
app.get("/:id/artifacts", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId } = auth;

  const artifacts = await prisma.projectArtifact.findMany({
    where: { projectId },
    select: {
      createdAt: true,
      currentVersion: true,
      id: true,
      kind: true,
      language: true,
      projectId: true,
      shareToken: true,
      sourceCanvasId: true,
      sourceConversationId: true,
      title: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return c.json({ artifacts });
});

// GET /projects/:id/artifacts/:artifactId — detalhe (content da versão atual)
app.get("/:id/artifacts/:artifactId", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId } = auth;
  const artifactId = c.req.param("artifactId");

  const artifact = await prisma.projectArtifact.findFirst({
    where: { id: artifactId, projectId },
    include: {
      versions: { orderBy: { version: "desc" }, select: { createdAt: true, version: true } },
    },
  });

  if (!artifact) return jsonErrorResponse(404, "Artifact not found");

  const activeVersion = await prisma.artifactVersion.findUnique({
    where: { artifactId_version: { artifactId, version: artifact.currentVersion } },
    select: { content: true },
  });

  return c.json({
    artifact: {
      content: activeVersion?.content ?? "",
      createdAt: artifact.createdAt,
      currentVersion: artifact.currentVersion,
      id: artifact.id,
      kind: artifact.kind,
      language: artifact.language,
      projectId: artifact.projectId,
      shareToken: artifact.shareToken,
      sourceCanvasId: artifact.sourceCanvasId,
      sourceConversationId: artifact.sourceConversationId,
      title: artifact.title,
      updatedAt: artifact.updatedAt,
      versions: artifact.versions,
    },
  });
});

// DELETE /projects/:id/artifacts/:artifactId
app.delete("/:id/artifacts/:artifactId", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId } = auth;
  const artifactId = c.req.param("artifactId");

  const artifact = await prisma.projectArtifact.findFirst({
    where: { id: artifactId, projectId },
    select: { id: true },
  });
  if (!artifact) return jsonErrorResponse(404, "Artifact not found");

  await prisma.projectArtifact.delete({ where: { id: artifact.id } });
  return c.json({ success: true });
});

// POST /projects/:id/artifacts/:artifactId/refresh — nova versão snapshot do canvas de origem
app.post("/:id/artifacts/:artifactId/refresh", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { projectId, userId } = auth;
  const artifactId = c.req.param("artifactId");

  const body = await c.req.json().catch(() => ({})) as { canvasId?: string };
  const canvasId = body.canvasId;
  if (!canvasId) return jsonErrorResponse(400, "canvasId is required");

  const artifact = await prisma.projectArtifact.findFirst({
    where: { id: artifactId, projectId },
  });
  if (!artifact) return jsonErrorResponse(404, "Artifact not found");
  if (artifact.sourceCanvasId !== canvasId) {
    return jsonErrorResponse(409, "Artifact is not linked to this canvas");
  }

  const canvas = await prisma.canvas.findFirst({
    where: { id: canvasId, conversation: { userId } },
  });
  if (!canvas) return jsonErrorResponse(404, "Canvas not found");

  const lastVersion = await prisma.artifactVersion.findFirst({
    where: { artifactId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const nextVersion = (lastVersion?.version ?? 0) + 1;
  // Adapter Neon HTTP não suporta $transaction: writes sequenciais com
  // compensação se a atualização do artefato falhar.
  await prisma.artifactVersion.create({
    data: { artifactId, content: canvas.content, version: nextVersion },
  });
  try {
    await prisma.projectArtifact.update({
      where: { id: artifactId },
      data: {
        currentVersion: nextVersion,
        kind: canvas.kind,
        language: canvas.language,
        title: canvas.title,
      },
    });
  } catch (error) {
    await prisma.artifactVersion
      .delete({ where: { artifactId_version: { artifactId, version: nextVersion } } })
      .catch(() => undefined);
    throw error;
  }

  const refreshed = await prisma.projectArtifact.findFirst({
    where: { id: artifactId, projectId },
    include: { versions: { orderBy: { version: "desc" }, select: { createdAt: true, version: true } } },
  });

  const activeContent = await prisma.artifactVersion.findUnique({
    where: { artifactId_version: { artifactId, version: nextVersion } },
    select: { content: true },
  });

  return c.json({
    artifact: {
      content: activeContent?.content ?? "",
      createdAt: refreshed?.createdAt,
      currentVersion: nextVersion,
      id: artifactId,
      kind: refreshed?.kind,
      language: refreshed?.language,
      projectId,
      shareToken: refreshed?.shareToken,
      sourceCanvasId: refreshed?.sourceCanvasId,
      sourceConversationId: refreshed?.sourceConversationId,
      title: refreshed?.title,
      updatedAt: refreshed?.updatedAt,
      versions: refreshed?.versions ?? [],
    },
  });
});

// GET /projects/:id/context — instruções + knowledge para injeção no system prompt
app.get("/:id/context", async (c) => {
  const auth = await authorizeProject(c);
  if (auth instanceof Response) return auth;
  const { project, projectId } = auth;

  const files = await prisma.projectFile.findMany({
    where: { projectId, extractedText: { not: null } },
    select: { extractedText: true, fileName: true },
    orderBy: { createdAt: "asc" },
  });

  let remaining = CONTEXT_TOTAL_CHAR_CAP;
  const knowledge: Array<{ fileName: string; text: string }> = [];
  for (const file of files) {
    if (remaining <= 0) break;
    const text = (file.extractedText ?? "").slice(0, Math.min(CONTEXT_PER_FILE_CHAR_CAP, remaining));
    if (!text) continue;
    knowledge.push({ fileName: file.fileName, text });
    remaining -= text.length;
  }

  return c.json({ instructions: project.instructions, knowledge });
});

export default app.fetch;
