import { DevelopmentTasks } from "@/components/copilot/DevelopmentTasks";
export default async function DevelopmentTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return (
    <DevelopmentTasks
      initialProjectId={
        typeof query.projectId === "string" ? query.projectId : ""
      }
      initialTaskId={typeof query.taskId === "string" ? query.taskId : ""}
    />
  );
}
