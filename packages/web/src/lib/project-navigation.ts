export function developmentTaskHref(projectId: string, taskId?: string | null) {
  const query = new URLSearchParams({ tab: "project-manager" });
  if (taskId) query.set("workItemId", taskId);
  return `/projects/${encodeURIComponent(projectId)}?${query}`;
}
