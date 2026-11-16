/**
 * Fleet routes — /api/v1/fleets* (spec §3.9).
 *
 * A fleet is one standing agent team per personal git project. These routes
 * own the owner's side: create/configure, pause/resume, board tasks, hold
 * answers, messages to the flagship, the integration diff and the merge.
 * Every owner action that the flagship must react to lands in the fleet
 * inbox (fleet_events) with a dedupe key; the fleet worker turns it into a
 * lead run. Another user's fleet is always 404. All times are epoch ms.
 */
import { createHash } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";

import { authenticate } from "../auth/middleware.js";
import type { AgentStackDeps } from "../services/agent/agent-stack.js";
import { boardStatusOf } from "../services/agent/goal-board.js";
import { GOAL_GRANTS, parseGoalGrants } from "../services/agent/goal-grants.js";
import { cleanupIntegratedTaskWorkspaces, listUnintegratedTasks } from "../services/agent/goal-task-workspace.js";
import { goalTeamView } from "../services/agent/goal-team-view.js";
import { diffGoalWorkspace, existingGoalWorkspace, mergeGoalWorkspace } from "../services/agent/goal-workspace.js";
import { AgentError } from "../services/agent/types.js";
import { acquireFleetMergeLock, enqueueFleetEvent, FleetInbox, wakeFleet } from "../services/fleet/fleet-inbox.js";
import { liveSessionsInTree } from "../services/fleet/fleet-dispatch.js";
import { FleetNotes } from "../services/fleet/fleet-notes.js";
import { FleetStore, parseFileScope, type FleetJournalRow, type FleetListRow, type FleetRow, type FleetTaskRow } from "../services/fleet/fleet-store.js";
import { FleetTimers, type FleetTimerRow } from "../services/fleet/fleet-timers.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import type { Database } from "../db/types.js";
import { domainError, idSchema, notFound, ok, parseId, userId, withBody } from "./copilot-helpers.js";

const TASK_NOTE_CHARS = 600;
const JOURNAL_LIMIT = 30;
const FLEET_CONFLICT_CODES = new Set(["FLEET_EXISTS", "FLEET_GIT_REQUIRED", "FLEET_TASK_NOT_HELD"]);
/** The lead only needs the gist of its own question next to the owner's full answer. */
const HOLD_QUESTION_IN_EVENT = 1000;

const grantsSchema = z.array(z.enum(GOAL_GRANTS)).max(GOAL_GRANTS.length);
const createSchema = z.object({
  projectId: idSchema,
  title: z.string().trim().min(1).max(200).optional(),
  instructions: z.string().max(8000).optional(),
  grants: grantsSchema.optional()
}).strict();
const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  instructions: z.string().max(8000).optional(),
  grants: grantsSchema.optional()
}).strict();
const taskSchema = z.object({
  description: z.string().trim().min(1).max(500),
  details: z.string().max(8000).optional(),
  verifyCommand: z.string().trim().min(1).max(1024).optional(),
  fileScope: z.array(z.string().min(1).max(200)).max(20).optional(),
  workItemId: z.string().trim().min(1).max(128).optional()
}).strict();
const answerSchema = z.object({ answer: z.string().trim().min(1).max(4000) }).strict();
const messageSchema = z.object({ text: z.string().trim().min(1).max(8000) }).strict();

function fleetDto(row: FleetRow, projectName: string) {
  return {
    id: row.id, projectId: row.project_id, projectName, title: row.title, instructions: row.instructions,
    status: row.status, pausedReason: row.status === "paused" ? row.paused_reason : null,
    grants: parseGoalGrants(row.grants_json),
    // Filesystem paths stay server-side; the branch/base identify the work.
    workspace: row.workspace_kind
      ? { kind: row.workspace_kind, branch: row.workspace_branch, baseCommit: row.workspace_base_commit, targetBranch: row.workspace_target_branch }
      : null,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function fleetListItemDto(row: FleetListRow) {
  return {
    id: row.id, projectId: row.project_id, projectName: row.project_name, title: row.title, status: row.status,
    pausedReason: row.status === "paused" ? row.paused_reason : null,
    taskTotal: row.task_total, taskDone: row.task_done, taskHeld: row.task_held, taskRunning: row.task_running, updatedAt: row.updated_at
  };
}

function taskDto(row: FleetTaskRow, boardStatus: string | null, note: string | null) {
  return {
    id: row.id, goalId: row.fleet_id, seq: row.seq, description: row.description,
    status: row.status, evidence: row.evidence,
    verifyCommand: row.verify_command, verifiedAt: row.verified_at, verifyExitCode: row.verify_exit_code,
    dispatchedSessionId: row.dispatched_session_id,
    dispatchStatus: row.dispatch_status, dispatchUpdatedAt: row.dispatch_updated_at,
    workItemId: row.work_item_id, boardStatus,
    createdAt: row.created_at, updatedAt: row.updated_at,
    details: row.details, memberId: row.member_id, fileScope: parseFileScope(row.file_scope_json),
    hold: row.hold_question ? { question: row.hold_question, askedAt: row.hold_asked_at ?? row.updated_at } : null,
    note, createdBy: row.created_by
  };
}

function journalDto(row: FleetJournalRow) {
  return { id: row.id, runId: row.run_id, taskId: row.task_id, note: row.note, createdAt: row.created_at };
}

function timerDto(row: FleetTimerRow) {
  return { id: row.id, taskId: row.task_id, dueAt: row.due_at, note: row.note };
}

function fleetError(res: Response, error: unknown): void {
  if (error instanceof AgentError && FLEET_CONFLICT_CODES.has(error.code)) {
    res.status(409).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  if (error instanceof AgentError && error.code === "FLEET_INPUT_INVALID") {
    res.status(400).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  if (error instanceof AgentError && error.code === "COPILOT_PROJECT_NOT_FOUND") return notFound(res);
  domainError(res, error);
}

/** Zod-guarded body + fleet error mapping (sync or async handlers). */
function withFleetBody<T>(body: unknown, schema: z.ZodType<T>, res: Response, callback: (value: T) => void | Promise<void>): void {
  withBody(body, schema, res, (value) => {
    Promise.resolve().then(() => callback(value)).catch(error => fleetError(res, error));
  });
}

/** Per-request handler wrapper: any throw (sync or async) is mapped by fleetError. */
function handle(res: Response, run: () => void | Promise<void>): void {
  Promise.resolve().then(run).catch(error => fleetError(res, error));
}

function projectName(db: Database, owner: string, projectId: string): string {
  return new ProjectRepository(db, owner).getById(projectId)?.name ?? "";
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * A repeated owner message is one wake-up while its first copy is still
 * pending: the key carries the text hash and how many copies of that text
 * were already picked up, so the same text sent after the flagship took the
 * previous one is a new event.
 */
function ownerMessageKey(db: Database, owner: string, fleetId: string, text: string): string {
  const hash = digest(text);
  const handled = (db.prepare(`SELECT count(*) AS count FROM fleet_events WHERE user_id=? AND fleet_id=? AND kind='owner_message'
      AND dedupe_key LIKE ? AND status<>'pending'`).get(owner, fleetId, `message:${hash}:%`) as { count: number }).count;
  return `message:${hash}:${handled}`;
}

export function createFleetRoutes(deps: AgentStackDeps): Router {
  const router = Router();
  router.use(authenticate);
  const tasksOut = (owner: string, fleet: FleetRow, tasks: FleetTaskRow[]) => {
    const store = new FleetStore(deps.db, owner);
    const goal = store.getGoal(fleet.id)!;
    const notes = new FleetNotes(deps.db, owner);
    return tasks.map(task => taskDto(task, task.work_item_id ? boardStatusOf(deps.db, owner, goal, task) : null, notes.taskNote(fleet.id, task.id, TASK_NOTE_CHARS)));
  };
  const taskOut = (owner: string, fleet: FleetRow, task: FleetTaskRow) => tasksOut(owner, fleet, [task])[0];
  /** The caller's fleet, or a 404 response. */
  const ownFleet = (req: unknown, res: Response): { owner: string; store: FleetStore; fleet: FleetRow } | undefined => {
    const id = parseId((req as { params: { id?: string } }).params.id, res); if (!id) return undefined;
    const owner = userId(req);
    const store = new FleetStore(deps.db, owner);
    const fleet = store.getFleet(id);
    if (!fleet) { notFound(res); return undefined; }
    return { owner, store, fleet };
  };

  router.get("/", (req, res) => handle(res, () => {
    res.json(ok({ fleets: new FleetStore(deps.db, userId(req)).listFleets().map(fleetListItemDto) }));
  }));

  router.post("/", (req, res) => withFleetBody(req.body, createSchema, res, (value) => {
    const owner = userId(req);
    const fleet = new FleetStore(deps.db, owner).createFleet(value);
    res.status(201).json(ok({ fleet: fleetDto(fleet, projectName(deps.db, owner, fleet.project_id)) }));
  }));

  router.get("/:id", (req, res) => handle(res, () => {
    const scope = ownFleet(req, res); if (!scope) return;
    const { owner, store, fleet } = scope;
    res.json(ok({
      fleet: fleetDto(fleet, projectName(deps.db, owner, fleet.project_id)),
      tasks: tasksOut(owner, fleet, store.listTasks(fleet.id)),
      journal: store.recentJournal(fleet.id, JOURNAL_LIMIT).map(journalDto),
      timers: new FleetTimers(deps.db, owner).listPending(fleet.id).map(timerDto),
      pendingEvents: new FleetInbox(deps.db, owner).countPending(fleet.id),
      leadActive: store.hasActiveGoalRun(fleet.id) || store.hasActiveRun(fleet.conversation_id)
    }));
  }));

  // Same projection as the goal team view (runs git, hence its own read).
  router.get("/:id/team", (req, res) => handle(res, async () => {
    const scope = ownFleet(req, res); if (!scope) return;
    res.json(ok(await goalTeamView(deps.db, scope.owner, scope.store.getGoal(scope.fleet.id)!)));
  }));

  router.patch("/:id", (req, res) => {
    const scope = ownFleet(req, res); if (!scope) return;
    withFleetBody(req.body, patchSchema, res, (value) => {
      const fleet = scope.store.updateFleet(scope.fleet.id, value);
      res.json(ok({ fleet: fleetDto(fleet, projectName(deps.db, scope.owner, fleet.project_id)) }));
    });
  });

  router.post("/:id/pause", (req, res) => handle(res, () => {
    const scope = ownFleet(req, res); if (!scope) return;
    const fleet = scope.store.setStatus(scope.fleet.id, "paused", "owner");
    res.json(ok({ fleet: fleetDto(fleet, projectName(deps.db, scope.owner, fleet.project_id)) }));
  }));

  router.post("/:id/resume", (req, res) => handle(res, () => {
    const scope = ownFleet(req, res); if (!scope) return;
    const { owner, store, fleet: before } = scope;
    let fleet = before;
    if (before.status === "paused") {
      // One wake-up per pause: a duplicate click finds the fleet active and does nothing.
      fleet = deps.db.transaction(() => {
        const resumed = store.setStatus(before.id, "active");
        new FleetInbox(deps.db, owner).enqueue(before.id, { kind: "fleet_resumed", dedupeKey: `resume:${before.updated_at}`, payload: { pausedReason: before.paused_reason } });
        return resumed;
      }).immediate();
      wakeFleet(deps.db, owner, fleet.id);
    }
    res.json(ok({ fleet: fleetDto(fleet, projectName(deps.db, owner, fleet.project_id)) }));
  }));

  router.post("/:id/tasks", (req, res) => {
    const scope = ownFleet(req, res); if (!scope) return;
    withFleetBody(req.body, taskSchema, res, (value) => {
      const { owner, store, fleet } = scope;
      const task = deps.db.transaction(() => {
        const created = store.addTask(fleet.id, { ...value, createdBy: "owner" });
        new FleetInbox(deps.db, owner).enqueue(fleet.id, { kind: "task_added", dedupeKey: `task:${created.id}`, taskId: created.id });
        return created;
      }).immediate();
      wakeFleet(deps.db, owner, fleet.id);
      res.status(201).json(ok({ task: taskOut(owner, fleet, task) }));
    });
  });

  router.post("/:id/tasks/:taskId/answer", (req, res) => {
    const scope = ownFleet(req, res); if (!scope) return;
    const taskId = parseId(req.params.taskId, res); if (!taskId) return;
    withFleetBody(req.body, answerSchema, res, (value) => {
      const { owner, store, fleet } = scope;
      const held = store.getTask(fleet.id, taskId);
      if (!held) return notFound(res);
      if (!held.hold_question || held.hold_asked_at === null)
        throw new AgentError("FLEET_TASK_NOT_HELD", `Task #${held.seq} has no open question`);
      const question = held.hold_question;
      const task = deps.db.transaction(() => {
        const cleared = store.clearHold(fleet.id, taskId);
        new FleetNotes(deps.db, owner).appendTaskNote(fleet.id, taskId, `Owner decision. Q: ${question}\nA: ${value.answer}`);
        store.appendJournal(fleet.id, null, `Owner answered the hold on task #${held.seq}: ${value.answer}`, taskId);
        new FleetInbox(deps.db, owner).enqueue(fleet.id, {
          kind: "hold_answered", dedupeKey: `answer:${taskId}:${held.hold_asked_at}`, taskId,
          payload: { question: Array.from(question).slice(0, HOLD_QUESTION_IN_EVENT).join(""), answer: value.answer }
        });
        return cleared;
      }).immediate();
      wakeFleet(deps.db, owner, fleet.id);
      res.json(ok({ task: taskOut(owner, fleet, task) }));
    });
  });

  router.post("/:id/tasks/:taskId/cancel", (req, res) => handle(res, () => {
    const scope = ownFleet(req, res); if (!scope) return;
    const taskId = parseId(req.params.taskId, res); if (!taskId) return;
    const { owner, store, fleet } = scope;
    if (!store.getTask(fleet.id, taskId)) return notFound(res);
    const task = deps.db.transaction(() => {
      const cancelled = store.cancelTask(fleet.id, taskId);
      new FleetInbox(deps.db, owner).enqueue(fleet.id, { kind: "task_cancelled", dedupeKey: `cancel:${taskId}`, taskId });
      return cancelled;
    }).immediate();
    wakeFleet(deps.db, owner, fleet.id);
    res.json(ok({ task: taskOut(owner, fleet, task) }));
  }));

  router.post("/:id/messages", (req, res) => {
    const scope = ownFleet(req, res); if (!scope) return;
    withFleetBody(req.body, messageSchema, res, (value) => {
      const { owner, fleet } = scope;
      const inserted = deps.db.transaction(() =>
        new FleetInbox(deps.db, owner).enqueue(fleet.id, { kind: "owner_message", dedupeKey: ownerMessageKey(deps.db, owner, fleet.id, value.text), payload: { text: value.text } })
      ).immediate();
      if (!inserted) return void res.json(ok({ accepted: true, duplicate: true }));
      wakeFleet(deps.db, owner, fleet.id);
      res.json(ok({ accepted: true }));
    });
  });

  router.get("/:id/diff", (req, res) => handle(res, async () => {
    const scope = ownFleet(req, res); if (!scope) return;
    const goal = scope.store.getGoal(scope.fleet.id)!;
    const project = new ProjectRepository(deps.db, scope.owner).getById(scope.fleet.project_id);
    if (!project) return notFound(res);
    const workspace = existingGoalWorkspace(deps.db, goal);
    if (!workspace) return void res.json(ok({ files: [], truncated: false, unintegratedTasks: [] }));
    const { files, truncated } = await diffGoalWorkspace(workspace, project.path);
    res.json(ok({ files, truncated, unintegratedTasks: await listUnintegratedTasks(deps.db, goal) }));
  }));

  router.post("/:id/merge", (req, res) => handle(res, async () => {
    const scope = ownFleet(req, res); if (!scope) return;
    const { owner, store, fleet } = scope;
    const project = new ProjectRepository(deps.db, owner).getById(fleet.project_id);
    if (!project) return notFound(res);
    if (!existingGoalWorkspace(deps.db, store.getGoal(fleet.id)!))
      throw new AgentError("COPILOT_GOAL_SANDBOX_MISSING", "The fleet workspace does not exist yet; nothing to merge");
    // One lock for gate → merge → cleanup: no flagship run can start until it is released (which wakes the fleet).
    const release = acquireFleetMergeLock(deps.db, owner, fleet.id);
    if (!release) throw new AgentError("COPILOT_GOAL_STATE", "A merge of this fleet is already running");
    try {
      res.json(ok(await mergeFleet(owner, store, fleet.id, project)));
    } finally { release(); }
  }));

  /** Caller holds the fleet merge lock. */
  async function mergeFleet(owner: string, store: FleetStore, fleetId: string, project: { id: string; path: string }) {
    const goal = store.getGoal(fleetId)!;
    const workspace = existingGoalWorkspace(deps.db, goal)!;
    const fleet = store.getFleet(fleetId)!;
    // Gate (re-checked under the lock): no flagship run, and no session alive in the shared integration tree,
    // whatever its dispatch record says. In-flight tasks in their own worktrees do not block.
    if (store.hasActiveGoalRun(fleetId) || store.hasActiveRun(fleet.conversation_id))
      throw new AgentError("COPILOT_GOAL_STATE", "The flagship is running; wait for it to end its run before merging");
    const writers = liveSessionsInTree(deps.db, owner, workspace.path, deps.sessionManager);
    if (writers.length)
      throw new AgentError("COPILOT_GOAL_STATE", `CLI session ${writers[0]} is still running in the shared fleet tree; stop it or wait for it before merging`);
    const result = await mergeGoalWorkspace(deps.db, owner, goal, workspace, project);
    const listing = [...result.merged, ...result.deleted.map(path => `${path} (deleted)`), ...result.kept.map(path => `${path} (kept)`)].slice(0, 50).join(", ");
    store.appendJournal(fleetId, null, `Owner merged ${workspace.kind === "worktree" ? `fleet branch ${workspace.branch}` : "the fleet workspace"} into the project${result.commit ? ` at ${result.commit.slice(0, 12)}` : ""}: ${listing || "(no changes)"}.`);
    const merged = store.getGoal(fleetId)!;
    const cleaned = await cleanupIntegratedTaskWorkspaces(deps.db, deps, owner, merged);
    if (cleaned.removed.length)
      store.appendJournal(fleetId, null, `Removed ${cleaned.removed.length} integrated task worktree(s) after the merge${cleaned.kept.length ? `; kept ${cleaned.kept.length} with work that is not in the fleet branch` : ""}.`);
    // One wake-up per merged fleet-branch state: a repeated click on an unchanged branch is the same key.
    enqueueFleetEvent(deps.db, owner, fleetId, {
      kind: "merge_done", dedupeKey: `merge:${merged.workspace_base_commit ?? result.commit ?? "none"}`,
      payload: { ...(result.commit ? { commit: result.commit } : {}), merged: result.merged.length, deleted: result.deleted.length }
    });
    return { ...result, cleanedTaskWorktrees: cleaned.removed.length };
  }

  return router;
}
