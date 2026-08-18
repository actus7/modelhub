import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "../lib/db";
import { jsonErrorResponse } from "../lib/provider-core";
import { authenticateAccess, protectedCors, securityHeaders } from "../lib/security";
import { requireAuth } from "./route-helpers";

const app = new Hono().basePath("/canvas");
app.use("*", securityHeaders);
app.use("*", protectedCors);
app.use("*", async (c, next) => {
  const authError = await authenticateAccess(c);
  if (authError) return authError;
  return next();
});

const canvasKindSchema = z.enum(["markdown", "code", "html", "react", "mermaid"]);

const canvasUpdateSchema = z.object({
  content: z.string().max(2_000_000).optional(),
  kind: canvasKindSchema.optional(),
  language: z.string().max(64).nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

const canvasCreateInConversationSchema = z.object({
  content: z.string().min(1).max(2_000_000),
  kind: canvasKindSchema,
  language: z.string().max(64).nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

const pinSchema = z.object({ projectId: z.string().min(1) });

type CanvasRecord = {
  activeVersion: number;
  conversationId: string;
  createdAt: Date;
  id: string;
  kind: string;
  language: string | null;
  shareToken: string | null;
  title: string;
  updatedAt: Date;
};

async function requireCanvas(c: Context, userId: string, canvasId: string) {
  const canvas = await prisma.canvas.findFirst({
    where: { id: canvasId, conversation: { userId } },
  });
  return canvas ?? null;
}

async function resolveCanvasDetail(canvasId: string) {
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    include: {
      versions: { orderBy: { version: "desc" }, select: { createdAt: true, kind: true, language: true, version: true } },
    },
  });
  if (!canvas) return null;

  const activeVersion = await prisma.canvasVersion.findUnique({
    where: { canvasId_version: { canvasId, version: canvas.activeVersion } },
    select: { content: true },
  });

  return {
    canvas: {
      activeVersion: canvas.activeVersion,
      content: activeVersion?.content ?? "",
      conversationId: canvas.conversationId,
      createdAt: canvas.createdAt,
      id: canvas.id,
      kind: canvas.kind,
      language: canvas.language,
      shareToken: canvas.shareToken,
      title: canvas.title,
      updatedAt: canvas.updatedAt,
      versions: canvas.versions,
    },
  };
}

type AuthorizedCanvas = {
  canvas: NonNullable<Awaited<ReturnType<typeof requireCanvas>>>;
  canvasId: string;
  userId: string;
};

async function authorizeCanvas(c: Context): Promise<AuthorizedCanvas | Response> {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const canvasId = c.req.param("id");
  if (!canvasId) return jsonErrorResponse(404, "Canvas not found");

  const canvas = await requireCanvas(c, userId, canvasId);
  if (!canvas) return jsonErrorResponse(404, "Canvas not found");

  return { canvas, canvasId, userId };
}

// GET /canvas/:id — detalhe (content da versão ativa)
app.get("/:id", async (c) => {
  const auth = await authorizeCanvas(c);
  if (auth instanceof Response) return auth;

  const detail = await resolveCanvasDetail(auth.canvasId);
  if (!detail) return jsonErrorResponse(404, "Canvas not found");

  return c.json(detail);
});

// PATCH /canvas/:id — atualiza título/kind/language/content (content diferente ⇒ nova versão)
app.patch("/:id", async (c) => {
  const auth = await authorizeCanvas(c);
  if (auth instanceof Response) return auth;
  const { canvas, canvasId } = auth;

  const parsed = canvasUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid canvas payload");
  }

  const { content, kind, language, title } = parsed.data;

  if (content !== undefined && content !== canvas.content) {
    const lastVersion = await prisma.canvasVersion.findFirst({
      where: { canvasId },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    await prisma.$transaction([
      prisma.canvasVersion.create({
        data: {
          canvasId,
          content,
          kind: kind ?? canvas.kind,
          language: language ?? canvas.language,
          version: (lastVersion?.version ?? 0) + 1,
        },
      }),
      prisma.canvas.update({
        where: { id: canvasId },
        data: {
          activeVersion: (lastVersion?.version ?? 0) + 1,
          ...(content !== undefined ? { content } : {}),
          ...(kind !== undefined ? { kind } : {}),
          ...(language !== undefined ? { language } : {}),
          ...(title !== undefined ? { title } : {}),
        },
      }),
    ]);
  } else {
    await prisma.canvas.update({
      where: { id: canvasId },
      data: {
        ...(kind !== undefined ? { kind } : {}),
        ...(language !== undefined ? { language } : {}),
        ...(title !== undefined ? { title } : {}),
      },
    });
  }

  const detail = await resolveCanvasDetail(canvasId);
  if (!detail) return jsonErrorResponse(404, "Canvas not found");

  return c.json(detail);
});

// DELETE /canvas/:id
app.delete("/:id", async (c) => {
  const auth = await authorizeCanvas(c);
  if (auth instanceof Response) return auth;

  await prisma.canvas.delete({ where: { id: auth.canvasId } });
  return c.json({ success: true });
});

// GET /canvas/:id/versions — índice de versões (sem content)
app.get("/:id/versions", async (c) => {
  const auth = await authorizeCanvas(c);
  if (auth instanceof Response) return auth;

  const versions = await prisma.canvasVersion.findMany({
    where: { canvasId: auth.canvasId },
    select: { createdAt: true, kind: true, language: true, version: true },
    orderBy: { version: "desc" },
  });

  return c.json({ versions });
});

// GET /canvas/:id/versions/:version — versão com content
app.get("/:id/versions/:version", async (c) => {
  const auth = await authorizeCanvas(c);
  if (auth instanceof Response) return auth;

  const versionNumber = Number.parseInt(c.req.param("version") ?? "", 10);
  if (!Number.isFinite(versionNumber)) {
    return jsonErrorResponse(400, "Invalid version");
  }

  const version = await prisma.canvasVersion.findUnique({
    where: { canvasId_version: { canvasId: auth.canvasId, version: versionNumber } },
    select: { content: true, createdAt: true, kind: true, language: true, version: true },
  });

  if (!version) return jsonErrorResponse(404, "Version not found");

  return c.json({ version });
});

// POST /canvas/:id/versions/:version/restore — restaura versão como nova versão ativa
app.post("/:id/versions/:version/restore", async (c) => {
  const auth = await authorizeCanvas(c);
  if (auth instanceof Response) return auth;
  const { canvasId } = auth;

  const versionNumber = Number.parseInt(c.req.param("version") ?? "", 10);
  if (!Number.isFinite(versionNumber)) {
    return jsonErrorResponse(400, "Invalid version");
  }

  const source = await prisma.canvasVersion.findUnique({
    where: { canvasId_version: { canvasId, version: versionNumber } },
    select: { content: true, kind: true, language: true },
  });
  if (!source) return jsonErrorResponse(404, "Version not found");

  const lastVersion = await prisma.canvasVersion.findFirst({
    where: { canvasId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  await prisma.$transaction([
    prisma.canvasVersion.create({
      data: {
        canvasId,
        content: source.content,
        kind: source.kind,
        language: source.language,
        version: (lastVersion?.version ?? 0) + 1,
      },
    }),
    prisma.canvas.update({
      where: { id: canvasId },
      data: {
        activeVersion: (lastVersion?.version ?? 0) + 1,
        content: source.content,
        kind: source.kind,
        language: source.language,
      },
    }),
  ]);

  const detail = await resolveCanvasDetail(canvasId);
  if (!detail) return jsonErrorResponse(404, "Canvas not found");

  return c.json(detail);
});

// POST /canvas/:id/share — gera (idempotente) token público
app.post("/:id/share", async (c) => {
  const auth = await authorizeCanvas(c);
  if (auth instanceof Response) return auth;
  const { canvas, canvasId } = auth;

  if (canvas.shareToken) {
    return c.json({ shareToken: canvas.shareToken });
  }

  const shareToken = crypto.randomUUID();
  await prisma.canvas.update({ where: { id: canvasId }, data: { shareToken } });
  return c.json({ shareToken }, 201);
});

// DELETE /canvas/:id/share — revoga token
app.delete("/:id/share", async (c) => {
  const auth = await authorizeCanvas(c);
  if (auth instanceof Response) return auth;

  await prisma.canvas.update({
    where: { id: auth.canvasId },
    data: { shareToken: null },
  });
  return c.json({ success: true });
});

// POST /canvas/:id/pin — fixa snapshot do canvas em um projeto
app.post("/:id/pin", async (c) => {
  const auth = await authorizeCanvas(c);
  if (auth instanceof Response) return auth;
  const { canvas, canvasId, userId } = auth;

  const parsed = pinSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonErrorResponse(400, "projectId is required");
  }

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, userId },
    select: { id: true },
  });
  if (!project) return jsonErrorResponse(404, "Project not found");

  const existing = await prisma.projectArtifact.findFirst({
    where: { projectId: project.id, sourceCanvasId: canvasId },
    select: { id: true },
  });
  if (existing) {
    return c.json({ artifactId: existing.id }, 409);
  }

  const artifact = await prisma.projectArtifact.create({
    data: {
      currentVersion: 1,
      kind: canvas.kind,
      language: canvas.language,
      projectId: project.id,
      sourceCanvasId: canvasId,
      sourceConversationId: canvas.conversationId,
      title: canvas.title,
      versions: {
        create: { content: canvas.content, version: 1 },
      },
    },
    include: { versions: { orderBy: { version: "desc" }, select: { createdAt: true, version: true } } },
  });

  const activeContent = await prisma.artifactVersion.findUnique({
    where: { artifactId_version: { artifactId: artifact.id, version: 1 } },
    select: { content: true },
  });

  return c.json(
    {
      artifact: {
        content: activeContent?.content ?? canvas.content,
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
    },
    201,
  );
});

export { canvasCreateInConversationSchema, canvasKindSchema };
export type { CanvasRecord };
export default app.fetch;
