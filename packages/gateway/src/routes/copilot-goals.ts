/**
 * Copilot Goal routes — /api/v1/copilot/goals*.
 *
 * Goal mode turns a conversation into a multi-run objective: the first run
 * decomposes the spec into a task checklist, and the GoalDriver enqueues
 * continuation runs until every task passes or task progress stagnates.
 * These routes own the lifecycle only
 * (create/pause/resume/cancel, list, detail); run execution stays in the
 * orchestrator and the driver.
 */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";

import { authenticate } from "../auth/middleware.js";
import { buildAgentStack, type AgentStackDeps } from "../services/agent/agent-stack.js";
import { clearGoalFailureCooldown, evaluateGoalContinuation } from "../services/agent/goal-driver.js";
import { diffGoalWorkspace, existingGoalWorkspace, mergeGoalWorkspace } from "../services/agent/goal-workspace.js";
import { CopilotGoalStore, type GoalJournalRow, type GoalListRow, type GoalRow, type GoalTaskRow } from "../services/agent/goal-store.js";
import { GOAL_GRANTS, parseGoalGrants } from "../services/agent/goal-grants.js";
import { boardStatusOf, syncGoalFromBoard } from "../services/agent/goal-board.js";
import { AgentError } from "../services/agent/types.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { domainError, idSchema, notFound, ok, parseId, userId, withBody, withQuery } from "./copilot-helpers.js";

const createGoalSchema = z.object({
  conversationId: idSchema,
  projectId: idSchema.optional(),
  title: z.string().trim().min(1).max(200),
  spec: z.string().trim().min(1).max(20_000),
  grants: z.array(z.enum(GOAL_GRANTS)).max(GOAL_GRANTS.length).optional()
}).strict();

const listGoalsSchema = z.object({ conversationId: idSchema.optional() }).strict();
const answerSchema = z.object({ answer: z.string().trim().min(1).max(4000) }).strict();

function goalDto(row: GoalRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    spec: row.spec,
    blockedReason: row.blocked_reason,
    pendingQuestion: row.pending_question,
    grants: parseGoalGrants(row.grants_json),
    // Filesystem paths stay server-side; the branch/base identify the work.
    workspace: row.workspace_kind
      ? { kind: row.workspace_kind, branch: row.workspace_branch, baseCommit: row.workspace_base_commit, targetBranch: row.workspace_target_branch }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function goalListItemDto(row: GoalListRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    grants: parseGoalGrants(row.grants_json),
    createdAt: row.created_at,
    taskTotal: row.task_total,
    taskPasses: row.task_passes
  };
}

function taskDto(row: GoalTaskRow, boardStatus: string | null = null) {
  return {
    id: row.id, goalId: row.goal_id, seq: row.seq, description: row.description,
    status: row.status, evidence: row.evidence,
    verifyCommand: row.verify_command, verifiedAt: row.verified_at, verifyExitCode: row.verify_exit_code,
    dispatchedSessionId: row.dispatched_session_id,
    dispatchStatus: row.dispatch_status, dispatchUpdatedAt: row.dispatch_updated_at,
    workItemId: row.work_item_id, boardStatus,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function journalDto(row: GoalJournalRow) {
  return { id: row.id, goalId: row.goal_id, runId: row.run_id, note: row.note, createdAt: row.created_at };
}

/** Lifecycle transitions: pause/resume are active↔paused only; cancel is the idempotent terminal reachable from any non-completed status. */
function applyTransition(store: CopilotGoalStore, goal: GoalRow, action: 'pause' | 'resume' | 'cancel'): GoalRow {
  const current = goal.status;
  const allowed =
    action === 'pause' ? current === 'active' :
    action === 'resume' ? current === 'paused' :
    current === 'active' || current === 'paused' || current === 'blocked' || current === 'cancelled';
  if (!allowed)
    throw new AgentError('COPILOT_GOAL_STATE', `Cannot ${action} a goal in status '${current}'`);
  if (action === 'cancel' && current === 'cancelled') return goal;
  const next = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled';
  return store.setStatus(goal.id, next)!;
}

export function createCopilotGoalRoutes(deps: AgentStackDeps): Router {
  const router = Router();
  router.use(authenticate);

  router.post("/goals", (req, res) => withBody(req.body, createGoalSchema, res, (value) => {
    const actingUser = userId(req);
    const store = new CopilotGoalStore(deps.db, actingUser);
    try {
      const goal = store.createGoal({
        conversationId: value.conversationId,
        ...(value.projectId ? { projectId: value.projectId } : {}),
        title: value.title,
        spec: value.spec,
        ...(value.grants ? { grants: value.grants } : {})
      });
      try {
        const runId = buildAgentStack(deps, actingUser).orchestrator.enqueue({
          userId: actingUser,
          conversationId: value.conversationId,
          goalId: goal.id,
          userText: value.spec,
          source: "user",
          clientRequestId: randomUUID()
        });
        res.status(201).json(ok({ goalId: goal.id, runId }));
      } catch (error) {
        // No initializer run can start: leave no orphaned active goal behind.
        store.setStatus(goal.id, 'cancelled');
        throw error;
      }
    } catch (error) { domainError(res, error); }
  }));

  router.get("/goals", (req, res) => withQuery(req.query, listGoalsSchema, res, (value) => {
    const goals = new CopilotGoalStore(deps.db, userId(req)).listGoals(value.conversationId);
    res.json(ok({ goals: goals.map(goalListItemDto) }));
  }));

  router.get("/goals/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const store = new CopilotGoalStore(deps.db, userId(req));
    let goal = store.getGoal(id);
    if (!goal) return notFound(res);
    // Owner board decisions show up even while the goal is paused/blocked.
    if (syncGoalFromBoard(deps.db, userId(req), goal)) goal = store.getGoal(id)!;
    res.json(ok({
      goal: goalDto(goal),
      tasks: store.listTasks(id).map(task => taskDto(task, boardStatusOf(deps.db, userId(req), goal!, task))),
      journal: store.recentJournal(id, 20).map(journalDto),
      pendingQuestion: goal.pending_question
    }));
  });

  router.post("/goals/:id/answer", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    withBody(req.body, answerSchema, res, (value) => {
      const actingUser = userId(req);
      const store = new CopilotGoalStore(deps.db, actingUser);
      const goal = store.getGoal(id);
      if (!goal) return notFound(res);
      if (goal.status !== 'blocked' || goal.blocked_reason !== 'awaiting_user' || !goal.pending_question)
        throw new AgentError('COPILOT_GOAL_STATE', `Goal is not awaiting an owner answer (status '${goal.status}')`);
      // Journal + clear question + resume atomically; the continuation
      // evaluation runs after the transaction and must not fail the response.
      store.applyAnswer(id, value.answer, null);
      clearGoalFailureCooldown(id);
      try {
        evaluateGoalContinuation(deps, actingUser, id, undefined, { userText: `[Goal 用户答复] ${value.answer}` });
      } catch (error) {
        console.error('[goal answer]', { operation: 'continue', userId: actingUser, timestamp: new Date().toISOString(),
          code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'COPILOT_GOAL_CONTINUE_FAILED' });
      }
      res.json(ok({ goal: goalDto(store.getGoal(id)!) }));
    });
  });

  router.get("/goals/:id/diff", async (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    try {
      const store = new CopilotGoalStore(deps.db, userId(req));
      const goal = store.getGoal(id);
      if (!goal) return notFound(res);
      if (!goal.project_id) return res.json(ok({ files: [], truncated: false }));
      const project = new ProjectRepository(deps.db, userId(req)).getById(goal.project_id);
      if (!project) return notFound(res);
      const workspace = existingGoalWorkspace(deps.db, goal);
      if (!workspace) return res.json(ok({ files: [], truncated: false }));
      const { files, truncated } = await diffGoalWorkspace(workspace, project.path);
      res.json(ok({ files, truncated }));
    } catch (error) { domainError(res, error); }
  });

  router.post("/goals/:id/merge", async (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    try {
      const actingUser = userId(req);
      const store = new CopilotGoalStore(deps.db, actingUser);
      const goal = store.getGoal(id);
      if (!goal) return notFound(res);
      if (!goal.project_id) throw new AgentError('COPILOT_GOAL_SANDBOX_MISSING', 'Goal has no project; nothing to merge');
      const project = new ProjectRepository(deps.db, actingUser).getById(goal.project_id);
      if (!project) return notFound(res);
      const workspace = existingGoalWorkspace(deps.db, goal);
      if (!workspace) throw new AgentError('COPILOT_GOAL_SANDBOX_MISSING', 'Goal workspace does not exist; nothing to merge');
      // Same gate as the slash command: no merge while the goal has an
      // active run or has not reached a settled state.
      const active = deps.db.prepare(`SELECT 1 FROM copilot_runs WHERE user_id=? AND goal_id=? AND status IN ('pending','running','awaiting_approval') LIMIT 1`)
        .get(actingUser, id);
      if (active) throw new AgentError('COPILOT_GOAL_STATE', 'Goal has an active run; stop or wait for it before merging');
      if (goal.status !== 'completed' && goal.status !== 'blocked')
        throw new AgentError('COPILOT_GOAL_STATE', `Goal is '${goal.status}'; only completed or blocked goals can be merged`);
      // Dry-run conflicts (copy) or a refused git integration (worktree)
      // abort the whole merge before the project changes.
      const result = await mergeGoalWorkspace(deps.db, actingUser, goal, workspace, project);
      const listing = [...result.merged, ...result.deleted.map(path => `${path} (deleted)`), ...result.kept.map(path => `${path} (kept)`)]
        .slice(0, 50).join(', ');
      store.appendJournal(id, null, `Merged ${workspace.kind === 'worktree' ? `goal branch ${workspace.branch}` : 'sandbox'} into project${result.commit ? ` at ${result.commit.slice(0, 12)}` : ''}: ${listing || '(no changes)'}.`);
      res.json(ok(result));
    } catch (error) { domainError(res, error); }
  });

  for (const action of ['pause', 'resume', 'cancel'] as const) {
    router.post(`/goals/:id/${action}`, (req, res) => {
      const id = parseId(req.params.id, res); if (!id) return;
      const actingUser = userId(req);
      const store = new CopilotGoalStore(deps.db, actingUser);
      const goal = store.getGoal(id);
      if (!goal) return notFound(res);
      try {
        const updated = applyTransition(store, goal, action);
        if (action === 'resume' && updated.status === 'active') {
          clearGoalFailureCooldown(id);
          evaluateGoalContinuation(deps, actingUser, id);
        }
        res.json(ok({ goal: goalDto(store.getGoal(id)!) }));
      } catch (error) { domainError(res, error); }
    });
  }

  return router;
}
