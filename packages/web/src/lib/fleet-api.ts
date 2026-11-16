import { fetchJson } from "@/lib/api";
import type {
  CopilotGoalDiffFile,
  CopilotGoalGrant,
  CopilotGoalTask,
  CopilotGoalTeam,
} from "@/lib/copilot-api";

/** Fleet REST client: one resident agent team (the flagship plus roster members) per project. All times are epoch ms. */

export type FleetStatus = "active" | "paused" | (string & {});

export interface FleetTaskHold {
  question: string;
  askedAt: number;
}

/** A Goal task row plus what the fleet adds: who owns it, what it may touch, and whether it waits for the owner. */
export interface FleetTask extends CopilotGoalTask {
  details: string | null;
  memberId: string | null;
  fileScope: string[];
  hold: FleetTaskHold | null;
  note: string | null;
  createdBy: string;
}

export interface FleetWorkspace {
  kind: string;
  branch: string | null;
  baseCommit: string | null;
  targetBranch: string | null;
}

export interface FleetListItem {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: FleetStatus;
  pausedReason: string | null;
  taskTotal: number;
  taskDone: number;
  taskHeld: number;
  taskRunning: number;
  updatedAt: number;
}

export interface Fleet {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  instructions: string;
  status: FleetStatus;
  pausedReason: string | null;
  grants: CopilotGoalGrant[];
  workspace: FleetWorkspace | null;
  createdAt: number;
  updatedAt: number;
}

export interface FleetJournalEntry {
  id: string;
  runId: string | null;
  taskId: string | null;
  note: string;
  createdAt: number;
}

export interface FleetTimer {
  id: string;
  taskId: string | null;
  dueAt: number;
  note: string;
}

export interface FleetDetail {
  fleet: Fleet;
  tasks: FleetTask[];
  journal: FleetJournalEntry[];
  timers: FleetTimer[];
  pendingEvents: number;
  leadActive: boolean;
}

/** Same shape as the Goal team view. */
export type FleetTeam = CopilotGoalTeam;

export interface FleetDiff {
  files: CopilotGoalDiffFile[];
  truncated: boolean;
  /** Tasks whose own-worktree changes are not in the integration branch yet; the contract does not spell out the element shape. */
  unintegratedTasks?: unknown[];
}

export interface FleetMergeResult {
  merged: string[];
  deleted: string[];
  kept: string[];
  commit?: string;
  cleanedTaskWorktrees?: number;
}

export interface CreateFleetInput {
  projectId: string;
  title?: string;
  instructions?: string;
  grants?: CopilotGoalGrant[];
}

export interface AddFleetTaskInput {
  description: string;
  details?: string;
  verifyCommand?: string;
  fileScope?: string[];
  workItemId?: string;
}

const base = "/api/v1/fleets";
const fleetPath = (id: string, suffix = "") => `${base}/${encodeURIComponent(id)}${suffix}`;
const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const fleetKeys = {
  all: ["fleet"] as const,
  list: ["fleet", "list"] as const,
  detail: (id: string) => ["fleet", "detail", id] as const,
  team: (id: string) => ["fleet", "team", id] as const,
  diff: (id: string) => ["fleet", "diff", id] as const,
};

export function listFleets() {
  return fetchJson<{ fleets: FleetListItem[] }>(base);
}

export function createFleet(input: CreateFleetInput) {
  return fetchJson<{ fleet: Fleet }>(base, post(input));
}

export function getFleet(id: string) {
  return fetchJson<FleetDetail>(fleetPath(id));
}

export function getFleetTeam(id: string) {
  return fetchJson<FleetTeam>(fleetPath(id, "/team"));
}

export function updateFleet(id: string, patch: { title?: string; instructions?: string; grants?: CopilotGoalGrant[] }) {
  return fetchJson<{ fleet: Fleet }>(fleetPath(id), { method: "PATCH", body: JSON.stringify(patch) });
}

export function pauseFleet(id: string) {
  return fetchJson<{ fleet: Fleet }>(fleetPath(id, "/pause"), post());
}

export function resumeFleet(id: string) {
  return fetchJson<{ fleet: Fleet }>(fleetPath(id, "/resume"), post());
}

export function addFleetTask(id: string, input: AddFleetTaskInput) {
  return fetchJson<{ task: FleetTask }>(fleetPath(id, "/tasks"), post(input));
}

export function answerFleetTask(id: string, taskId: string, answer: string) {
  return fetchJson<{ task: FleetTask }>(fleetPath(id, `/tasks/${encodeURIComponent(taskId)}/answer`), post({ answer }));
}

export function cancelFleetTask(id: string, taskId: string) {
  return fetchJson<{ task: FleetTask }>(fleetPath(id, `/tasks/${encodeURIComponent(taskId)}/cancel`), post());
}

export function messageFleet(id: string, text: string) {
  return fetchJson<{ accepted: boolean; /** The same text is already waiting for the flagship. */ duplicate?: boolean }>(fleetPath(id, "/messages"), post({ text }));
}

export function getFleetDiff(id: string) {
  return fetchJson<FleetDiff>(fleetPath(id, "/diff"));
}

export function mergeFleet(id: string) {
  return fetchJson<FleetMergeResult>(fleetPath(id, "/merge"), post());
}
