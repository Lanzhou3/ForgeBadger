import { fetchJson } from "@/lib/api";

/** Browser client for the team hub console API (`/api/v1/hub-console`). */

export type HubChecksStatus = "passed" | "failed" | "not_run";
export type HubDecision = "accepted" | "changes_requested";
export type HubProvider = "github" | "gitee";

export interface HubConfirmation {
  id: string;
  submissionId: string;
  actorId: string;
  actorKind: "human" | "copilot" | "system";
  effect: "binding" | "advisory";
  decision: HubDecision;
  note: string;
  commitSha: string;
  createdAt: number;
}

export interface HubSubmission {
  id: string;
  taskId: string;
  actorId: string;
  branch: string;
  commitSha: string;
  prUrl: string | null;
  checksStatus: HubChecksStatus;
  checksSummary: string;
  taskSemanticRevision: number;
  createdAt: number;
}

export interface HubTask {
  id: string;
  title: string;
  status: string;
  revision: number;
  semanticRevision: number;
  assigneeId: string | null;
  reviewerId: string | null;
  latestSubmission: (HubSubmission & { current: boolean; confirmation: HubConfirmation | null }) | null;
}

export interface HubTaskDetail {
  task: HubTask;
  submissions: Array<HubSubmission & { confirmations: HubConfirmation[] }>;
}

export interface HubSettings {
  provider: HubProvider | null;
  remoteUrl: string | null;
  defaultBranch: string | null;
  confirmationPolicy: string;
  revision: number;
}

export interface HubProjectInfo {
  project: { id: string; name: string; role: string; capabilities: string[] };
  actorId: string;
  settings: HubSettings;
}

export interface HubNodeToken {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface HubSubmissionInput {
  expectedRevision: number;
  branch: string;
  commitSha: string;
  prUrl: string | null;
  checksStatus: HubChecksStatus;
  checksSummary: string;
}

const root = "/api/v1/hub-console";
const projectPath = (projectId: string) => `${root}/projects/${encodeURIComponent(projectId)}`;
const taskPath = (projectId: string, taskId: string) => `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}`;
const send = (method: string, payload: unknown) => ({ method, body: JSON.stringify(payload) });

export const hubApi = {
  project: (projectId: string) => fetchJson<HubProjectInfo>(projectPath(projectId)),
  putSettings: (projectId: string, input: { expectedRevision: number; provider: HubProvider; remoteUrl: string; defaultBranch: string }) =>
    fetchJson<{ settings: HubSettings }>(`${projectPath(projectId)}/settings`, send("PUT", input)),
  task: (projectId: string, taskId: string) => fetchJson<HubTaskDetail>(taskPath(projectId, taskId)),
  claim: (projectId: string, taskId: string, expectedRevision: number) =>
    fetchJson<{ task: HubTask }>(`${taskPath(projectId, taskId)}/claim`, send("POST", { expectedRevision })),
  submit: (projectId: string, taskId: string, input: HubSubmissionInput) =>
    fetchJson<{ task: HubTask; submission: HubSubmission }>(`${taskPath(projectId, taskId)}/submissions`, send("POST", input)),
  confirm: (projectId: string, taskId: string, input: { expectedRevision: number; submissionId: string; decision: HubDecision; note: string }) =>
    fetchJson<{ task: HubTask; confirmation: HubConfirmation }>(`${taskPath(projectId, taskId)}/confirmations`, send("POST", input)),
  tokens: () => fetchJson<{ tokens: HubNodeToken[] }>(`${root}/tokens`),
  createToken: (input: { projectId: string; name: string; expiresInDays: number }) =>
    fetchJson<{ token: string; record: HubNodeToken }>(`${root}/tokens`, send("POST", input)),
  revokeToken: (tokenId: string) =>
    fetchJson<{ revoked: boolean }>(`${root}/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" })
};
