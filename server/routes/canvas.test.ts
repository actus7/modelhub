import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

type ConversationRecord = {
  createdAt: Date;
  id: string;
  title: string;
  updatedAt: Date;
  userId: string;
};

type CanvasRecord = {
  activeVersion: number;
  content: string;
  conversationId: string;
  createdAt: Date;
  id: string;
  kind: string;
  language: string | null;
  shareToken: string | null;
  title: string;
  updatedAt: Date;
};

type CanvasVersionRecord = {
  canvasId: string;
  content: string;
  createdAt: Date;
  id: string;
  kind: string;
  language: string | null;
  version: number;
};

type ProjectRecord = {
  createdAt: Date;
  description: string | null;
  id: string;
  instructions: string | null;
  name: string;
  updatedAt: Date;
  userId: string;
};

type ArtifactRecord = {
  createdAt: Date;
  currentVersion: number;
  id: string;
  kind: string;
  language: string | null;
  projectId: string;
  shareToken: string | null;
  sourceCanvasId: string | null;
  sourceConversationId: string | null;
  title: string;
  updatedAt: Date;
};

type ArtifactVersionRecord = {
  artifactId: string;
  content: string;
  createdAt: Date;
  id: string;
  version: number;
};

let canvasCounter = 1;
let canvasVersionCounter = 1;
let artifactCounter = 1;

const state: {
  artifacts: ArtifactRecord[];
  artifactVersions: ArtifactVersionRecord[];
  canvases: CanvasRecord[];
  canvasVersions: CanvasVersionRecord[];
  conversations: ConversationRecord[];
  projects: ProjectRecord[];
} = {
  artifacts: [],
  artifactVersions: [],
  canvases: [],
  canvasVersions: [],
  conversations: [],
  projects: [],
};

function now() {
  return new Date("2026-03-28T12:00:00.000Z");
}

function resetState() {
  canvasCounter = 1;
  canvasVersionCounter = 1;
  artifactCounter = 1;
  state.artifacts = [];
  state.artifactVersions = [];
  state.canvases = [];
  state.canvasVersions = [];
  state.conversations = [{
    createdAt: now(),
    id: "conv-1",
    title: "Nova conversa",
    updatedAt: now(),
    userId: "user-1",
  }];
  state.projects = [{
    createdAt: now(),
    description: null,
    id: "proj-1",
    instructions: "Sempre responda em pt-BR",
    name: "Projeto Alpha",
    updatedAt: now(),
    userId: "user-1",
  }];
}

const mockPrisma = {
  $transaction: vi.fn(async (operations: unknown) =>
    Array.isArray(operations) ? Promise.all(operations) : operations),
  apiKey: {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
  },
  providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
  usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
  user: { upsert: vi.fn().mockResolvedValue(null) },
  artifactVersion: {
    create: vi.fn(async ({ data }: { data: Omit<ArtifactVersionRecord, "createdAt" | "id"> }) => {
      const version: ArtifactVersionRecord = {
        ...data,
        createdAt: now(),
        id: `artifact-version-${canvasVersionCounter += 1}`,
      };
      state.artifactVersions.push(version);
      return version;
    }),
    delete: vi.fn(async ({ where }: { where: { artifactId_version: { artifactId: string; version: number } } }) => {
      state.artifactVersions = state.artifactVersions.filter(
        (version) =>
          !(
            version.artifactId === where.artifactId_version.artifactId &&
            version.version === where.artifactId_version.version
          ),
      );
      return { id: "removed" };
    }),
    findMany: vi.fn(async ({ where }: { where: { artifactId: string } }) =>
      state.artifactVersions
        .filter((version) => version.artifactId === where.artifactId)
        .sort((left, right) => right.version - left.version)),
    findUnique: vi.fn(async ({ where }: { where: { artifactId_version: { artifactId: string; version: number } } }) =>
      state.artifactVersions.find(
        (version) =>
          version.artifactId === where.artifactId_version.artifactId &&
          version.version === where.artifactId_version.version,
      ) ?? null),
  },
  canvas: {
    create: vi.fn(async ({ data, include }: {
      data: Partial<CanvasRecord> & {
        versions?: { create: Omit<CanvasVersionRecord, "createdAt" | "id"> };
      };
      include?: { versions?: unknown };
    }) => {
      const canvas: CanvasRecord = {
        activeVersion: data.activeVersion ?? 1,
        content: data.content ?? "",
        conversationId: data.conversationId ?? "",
        createdAt: now(),
        id: `canvas-${canvasCounter += 1}`,
        kind: data.kind ?? "markdown",
        language: data.language ?? null,
        shareToken: null,
        title: data.title ?? "Canvas",
        updatedAt: now(),
      };
      state.canvases.push(canvas);

      if (data.versions?.create) {
        const nested = data.versions.create;
        state.canvasVersions.push({
          ...nested,
          canvasId: canvas.id,
          createdAt: now(),
          id: `cv-${canvasVersionCounter += 1}`,
        });
      }

      if (include?.versions) {
        return {
          ...canvas,
          versions: state.canvasVersions
            .filter((version) => version.canvasId === canvas.id)
            .sort((left, right) => right.version - left.version)
            .map(({ createdAt, kind, language, version }) => ({ createdAt, kind, language, version })),
        };
      }

      return canvas;
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      state.canvases = state.canvases.filter((canvas) => canvas.id !== where.id);
      state.canvasVersions = state.canvasVersions.filter((version) => version.canvasId !== where.id);
      return { id: where.id };
    }),
    findFirst: vi.fn(async ({ where }: {
      where: { conversation?: { userId?: string }; id?: string };
    }) =>
      state.canvases.find((canvas) => {
        if (where.id && canvas.id !== where.id) return false;
        if (where.conversation?.userId) {
          const conversation = state.conversations.find((entry) => entry.id === canvas.conversationId);
          if (conversation?.userId !== where.conversation.userId) return false;
        }
        return true;
      }) ?? null),
    findUnique: vi.fn(async ({ where, include }: {
      include?: { versions?: unknown };
      where: { id?: string } | { canvasId_version?: { canvasId: string; version: number } };
    }) => {
      if ("canvasId_version" in where) {
        const canvasId = where.canvasId_version?.canvasId;
        const versionNumber = where.canvasId_version?.version;
        return state.canvasVersions.find(
          (version) => version.canvasId === canvasId && version.version === versionNumber,
        ) ?? null;
      }

      const canvas = state.canvases.find((entry) => entry.id === (where as { id?: string }).id) ?? null;
      if (!canvas) return null;
      if (include?.versions) {
        return {
          ...canvas,
          versions: state.canvasVersions
            .filter((version) => version.canvasId === canvas.id)
            .sort((left, right) => right.version - left.version)
            .map(({ createdAt, kind, language, version }) => ({ createdAt, kind, language, version })),
        };
      }
      return canvas;
    }),
    update: vi.fn(async ({ where, data }: { data: Partial<CanvasRecord>; where: { id: string } }) => {
      const canvas = state.canvases.find((entry) => entry.id === where.id);
      if (!canvas) throw new Error(`Canvas ${where.id} not found`);
      Object.assign(canvas, { ...data, updatedAt: now() });
      return canvas;
    }),
  },
  canvasVersion: {
    create: vi.fn(async ({ data }: { data: Omit<CanvasVersionRecord, "createdAt" | "id"> }) => {
      const version: CanvasVersionRecord = {
        ...data,
        createdAt: now(),
        id: `cv-${canvasVersionCounter += 1}`,
      };
      state.canvasVersions.push(version);
      return version;
    }),
    findFirst: vi.fn(async ({ where, orderBy }: {
      orderBy?: { version?: string };
      where: { canvasId: string };
    }) => {
      const versions = state.canvasVersions
        .filter((version) => version.canvasId === where.canvasId)
        .sort((left, right) =>
          orderBy?.version === "desc" ? right.version - left.version : left.version - right.version);
      return versions[0] ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: { canvasId: string } }) =>
      state.canvasVersions
        .filter((version) => version.canvasId === where.canvasId)
        .sort((left, right) => right.version - left.version)),
    findUnique: vi.fn(async ({ where }: { where: { canvasId_version: { canvasId: string; version: number } } }) =>
      state.canvasVersions.find(
        (version) =>
          version.canvasId === where.canvasId_version.canvasId &&
          version.version === where.canvasId_version.version,
      ) ?? null),
  },
  conversation: {
    findFirst: vi.fn(async ({ where }: { where: { id?: string; userId?: string } }) =>
      state.conversations.find((conversation) =>
        (!where.id || conversation.id === where.id) &&
        (!where.userId || conversation.userId === where.userId),
      ) ?? null),
  },
  project: {
    findFirst: vi.fn(async ({ where }: { where: { id?: string; userId?: string } }) =>
      state.projects.find((project) =>
        (!where.id || project.id === where.id) &&
        (!where.userId || project.userId === where.userId),
      ) ?? null),
  },
  projectArtifact: {
    create: vi.fn(async ({ data, include }: {
      data: Partial<ArtifactRecord> & { versions?: { create: Omit<ArtifactVersionRecord, "createdAt" | "id"> } };
      include?: { versions?: unknown };
    }) => {
      const artifact: ArtifactRecord = {
        createdAt: now(),
        currentVersion: data.currentVersion ?? 1,
        id: `artifact-${artifactCounter += 1}`,
        kind: data.kind ?? "markdown",
        language: data.language ?? null,
        projectId: data.projectId ?? "",
        shareToken: null,
        sourceCanvasId: data.sourceCanvasId ?? null,
        sourceConversationId: data.sourceConversationId ?? null,
        title: data.title ?? "Artefato",
        updatedAt: now(),
      };
      state.artifacts.push(artifact);

      if (data.versions?.create) {
        state.artifactVersions.push({
          ...data.versions.create,
          artifactId: artifact.id,
          createdAt: now(),
          id: `artifact-version-${canvasVersionCounter += 1}`,
        });
      }

      if (include?.versions) {
        return {
          ...artifact,
          versions: state.artifactVersions
            .filter((version) => version.artifactId === artifact.id)
            .sort((left, right) => right.version - left.version)
            .map(({ createdAt, version }) => ({ createdAt, version })),
        };
      }

      return artifact;
    }),
    findFirst: vi.fn(async ({ where }: {
      where: { id?: string; projectId?: string; sourceCanvasId?: string };
    }) =>
      state.artifacts.find((artifact) =>
        (!where.id || artifact.id === where.id) &&
        (!where.projectId || artifact.projectId === where.projectId) &&
        (!where.sourceCanvasId || artifact.sourceCanvasId === where.sourceCanvasId),
      ) ?? null),
    update: vi.fn(async ({ where, data }: { data: Partial<ArtifactRecord>; where: { id: string } }) => {
      const artifact = state.artifacts.find((entry) => entry.id === where.id);
      if (!artifact) throw new Error(`Artifact ${where.id} not found`);
      Object.assign(artifact, { ...data, updatedAt: now() });
      return artifact;
    }),
  },
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession } }));

const canvasFetch = (await import("../routes/canvas")).default;

function seedCanvas(overrides: Partial<CanvasRecord> = {}): CanvasRecord {
  const canvas: CanvasRecord = {
    activeVersion: 1,
    content: "# Documento\n\nConteúdo inicial.",
    conversationId: "conv-1",
    createdAt: now(),
    id: `canvas-${canvasCounter += 1}`,
    kind: "markdown",
    language: null,
    shareToken: null,
    title: "Documento",
    updatedAt: now(),
    ...overrides,
  };
  state.canvases.push(canvas);
  state.canvasVersions.push({
    canvasId: canvas.id,
    content: canvas.content,
    createdAt: now(),
    id: `cv-${canvasVersionCounter += 1}`,
    kind: canvas.kind,
    language: canvas.language,
    version: 1,
  });
  return canvas;
}

describe("canvas routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    getSession.mockResolvedValue({
      data: {
        session: { id: "session-1" },
        user: { email: "user@example.com", id: "user-1", name: "User" },
      },
    });
  });

  afterEach(() => {
    getSession.mockReset();
  });

  it("retorna 404 para canvas de outro usuário", async () => {
    state.conversations.push({ createdAt: now(), id: "conv-other", title: "Outro", updatedAt: now(), userId: "user-2" });
    const canvas = seedCanvas({ conversationId: "conv-other" });

    const response = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}`));
    expect(response.status).toBe(404);
  });

  it("PATCH cria nova versão quando o conteúdo difere e não cria quando é idêntico", async () => {
    const canvas = seedCanvas();

    const sameContent = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}`, {
      body: JSON.stringify({ content: canvas.content }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));
    expect(sameContent.status).toBe(200);
    expect(state.canvasVersions.filter((version) => version.canvasId === canvas.id)).toHaveLength(1);

    const changed = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}`, {
      body: JSON.stringify({ content: "# Documento\n\nConteúdo revisado." }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));
    expect(changed.status).toBe(200);
    const payload = await changed.json() as { canvas: { activeVersion: number; content: string } };
    expect(payload.canvas.activeVersion).toBe(2);
    expect(payload.canvas.content).toContain("revisado");
    expect(state.canvasVersions.filter((version) => version.canvasId === canvas.id)).toHaveLength(2);
  });

  it("registra language null na nova versao quando o cliente limpa a linguagem", async () => {
    const canvas = seedCanvas({ kind: "code", language: "typescript" });

    const response = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}`, {
      body: JSON.stringify({ content: "const value = 2", language: null }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));

    expect(response.status).toBe(200);
    const latest = state.canvasVersions
      .filter((version) => version.canvasId === canvas.id)
      .sort((left, right) => right.version - left.version)[0];
    expect(latest?.language).toBeNull();
    expect(state.canvases.find((entry) => entry.id === canvas.id)?.language).toBeNull();
  });

  it("restaura uma versão anterior como nova versão ativa", async () => {
    const canvas = seedCanvas();

    await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}`, {
      body: JSON.stringify({ content: "Versão 2" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));

    const restore = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}/versions/1/restore`, {
      method: "POST",
    }));
    expect(restore.status).toBe(200);
    const payload = await restore.json() as { canvas: { activeVersion: number; content: string } };
    expect(payload.canvas.activeVersion).toBe(3);
    expect(payload.canvas.content).toBe(canvas.content);
    expect(state.canvasVersions.filter((version) => version.canvasId === canvas.id)).toHaveLength(3);
  });

  it("compartilhamento é idempotente e revogável", async () => {
    const canvas = seedCanvas();

    const first = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}/share`, { method: "POST" }));
    expect(first.status).toBe(201);
    const firstPayload = await first.json() as { shareToken: string };
    expect(firstPayload.shareToken).toBeTruthy();

    const second = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}/share`, { method: "POST" }));
    expect(second.status).toBe(200);
    const secondPayload = await second.json() as { shareToken: string };
    expect(secondPayload.shareToken).toBe(firstPayload.shareToken);

    const revoke = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}/share`, { method: "DELETE" }));
    expect(revoke.status).toBe(200);
    expect(state.canvases.find((entry) => entry.id === canvas.id)?.shareToken).toBeNull();
  });

  it("fixa snapshot do canvas em projeto e devolve 409 em duplicata", async () => {
    const canvas = seedCanvas({ content: "graph TD\nA-->B" , kind: "mermaid", title: "Diagrama" });

    const pin = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}/pin`, {
      body: JSON.stringify({ projectId: "proj-1" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(pin.status).toBe(201);
    const pinPayload = await pin.json() as { artifact: { content: string; currentVersion: number; id?: string; kind: string; sourceCanvasId: string } };
    expect(pinPayload.artifact.currentVersion).toBe(1);
    expect(pinPayload.artifact.kind).toBe("mermaid");
    expect(pinPayload.artifact.sourceCanvasId).toBe(canvas.id);
    expect(pinPayload.artifact.content).toContain("graph TD");
    expect(state.artifactVersions).toHaveLength(1);

    const duplicate = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}/pin`, {
      body: JSON.stringify({ projectId: "proj-1" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(duplicate.status).toBe(409);
    const duplicatePayload = await duplicate.json() as { artifactId: string };
    expect(duplicatePayload.artifactId).toBe(pinPayload.artifact.id ?? state.artifacts[0]?.id);
  });

  it("pin em projeto de outro usuário retorna 404", async () => {
    state.projects.push({
      createdAt: now(),
      description: null,
      id: "proj-other",
      instructions: null,
      name: "Outro usuário",
      updatedAt: now(),
      userId: "user-2",
    });
    const canvas = seedCanvas();

    const response = await canvasFetch(new Request(`http://localhost/canvas/${canvas.id}/pin`, {
      body: JSON.stringify({ projectId: "proj-other" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(response.status).toBe(404);
  });
});
