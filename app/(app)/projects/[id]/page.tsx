import { ProjectDetailPage } from "@/components/projects/project-detail-page";

export default function ProjectRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ProjectDetailPage projectIdPromise={params} />;
}
