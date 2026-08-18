import type {
  CanvasDetail,
  CanvasKind,
  CanvasSummary,
  ProjectArtifactDetail,
  ProjectSummary,
} from "@/lib/contracts";
import { apiJson, apiJsonRequest } from "@/lib/api";

export type CanvasVersionContent = {
  content: string;
  createdAt: string;
  kind: CanvasKind;
  language: string | null;
  version: number;
};

export async function listCanvases(conversationId: string): Promise<CanvasSummary[]> {
  const data = await apiJson<{ canvases: CanvasSummary[] }>(`/conversations/${conversationId}/canvases`);
  return data.canvases;
}

export async function createCanvas(
  conversationId: string,
  payload: { content: string; kind: CanvasKind; language?: string | null; title?: string },
): Promise<CanvasDetail> {
  const data = await apiJsonRequest<{ canvas: CanvasDetail }>(
    `/conversations/${conversationId}/canvases`,
    "POST",
    payload,
  );
  return data.canvas;
}

export async function getCanvas(canvasId: string): Promise<CanvasDetail> {
  const data = await apiJson<{ canvas: CanvasDetail }>(`/canvas/${canvasId}`);
  return data.canvas;
}

export async function updateCanvas(
  canvasId: string,
  payload: Partial<Pick<CanvasDetail, "content" | "kind" | "language" | "title">>,
): Promise<CanvasDetail> {
  const data = await apiJsonRequest<{ canvas: CanvasDetail }>(`/canvas/${canvasId}`, "PATCH", payload);
  return data.canvas;
}

export async function deleteCanvas(canvasId: string): Promise<void> {
  await apiJsonRequest(`/canvas/${canvasId}`, "DELETE");
}

export async function getCanvasVersion(canvasId: string, version: number): Promise<CanvasVersionContent> {
  const data = await apiJson<{ version: CanvasVersionContent }>(`/canvas/${canvasId}/versions/${version}`);
  return data.version;
}

export async function restoreCanvasVersion(canvasId: string, version: number): Promise<CanvasDetail> {
  const data = await apiJsonRequest<{ canvas: CanvasDetail }>(
    `/canvas/${canvasId}/versions/${version}/restore`,
    "POST",
  );
  return data.canvas;
}

export async function shareCanvas(canvasId: string): Promise<string> {
  const data = await apiJsonRequest<{ shareToken: string }>(`/canvas/${canvasId}/share`, "POST");
  return data.shareToken;
}

export async function revokeCanvasShare(canvasId: string): Promise<void> {
  await apiJsonRequest(`/canvas/${canvasId}/share`, "DELETE");
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const data = await apiJson<{ projects: ProjectSummary[] }>("/projects");
  return data.projects;
}

export async function pinCanvas(canvasId: string, projectId: string): Promise<ProjectArtifactDetail> {
  const data = await apiJsonRequest<{ artifact: ProjectArtifactDetail }>(`/canvas/${canvasId}/pin`, "POST", {
    projectId,
  });
  return data.artifact;
}
