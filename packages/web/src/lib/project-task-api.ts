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
export interface CopilotArtifactSummary {
  developmentTaskId: string;
  artifactDigest: string;
  status: string;
  filesCount: number;
  checksCount: number;
  passedChecks: number;
}
export interface LinkedCopilotArtifact extends CopilotArtifactSummary {
  id: string;
  linkedAt: number;
  current: boolean;
  canOpen: boolean;
}
const artifactsPath = (p: string, t: string) =>
  `/api/v1/collaboration/projects/${encodeURIComponent(p)}/tasks/${encodeURIComponent(t)}/copilot-artifacts`;
export const taskArtifactsApi = {
  list: (projectId: string, taskId: string) =>
    fetchJson<{
      artifacts: LinkedCopilotArtifact[];
      candidates: CopilotArtifactSummary[];
    }>(artifactsPath(projectId, taskId)),
  link: (
    projectId: string,
    taskId: string,
    input: {
      developmentTaskId: string;
      artifactDigest: string;
      expectedTaskRevision: number;
      shareSummary: true;
    },
  ) =>
    fetchJson<{ artifact: LinkedCopilotArtifact }>(
      artifactsPath(projectId, taskId),
      { method: "POST", body: JSON.stringify(input) },
    ),
};
