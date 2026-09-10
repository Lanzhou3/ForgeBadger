import { fetchJson } from "@/lib/api";

export interface CopilotGrant {
  id: string;
  name: string;
  status: string;
  revision: number;
  scope: {
    projectIds: string[];
    capabilities: string[];
    allowedRoots: string[];
  };
  expiresAt: number;
  maxActions: number;
  maxConcurrency: number;
  usedActions: number;
}
export interface PlatformIntent {
  id: string;
  command_id: string;
  input_json: string;
  resources_json: string;
  digest: string;
  authority: "owner_action" | "delegated_grant";
  grant_id: string | null;
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
  autonomy: "manual_only";
  evidenceFreshness: {
    status: "unknown" | "stale" | "fresh";
    fresh: number;
    stale: number;
    unknown: number;
    lastObservedAt: number | null;
  };
}
export function listGrants() {
  return fetchJson<{
    grants: CopilotGrant[];
    capabilities: { id: string; capability: string; effect: string }[];
  }>("/api/v1/copilot/grants");
}
export function createGrant(input: {
  name: string;
  projectIds: string[];
  capabilities: string[];
  allowedRoots: string[];
  expiresAt: number;
  maxActions: number;
  maxConcurrency: number;
}) {
  return fetchJson<{ grant: CopilotGrant }>("/api/v1/copilot/grants", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function revokeGrant(id: string) {
  return fetchJson<{ grant: CopilotGrant }>(
    `/api/v1/copilot/grants/${encodeURIComponent(id)}/revoke`,
    { method: "POST" },
  );
}
export function getPlatformAction(id: string) {
  return fetchJson<{ intent: PlatformIntent; receipt: PlatformReceipt | null }>(
    `/api/v1/platform-actions/${encodeURIComponent(id)}`,
  );
}
export function getProjectOverview(grantId?: string) {
  return fetchJson<{ projects: ManagedProject[]; observedAt: number }>(
    `/api/v1/project-manager/overview${grantId ? `?grantId=${encodeURIComponent(grantId)}` : ""}`,
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
    autonomy: "manual_only";
  }>(`/api/v1/sessions/${encodeURIComponent(id)}/writer`);
}
export function takeoverSession(id: string) {
  return fetchJson<{ sessionId: string; takenOver: true }>(
    `/api/v1/sessions/${encodeURIComponent(id)}/takeover`,
    { method: "POST", body: "{}" },
  );
}
