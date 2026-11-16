import type { CopilotGoalTask, CopilotGoalTaskTeam } from "@/lib/copilot-api";

/**
 * Where a goal task stands, as a fixed left-to-right track, and who has to
 * act next. Pure derivation from the task row and its team view so the page,
 * the summary bar and the tests agree on one reading.
 */

export type FlowStageId = "write" | "verify" | "review" | "integrate" | "pass";
/** `attention` = finished, but its result asks for a follow-up (review wants changes). */
export type FlowStageState = "todo" | "active" | "done" | "failed" | "attention";
export interface FlowStage { id: FlowStageId; state: FlowStageState }

export type FlowHolderKind = "member" | "reviewer" | "lead" | "owner" | "queued" | "done" | "stopped";
export type FlowHeadline =
  | "writing" | "reviewing" | "leadWorking" | "cliFailed" | "reviewWantsChanges" | "verifyFailed" | "awaitVerify"
  | "awaitIntegrate" | "awaitLead" | "taskFailed" | "awaitAcceptance" | "passed" | "queued" | "cancelled";

export interface TaskFlow {
  stages: FlowStage[];
  holder: FlowHolderKind;
  headline: FlowHeadline;
  /** Display name for member/reviewer holders. */
  actor: string | null;
  /** Review round in progress or last finished, when there is one. */
  reviewRound: number | null;
}

function writeState(task: CopilotGoalTask): FlowStageState {
  if (task.dispatchedSessionId) {
    if (task.dispatchStatus === "running") return "active";
    if (task.dispatchStatus === "failed") return "failed";
    return "done";
  }
  if (task.status === "in_progress") return "active";
  if (task.status === "passes") return "done";
  return task.status === "failed" ? "failed" : "todo";
}

function reviewState(task: CopilotGoalTask, team: CopilotGoalTaskTeam | undefined): FlowStageState | null {
  const attempts = team?.review?.attempts ?? [];
  if (!attempts.length) return null;
  const last = attempts.at(-1)!;
  if (last.status === "running") return "active";
  const reported = [...attempts].reverse().find((attempt) => attempt.status === "reported");
  if (!reported) return "todo";
  if (reported.verdict === "approve" || reported.findings.length === 0) return "done";
  // Findings count as handed back once the writer was dispatched again after the review settled.
  const handedBack = (task.dispatchUpdatedAt ?? 0) > (reported.settledAt ?? Number.MAX_SAFE_INTEGER);
  return handedBack || task.status === "passes" ? "done" : "attention";
}

export function deriveTaskFlow(task: CopilotGoalTask, team?: CopilotGoalTaskTeam): TaskFlow {
  const write = writeState(task);
  const verified = task.verifiedAt != null && task.verifyExitCode === 0;
  const verifyFailed = task.verifiedAt != null && task.verifyExitCode !== 0 && task.verifyExitCode != null;
  const review = reviewState(task, team);
  const ownTree = team?.workspace === "own";
  // A freshly forked worktree has nothing to integrate yet and reads as "contained in the goal branch";
  // integration only means something once the writing is finished.
  const integrated = team?.integrated === true && write === "done";
  const stages: FlowStage[] = [{ id: "write", state: write }];
  if (task.verifyCommand) stages.push({ id: "verify", state: verified ? "done" : verifyFailed ? "failed" : "todo" });
  if (review) stages.push({ id: "review", state: review });
  if (ownTree) stages.push({ id: "integrate", state: integrated ? "done" : "todo" });
  stages.push({ id: "pass", state: task.status === "passes" ? "done" : task.status === "failed" ? "failed" : "todo" });

  const attempts = team?.review?.attempts ?? [];
  const reviewRound = attempts.length ? (team?.review?.rounds ?? 0) + (attempts.at(-1)!.status === "running" ? 1 : 0) || null : null;
  const worker = team?.worker ? (team.worker.memberName ?? team.worker.adapter) : null;
  const base = { stages, reviewRound };
  if (task.status === "cancelled") return { ...base, holder: "stopped", headline: "cancelled", actor: null };
  if (task.status === "passes") {
    return task.boardStatus === "ready_for_review"
      ? { ...base, holder: "owner", headline: "awaitAcceptance", actor: null }
      : { ...base, holder: "done", headline: "passed", actor: null };
  }
  if (write === "active") {
    return task.dispatchedSessionId
      ? { ...base, holder: "member", headline: "writing", actor: worker }
      : { ...base, holder: "lead", headline: "leadWorking", actor: null };
  }
  if (review === "active") return { ...base, holder: "reviewer", headline: "reviewing", actor: attempts.at(-1)!.reviewer.name };
  if (write === "failed" && task.dispatchedSessionId) return { ...base, holder: "lead", headline: "cliFailed", actor: null };
  if (review === "attention") return { ...base, holder: "lead", headline: "reviewWantsChanges", actor: null };
  if (verifyFailed) return { ...base, holder: "lead", headline: "verifyFailed", actor: null };
  if (task.status === "failed") return { ...base, holder: "lead", headline: "taskFailed", actor: null };
  if (write === "done" && task.verifyCommand && !verified) return { ...base, holder: "lead", headline: "awaitVerify", actor: null };
  if (write === "done" && ownTree && !integrated) return { ...base, holder: "lead", headline: "awaitIntegrate", actor: null };
  if (write === "done") return { ...base, holder: "lead", headline: "awaitLead", actor: null };
  return { ...base, holder: "queued", headline: "queued", actor: null };
}

/** Index of the stage the track is "at": the active one, else the first that is not done. -1 when everything is done. */
export function currentStageIndex(stages: FlowStage[]): number {
  const active = stages.findIndex((stage) => stage.state === "active");
  return active >= 0 ? active : stages.findIndex((stage) => stage.state !== "done");
}

export type FlowBucket = "done" | "team" | "lead" | "owner" | "queued" | "stopped";

export function bucketOf(flow: TaskFlow): FlowBucket {
  if (flow.holder === "member" || flow.holder === "reviewer") return "team";
  return flow.holder;
}

/** Own-worktree tasks whose work is not in the goal branch: the owner's merge is refused while any exist. */
export function unintegratedTasks(tasks: CopilotGoalTask[], team: CopilotGoalTaskTeam[] | undefined): CopilotGoalTask[] {
  const byId = new Map((team ?? []).map((entry) => [entry.taskId, entry]));
  return tasks.filter((task) => task.status !== "cancelled" && byId.get(task.id)?.workspace === "own" && byId.get(task.id)?.integrated === false);
}

export interface MemberActivity { kind: "writing" | "reviewing"; taskSeq: number }

/** What each roster member is doing right now, keyed by member id. */
export function memberActivity(tasks: CopilotGoalTask[], team: CopilotGoalTaskTeam[] | undefined): Map<string, MemberActivity> {
  const result = new Map<string, MemberActivity>();
  const byId = new Map((team ?? []).map((entry) => [entry.taskId, entry]));
  for (const task of tasks) {
    const entry = byId.get(task.id);
    if (!entry) continue;
    if (task.dispatchStatus === "running" && entry.worker?.memberId) result.set(entry.worker.memberId, { kind: "writing", taskSeq: task.seq });
    const running = entry.review?.attempts.find((attempt) => attempt.status === "running");
    if (running) result.set(running.reviewer.id, { kind: "reviewing", taskSeq: task.seq });
  }
  return result;
}
