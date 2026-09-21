import { fetchJson } from "@/lib/api";
import type { PlatformIntent, PlatformReceipt } from "@/lib/platform-actions-api";

export type DevelopmentStatus = "queued" | "running" | "checks_passed" | "checks_failed" | "failed" | "cancelled" | "indeterminate" | "accepted";
export interface DevelopmentTask {
  id: string;
  projectId: string;
  goal: string;
  status: DevelopmentStatus;
  revision: number;
  recipeDigest: string;
  sourceDigest: string;
  outputDigest: string | null;
  artifactDigest: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface DevelopmentEvidence {
  sourceDigest: string;
  outputDigest: string;
  recipeDigest: string;
  files: { path: string; beforeSha256: string | null; afterSha256: string | null }[];
  diff: string;
  checks: { path: string; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; cancelled: boolean; durationMs: number }[];
  startedAt: number;
  finishedAt: number;
}
export const isDevelopmentActive = (status: DevelopmentStatus) => status === "queued" || status === "running";
const base = "/api/v1/copilot/development";
export function getDevelopmentCapability() {
  return fetchJson<{ available: boolean; reason: string | null }>(`${base}/capability`);
}
export function listDevelopmentTasks(projectId: string) {
  return fetchJson<{ tasks: DevelopmentTask[] }>(`${base}/tasks?projectId=${encodeURIComponent(projectId)}`);
}
export function getDevelopmentTask(projectId: string, taskId: string) {
  return fetchJson<{ task: DevelopmentTask; evidence: DevelopmentEvidence | null }>(`${base}/tasks/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`);
}
export function previewDevelopmentAction(task: DevelopmentTask, action: "cancel" | "accept", idempotencyKey: string) {
  return fetchJson<{ intent: PlatformIntent }>("/api/v1/platform-actions/preview", {
    method: "POST",
    body: JSON.stringify({ commandId: `development.task.${action}`, input: { projectId: task.projectId, taskId: task.id, ...(action === "accept" ? { artifactDigest: task.artifactDigest } : {}) }, idempotencyKey }),
  });
}
export function approveDevelopmentAction(intent: PlatformIntent) {
  return fetchJson<{ intent: PlatformIntent }>(`/api/v1/platform-actions/${encodeURIComponent(intent.id)}/decide`, {
    method: "POST", body: JSON.stringify({ digest: intent.digest, approved: true }),
  });
}
export function executeDevelopmentAction(intentId: string) {
  return fetchJson<{ receipt: PlatformReceipt }>(`/api/v1/platform-actions/${encodeURIComponent(intentId)}/execute`, { method: "POST", body: "{}" });
}
