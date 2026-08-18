import { prisma } from "@/server/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { shareToken: token },
    select: {
      id: true,
      title: true,
      createdAt: true,
      messages: {
        select: { id: true, role: true, content: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 200,
      },
    },
  });

  if (conversation) {
    return Response.json({ type: "conversation", conversation });
  }

  const canvas = await prisma.canvas.findFirst({
    where: { shareToken: token },
    select: {
      activeVersion: true,
      createdAt: true,
      id: true,
      kind: true,
      language: true,
      title: true,
    },
  });

  if (canvas) {
    const activeVersion = await prisma.canvasVersion.findUnique({
      where: { canvasId_version: { canvasId: canvas.id, version: canvas.activeVersion } },
      select: { content: true },
    });

    return Response.json({
      type: "canvas",
      canvas: {
        content: activeVersion?.content ?? "",
        createdAt: canvas.createdAt,
        kind: canvas.kind,
        language: canvas.language,
        title: canvas.title,
      },
    });
  }

  const artifact = await prisma.projectArtifact.findFirst({
    where: { shareToken: token },
    select: {
      currentVersion: true,
      id: true,
      kind: true,
      language: true,
      title: true,
      updatedAt: true,
    },
  });

  if (artifact) {
    const activeVersion = await prisma.artifactVersion.findUnique({
      where: { artifactId_version: { artifactId: artifact.id, version: artifact.currentVersion } },
      select: { content: true },
    });

    return Response.json({
      type: "artifact",
      artifact: {
        content: activeVersion?.content ?? "",
        kind: artifact.kind,
        language: artifact.language,
        title: artifact.title,
        updatedAt: artifact.updatedAt,
      },
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
