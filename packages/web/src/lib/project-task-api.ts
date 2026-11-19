import { fetchJson } from "./api";
import type { WorkspaceRole } from "./collaboration-api";
export interface ProjectTaskContext {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string | null;
  };
  access: {
    role: WorkspaceRole;
    capabilities: string[];
    teamId: string | null;
    logicalOwnerId: string;
  };
  managedExecution: { supported: boolean; reason: string | null };
  shared: boolean;
  privateDetailAllowed: boolean;
  revisionRequired: boolean;
}
export function getProjectTaskContext(projectId: string) {
  return fetchJson<ProjectTaskContext>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/project-manager/context`,
  );
}
