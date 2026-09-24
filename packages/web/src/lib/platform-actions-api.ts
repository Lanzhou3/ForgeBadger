import { fetchJson } from "@/lib/api";

export interface PlatformIntent {
  id: string;
  command_id: string;
  input_json: string;
  resources_json: string;
  digest: string;
  authority: "owner_action";
  expires_at: number;
  status: string;
}
export interface PlatformReceipt {
  intentId: string;
  outcome: "confirmed" | "no_effect" | "unknown";
  result: unknown;
  createdAt: number;
}
export interface ProjectManagement {
  projectId: string;
  mode: "manual" | "cli";
  ownerLabel: string;
  nextAction: string;
  freshnessHours: number;
  revision: number;
  updatedAt: number | null;
}
export interface ManagedProject {
  id: string;
  name: string;
  copilotAutonomy: boolean;
  management: ProjectManagement;
  counts: {
    total: number;
    todo: number;
    in_progress: number;
    blocked: number;
    ready_for_review: number;
    done: number;
    cancelled: number;
  };
  goal: { summary: string; status: string } | null;
  autonomy: "manual_only" | "supervised";
  evidenceFreshness: {
    status: "unknown" | "stale" | "fresh";
    fresh: number;
    stale: number;
    unknown: number;
    lastObservedAt: number | null;
  };
}
export function getPlatformAction(id: string) {
  return fetchJson<{ intent: PlatformIntent; receipt: PlatformReceipt | null }>(
    `/api/v1/platform-actions/${encodeURIComponent(id)}`,
  );
}
export function getProjectOverview() {
  return fetchJson<{ projects: ManagedProject[]; observedAt: number }>("/api/v1/project-manager/overview");
}
export function setCopilotAutonomy(projectId: string, enabled: boolean) {
  return fetchJson<{ projectId: string; copilotAutonomy: boolean }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/copilot-autonomy`,
    { method: "PATCH", body: JSON.stringify({ enabled }) },
  );
}
export function updateProjectManagement(
  id: string,
  input: Omit<ProjectManagement, "projectId" | "revision" | "updatedAt"> & {
    expectedRevision: number;
  },
) {
  return fetchJson<{ management: ProjectManagement }>(
    `/api/v1/projects/${encodeURIComponent(id)}/project-manager/management`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function getSessionWriter(id: string) {
  return fetchJson<{
    sessionId: string;
    mode: "manual" | "automated";
    autonomy: "manual_only" | "supervised";
  }>(`/api/v1/sessions/${encodeURIComponent(id)}/writer`);
}
export function takeoverSession(id: string) {
  return fetchJson<{ sessionId: string; takenOver: true }>(
    `/api/v1/sessions/${encodeURIComponent(id)}/takeover`,
    { method: "POST", body: "{}" },
  );
}
