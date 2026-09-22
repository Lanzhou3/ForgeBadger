import { redirect } from "next/navigation";
import { developmentTaskHref } from "@/lib/project-navigation";
export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const task = query.task ?? query.taskId ?? query.workItemId ?? query.workItem;
  redirect(
    developmentTaskHref(projectId, typeof task === "string" ? task : undefined),
  );
}
