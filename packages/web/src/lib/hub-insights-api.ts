import { fetchJson } from "@/lib/api";

/** Browser client for team hub insights (`/api/v1/hub-console/projects/:id/insights` and friends). */

export type HubCheckKind = "base_conflict" | "peer_conflict" | "scope" | "pull_request" | "ci";
export type HubCheckStatus = "ok" | "attention" | "unknown";

export interface HubModule {
  pattern: string;
  owners: string[];
}

export interface HubInsightCheck {
  submissionId: string;
  taskId: string;
  kind: HubCheckKind;
  status: HubCheckStatus;
  /** Untrusted: narrow before use. */
  details: Record<string, unknown>;
  checkedAt: number;
}

export interface HubInsightsSync {
  mirrorFetchedAt: number | null;
  mirrorError: string | null;
  remotePolledAt: number | null;
  remoteError: string | null;
}

export interface HubInsights {
  modules: HubModule[];
  taskModules: Record<string, string>;
  checks: HubInsightCheck[];
  sync: HubInsightsSync;
  remote: { tokenConfigured: boolean };
}

const projectPath = (projectId: string) => `/api/v1/hub-console/projects/${encodeURIComponent(projectId)}`;
const send = (method: string, payload?: unknown) => ({ method, body: JSON.stringify(payload ?? {}) });

export const hubInsightsApi = {
  insights: (projectId: string) => fetchJson<HubInsights>(`${projectPath(projectId)}/insights`),
  setTaskModule: (projectId: string, taskId: string, pattern: string | null) =>
    fetchJson<{ taskModules: Record<string, string> }>(`${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}/module`, send("PUT", { pattern })),
  refreshMirror: (projectId: string) => fetchJson<HubInsights>(`${projectPath(projectId)}/mirror/refresh`, send("POST")),
  putCredential: (projectId: string, token: string) =>
    fetchJson<{ tokenConfigured: true }>(`${projectPath(projectId)}/remote-credential`, send("PUT", { token })),
  deleteCredential: (projectId: string) =>
    fetchJson<{ tokenConfigured: false }>(`${projectPath(projectId)}/remote-credential`, { method: "DELETE" }),
  refreshRemote: (projectId: string) =>
    fetchJson<{ checks: HubInsightCheck[] }>(`${projectPath(projectId)}/remote/refresh`, send("POST")),
};
