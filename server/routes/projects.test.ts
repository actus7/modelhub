import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

type ProjectRecord = {
  createdAt: Date;
  description: string | null;
  id: string;
  instructions: string | null;
  name: string;
  updatedAt: Date;
  userId: string;
};

type ProjectFileRecord = {
  byteSize: number;
  createdAt: Date;
  extractedText: string | null;
  fileName: string;
  id: string;
  mimeType: string;
  projectId: string;
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

type CanvasRecord = {
  activeVersion: number;
  content: string;
  conversationId: string;
  id: string;
  kind: string;
  language: string | null;
  title: string;
  userId: string;
};

type ConversationRecord = {
  archived: boolean;
  createdAt: Date;
  id: string;
  projectId: string | null;
  title: string;
  updatedAt: Date;
  userId: string;
};

let projectCounter = 1;
let fileCounter = 1;
let artifactCounter = 1;
let artifactVersionCounter = 1;

const state: {
  artifactVersions: ArtifactVersionRecord[];
  artifacts: ArtifactRecord[];
  canvases: CanvasRecord[];
  conversations: ConversationRecord[];
  files: ProjectFileRecord[];
  projects: ProjectRecord[];
} = {
  artifactVersions: [],
  artifacts: [],
  canvases: [],
  conversations: [],
  files: [],
  projects: [],
};

function now() {
  return new Date("2026-03-28T12:00:00.000Z");
}

function resetState() {
  projectCounter = 1;
  fileCounter = 1;
  artifactCounter = 1;
  artifactVersionCounter = 1;
  state.artifactVersions = [];
  state.artifacts = [];
  state.canvases = [];
  state.conversations = [];
  state.files = [];
  state.projects = [{
    createdAt: now(),
    description: "Projeto de testes",
    id: "proj-1",
    instructions: "Sempre responda em pt-BR",
    name: "Projeto Alpha",
    updatedAt: now(),
    userId: "user-1",
  }];
}

function projectCounts(projectId: string) {
  return {
    artifacts: state.artifacts.filter((artifact) => artifact.projectId === projectId).length,
    conversations: state.conversations.filter((conversation) => conversation.projectId === projectId).length,
    files: state.files.filter((file) => file.projectId === projectId).length,
  };
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
        id: `artifact-version-${artifactVersionCounter += 1}`,
      };
      state.artifactVersions.push(version);
      return version;
    }),
    findUnique: vi.fn(async ({ where }: { where: { artifactId_version: { artifactId: string; version: number } } }) =>
      state.artifactVersions.find(
        (version) =>
          version.artifactId === where.artifactId_version.artifactId &&
          version.version === where.artifactId_version.version,
      ) ?? null),
    findFirst: vi.fn(async ({ where }: { where: { artifactId: string } }) => {
      const versions = state.artifactVersions
        .filter((version) => version.artifactId === where.artifactId)
        .sort((left, right) => right.version - left.version);
      return versions[0] ?? null;
    }),
  },
  canvas: {
    findFirst: vi.fn(async ({ where }: { where: { conversation?: { userId?: string }; id?: string } }) =>
      state.canvases.find((canvas) => {
        if (where.id && canvas.id !== where.id) return false;
        if (where.conversation?.userId && canvas.userId !== where.conversation.userId) return false;
        return true;
      }) ?? null),
  },
  conversation: {
    findMany: vi.fn(async ({ where }: { where: { projectId?: string; userId?: string } }) =>
      state.conversations.filter((conversation) =>
        (!where.projectId || conversation.projectId === where.projectId) &&
        (!where.userId || conversation.userId === where.userId),
      )),
  },
  project: {
    create: vi.fn(async ({ data }: { data: Partial<ProjectRecord> }) => {
      const project: ProjectRecord = {
        createdAt: now(),
        description: data.description ?? null,
        id: `proj-${projectCounter += 1}`,
        instructions: data.instructions ?? null,
        name: data.name ?? "Projeto",
        updatedAt: now(),
        userId: data.userId ?? "user-1",
      };
      state.projects.push(project);
      return project;
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      state.projects = state.projects.filter((project) => project.id !== where.id);
      state.conversations = state.conversations.filter((conversation) => conversation.projectId !== where.id);
      state.files = state.files.filter((file) => file.projectId !== where.id);
      state.artifacts = state.artifacts.filter((artifact) => artifact.projectId !== where.id);
      return { id: where.id };
    }),
    findFirst: vi.fn(async ({ where }: { where: { id?: string; userId?: string } }) =>
      state.projects.find((project) =>
        (!where.id || project.id === where.id) &&
        (!where.userId || project.userId === where.userId),
      ) ?? null),
    findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
      state.projects
        .filter((project) => project.userId === where.userId)
        .map((project) => ({ ...project, _count: projectCounts(project.id) }))),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      state.projects.find((project) => project.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { data: Partial<ProjectRecord>; where: { id: string } }) => {
      const project = state.projects.find((entry) => entry.id === where.id);
      if (!project) throw new Error(`Project ${where.id} not found`);
      Object.assign(project, { ...data, updatedAt: now() });
      return project;
    }),
  },
  projectArtifact: {
    create: vi.fn(async ({ data }: { data: Partial<ArtifactRecord> }) => {
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
      return artifact;
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      state.artifacts = state.artifacts.filter((artifact) => artifact.id !== where.id);
      state.artifactVersions = state.artifactVersions.filter((version) => version.artifactId !== where.id);
      return { id: where.id };
    }),
    findFirst: vi.fn(async ({ where, include }: {
      include?: { versions?: unknown };
      where: { id?: string; projectId?: string };
    }) => {
      const artifact = state.artifacts.find((entry) =>
        (!where.id || entry.id === where.id) &&
        (!where.projectId || entry.projectId === where.projectId),
      ) ?? null;
      if (!artifact) return null;
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
    findMany: vi.fn(async ({ where }: { where: { projectId: string } }) =>
      state.artifacts.filter((artifact) => artifact.projectId === where.projectId)),
    update: vi.fn(async ({ where, data }: { data: Partial<ArtifactRecord>; where: { id: string } }) => {
      const artifact = state.artifacts.find((entry) => entry.id === where.id);
      if (!artifact) throw new Error(`Artifact ${where.id} not found`);
      Object.assign(artifact, { ...data, updatedAt: now() });
      return artifact;
    }),
  },
  projectFile: {
    create: vi.fn(async ({ data }: { data: Omit<ProjectFileRecord, "createdAt" | "id"> }) => {
      const file: ProjectFileRecord = {
        ...data,
        createdAt: now(),
        id: `pfile-${fileCounter += 1}`,
      };
      state.files.push(file);
      return file;
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      state.files = state.files.filter((file) => file.id !== where.id);
      return { id: where.id };
    }),
    findFirst: vi.fn(async ({ where }: { where: { id?: string; projectId?: string } }) =>
      state.files.find((file) =>
        (!where.id || file.id === where.id) &&
        (!where.projectId || file.projectId === where.projectId),
      ) ?? null),
    findMany: vi.fn(async ({ where }: { where: { extractedText?: { not: null }; projectId?: string } }) =>
      state.files.filter((file) => {
        if (where.projectId && file.projectId !== where.projectId) return false;
        if (where.extractedText && file.extractedText === null) return false;
        return true;
      })),
  },
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession } }));

const projectsFetch = (await import("../routes/projects")).default;

function seedFile(projectId: string, fileName: string, extractedText: string | null): ProjectFileRecord {
  const file: ProjectFileRecord = {
    byteSize: 100,
    createdAt: now(),
    extractedText,
    fileName,
    id: `pfile-${fileCounter += 1}`,
    mimeType: "application/pdf",
    projectId,
  };
  state.files.push(file);
  return file;
}

function seedArtifact(projectId: string, sourceCanvasId: string, content: string): ArtifactRecord {
  const artifact: ArtifactRecord = {
    createdAt: now(),
    currentVersion: 1,
    id: `artifact-${artifactCounter += 1}`,
    kind: "markdown",
    language: null,
    projectId,
    shareToken: null,
    sourceCanvasId,
    sourceConversationId: null,
    title: "Artefato",
    updatedAt: now(),
  };
  state.artifacts.push(artifact);
  state.artifactVersions.push({
    artifactId: artifact.id,
    content,
    createdAt: now(),
    id: `artifact-version-${artifactVersionCounter += 1}`,
    version: 1,
  });
  return artifact;
}

describe("projects routes", () => {
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

  it("lista projetos com contadores", async () => {
    state.conversations.push({ archived: false, createdAt: now(), id: "conv-1", projectId: "proj-1", title: "Chat", updatedAt: now(), userId: "user-1" });
    seedFile("proj-1", "doc.pdf", "texto extraído");
    seedArtifact("proj-1", "canvas-1", "conteúdo");

    const response = await projectsFetch(new Request("http://localhost/projects"));
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      projects: Array<{ counts: { artifacts: number; conversations: number; files: number }; id: string }>;
    };

    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0]?.counts).toEqual({ artifacts: 1, conversations: 1, files: 1 });
  });

  it("cria e atualiza projeto", async () => {
    const created = await projectsFetch(new Request("http://localhost/projects", {
      body: JSON.stringify({ description: "d", instructions: "i", name: "Novo" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(created.status).toBe(201);
    const createdPayload = await created.json() as { project: { id: string; instructions: string | null; name: string } };
    expect(createdPayload.project.name).toBe("Novo");
    expect(createdPayload.project.instructions).toBe("i");

    const patched = await projectsFetch(new Request(`http://localhost/projects/${createdPayload.project.id}`, {
      body: JSON.stringify({ name: "Renomeado" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }));
    expect(patched.status).toBe(200);
    const patchedPayload = await patched.json() as { project: { name: string } };
    expect(patchedPayload.project.name).toBe("Renomeado");
  });

  it("rejeita payload inválido e projeto de outro usuário", async () => {
    const invalid = await projectsFetch(new Request("http://localhost/projects", {
      body: JSON.stringify({ name: "" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(invalid.status).toBe(400);

    state.projects.push({ createdAt: now(), description: null, id: "proj-other", instructions: null, name: "Outro", updatedAt: now(), userId: "user-2" });
    const forbidden = await projectsFetch(new Request("http://localhost/projects/proj-other"));
    expect(forbidden.status).toBe(404);
  });

  it("context aplica cap por arquivo (20k) e total (60k)", async () => {
    seedFile("proj-1", "a.pdf", "x".repeat(25_000));
    seedFile("proj-1", "b.pdf", "y".repeat(25_000));
    seedFile("proj-1", "c.pdf", "z".repeat(25_000));
    seedFile("proj-1", "sem-texto.pdf", null);

    const response = await projectsFetch(new Request("http://localhost/projects/proj-1/context"));
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      instructions: string | null;
      knowledge: Array<{ fileName: string; text: string }>;
    };

    expect(payload.instructions).toBe("Sempre responda em pt-BR");
    expect(payload.knowledge.map((entry) => entry.fileName)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(payload.knowledge[0]?.text.length).toBe(20_000);
    expect(payload.knowledge[1]?.text.length).toBe(20_000);
    expect(payload.knowledge[2]?.text.length).toBe(20_000);
    const total = payload.knowledge.reduce((sum, entry) => sum + entry.text.length, 0);
    expect(total).toBe(60_000);
  });

  it("refresh snapshota o canvas como nova versão; mismatch devolve 409", async () => {
    state.canvases.push({
      activeVersion: 2,
      content: "conteúdo atualizado",
      conversationId: "conv-1",
      id: "canvas-9",
      kind: "markdown",
      language: null,
      title: "Documento",
      userId: "user-1",
    });
    const artifact = seedArtifact("proj-1", "canvas-9", "conteúdo original");

    const mismatch = await projectsFetch(new Request(`http://localhost/projects/proj-1/artifacts/${artifact.id}/refresh`, {
      body: JSON.stringify({ canvasId: "canvas-outro" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(mismatch.status).toBe(409);

    const refresh = await projectsFetch(new Request(`http://localhost/projects/proj-1/artifacts/${artifact.id}/refresh`, {
      body: JSON.stringify({ canvasId: "canvas-9" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(refresh.status).toBe(200);
    const payload = await refresh.json() as { artifact: { content: string; currentVersion: number; versions: Array<{ version: number }> } };
    expect(payload.artifact.currentVersion).toBe(2);
    expect(payload.artifact.content).toBe("conteúdo atualizado");
    expect(payload.artifact.versions[0]?.version).toBe(2);
  });

  it("deleta projeto em cascata (conversas, arquivos, artefatos)", async () => {
    state.conversations.push({ archived: false, createdAt: now(), id: "conv-1", projectId: "proj-1", title: "Chat", updatedAt: now(), userId: "user-1" });
    seedFile("proj-1", "doc.pdf", "texto");
    seedArtifact("proj-1", "canvas-1", "conteúdo");

    const response = await projectsFetch(new Request("http://localhost/projects/proj-1", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(state.projects).toHaveLength(0);
    expect(state.conversations).toHaveLength(0);
    expect(state.files).toHaveLength(0);
    expect(state.artifacts).toHaveLength(0);
  });
});
