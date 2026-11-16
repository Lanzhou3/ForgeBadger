import { fetchJson } from "@/lib/api";
import type { HubChecksStatus, HubSettings, HubTask } from "@/lib/hub-api";

/** Browser client for the node side of the team hub (`/api/v1/hub-links`). */

export interface HubLink {
  id: string;
  hubUrl: string;
  hubProjectId: string;
  hubProjectName: string;
  hubActorId: string;
  localProjectId: string;
  lastSyncedAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface HubLinkTask extends HubTask {
  description: string | null;
  acceptanceCriteria: string[];
  mine: boolean;
  localWorkItemId: string | null;
  suggestedBranch: string;
}

export interface LocalGitState {
  branch: string | null;
  commit: string;
  dirty: boolean;
  pushed: boolean;
}

const root = "/api/v1/hub-links";
const linkPath = (linkId: string) => `${root}/${encodeURIComponent(linkId)}`;
const taskPath = (linkId: string, taskId: string) => `${linkPath(linkId)}/tasks/${encodeURIComponent(taskId)}`;
const send = (method: string, payload: unknown) => ({ method, body: JSON.stringify(payload) });

export const hubLinkApi = {
  list: () => fetchJson<{ links: HubLink[] }>(root),
  connect: (input: { hubUrl: string; token: string; localProjectId: string }) => fetchJson<{ link: HubLink }>(root, send("POST", input)),
  remove: (linkId: string) => fetchJson<{ removed: boolean }>(linkPath(linkId), { method: "DELETE" }),
  sync: (linkId: string) => fetchJson<{ link: HubLink; settings: HubSettings; tasks: HubLinkTask[] }>(`${linkPath(linkId)}/sync`, send("POST", {})),
  git: (linkId: string) => fetchJson<{ git: LocalGitState }>(`${linkPath(linkId)}/git`),
  claim: (linkId: string, taskId: string) => fetchJson<{ task: HubLinkTask }>(`${taskPath(linkId, taskId)}/claim`, send("POST", {})),
  submit: (linkId: string, taskId: string, input: { prUrl: string | null; checksStatus: HubChecksStatus; checksSummary: string }) =>
    fetchJson<{ task: HubLinkTask }>(`${taskPath(linkId, taskId)}/submit`, send("POST", input)),
  createLocalTask: (linkId: string, taskId: string) =>
    fetchJson<{ workItemId: string; suggestedBranch: string }>(`${taskPath(linkId, taskId)}/local-task`, send("POST", {}))
};
