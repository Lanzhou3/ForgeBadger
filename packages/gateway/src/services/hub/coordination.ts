import { randomUUID } from "node:crypto";

import { CollaborationRepository } from "../../db/repositories/collaboration-repository.js";
import { ProjectManagerRepository } from "../../db/repositories/project-manager-repository.js";
import type { Database } from "../../db/types.js";
import { CollaborationTasks, type CollaborationTask } from "../collaboration/tasks.js";
import { CollaborationError, type Capability, type CollaborationAccess } from "../collaboration/types.js";
import { mutateAssignedTask } from "../project-manager/tasks.js";

export type ConfirmationActorKind = "human" | "copilot" | "system";
export type ConfirmationDecision = "accepted" | "changes_requested";
export type ConfirmationEffect = "binding" | "advisory";
export type ChecksStatus = "passed" | "failed" | "not_run";
export type RepoProvider = "github" | "gitee";

/**
 * Which reviewer kinds may issue a binding confirmation, per project policy.
 * This table is the single seam for a later Copilot reviewer: add a policy
 * here and accept it in `putSettings`. Every other kind stays advisory, which
 * records the opinion without moving the task.
 */
const BINDING_ACTOR_KINDS: Record<string, readonly ConfirmationActorKind[]> = {
  human_only: ["human"]
};
export const CONFIRMATION_POLICIES = Object.keys(BINDING_ACTOR_KINDS);
const DEFAULT_POLICY = "human_only";

export interface HubSubmission {
  id: string;
  taskId: string;
  actorId: string;
  branch: string;
  commitSha: string;
  prUrl: string | null;
  checksStatus: ChecksStatus;
  checksSummary: string;
  taskSemanticRevision: number;
  createdAt: number;
}

export interface HubConfirmation {
  id: string;
  submissionId: string;
  actorId: string;
  actorKind: ConfirmationActorKind;
  effect: ConfirmationEffect;
  decision: ConfirmationDecision;
  note: string;
  commitSha: string;
  createdAt: number;
}

export interface HubSettings {
  provider: RepoProvider | null;
  remoteUrl: string | null;
  defaultBranch: string | null;
  confirmationPolicy: string;
  revision: number;
}

export interface HubTask extends CollaborationTask {
  latestSubmission: (HubSubmission & { current: boolean; confirmation: HubConfirmation | null }) | null;
}

export interface SubmissionInput {
  expectedRevision: number;
  branch: string;
  commitSha: string;
  prUrl?: string | null | undefined;
  checksStatus: ChecksStatus;
  checksSummary?: string | undefined;
}

export interface ConfirmationInput {
  expectedRevision: number;
  submissionId: string;
  decision: ConfirmationDecision;
  note: string;
}

const SUBMISSION_COLUMNS = `id,work_item_id AS taskId,actor_id AS actorId,branch,commit_sha AS commitSha,pr_url AS prUrl,
  checks_status AS checksStatus,checks_summary AS checksSummary,task_semantic_revision AS taskSemanticRevision,created_at AS createdAt`;
const CONFIRMATION_COLUMNS = `id,submission_id AS submissionId,actor_id AS actorId,actor_kind AS actorKind,effect,decision,note,
  commit_sha AS commitSha,created_at AS createdAt`;

/**
 * Team hub coordination for one acting user. Members execute on their own
 * machines; the hub only records who works on what, what they published and
 * who confirmed it. Authority always comes from CollaborationRepository, so a
 * revoked grant or disabled account loses access on its next call.
 */
export class HubCoordination {
  private readonly authority: CollaborationRepository;
  private readonly tasks: CollaborationTasks;

  constructor(private readonly db: Database, private readonly actorId: string) {
    this.authority = new CollaborationRepository(db, actorId);
    this.tasks = new CollaborationTasks(db, actorId);
  }

  access(projectId: string, capability: Capability = "read"): CollaborationAccess {
    return this.authority.access(projectId, capability);
  }

  project(projectId: string) {
    const access = this.access(projectId);
    return {
      project: { id: access.projectId, name: access.name, role: access.role, capabilities: access.capabilities },
      actorId: this.actorId,
      settings: this.settings(access)
    };
  }

  putSettings(projectId: string, input: { expectedRevision: number; provider: RepoProvider; remoteUrl: string; defaultBranch: string; confirmationPolicy?: string | undefined }): HubSettings {
    const access = this.access(projectId, "manage");
    const policy = input.confirmationPolicy ?? this.settings(access).confirmationPolicy;
    if (!CONFIRMATION_POLICIES.includes(policy)) throw new CollaborationError(400, "CONFIRMATION_POLICY_UNSUPPORTED");
    return this.db.transaction(() => {
      const previous = this.settings(access);
      if (previous.revision !== input.expectedRevision) throw new CollaborationError(409, "STALE_HUB_SETTINGS_REVISION");
      // A stored Git host token was saved for one provider and repository;
      // never let it be sent anywhere else after the target changes.
      if (previous.provider !== input.provider || previous.remoteUrl !== input.remoteUrl) {
        this.db.prepare("DELETE FROM hub_remote_credentials WHERE user_id=? AND project_id=?").run(access.userId, projectId);
      }
      this.db.prepare(
        `INSERT INTO hub_projects(project_id,user_id,provider,remote_url,default_branch,confirmation_policy,revision,updated_by,updated_at)
         VALUES(@project,@owner,@provider,@remote,@branch,@policy,1,@actor,@now)
         ON CONFLICT(project_id) DO UPDATE SET provider=excluded.provider,remote_url=excluded.remote_url,default_branch=excluded.default_branch,
          confirmation_policy=excluded.confirmation_policy,revision=hub_projects.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`
      ).run({ project: projectId, owner: access.userId, provider: input.provider, remote: input.remoteUrl, branch: input.defaultBranch, policy, actor: this.actorId, now: Date.now() });
      this.authority.event(access, null, "hub_settings_updated", { provider: input.provider, confirmationPolicy: policy });
      return this.settings(access);
    })();
  }

  listTasks(projectId: string, scope: "mine" | "all"): HubTask[] {
    const access = this.access(projectId);
    const tasks = this.tasks.list(access).filter(task => scope === "all" || task.assigneeId === this.actorId);
    return tasks.map(task => this.withSubmission(access, task));
  }

  task(projectId: string, taskId: string) {
    const access = this.access(projectId);
    const task = this.withSubmission(access, this.tasks.get(access, taskId));
    const submissions = this.submissions(access, taskId);
    return {
      task,
      submissions: submissions.map(submission => ({ ...submission, confirmations: this.confirmations(submission.id) })),
      comments: this.tasks.comments(access, taskId)
    };
  }

  /** Take an unassigned task (or re-affirm one's own) and start it. */
  claim(projectId: string, taskId: string, expectedRevision: number): HubTask {
    const access = this.access(projectId, "develop");
    return this.db.transaction(() => {
      const task = this.openTask(access, taskId, expectedRevision);
      if (task.assigneeId && task.assigneeId !== this.actorId) throw new CollaborationError(409, "TASK_ASSIGNED_TO_ANOTHER_MEMBER");
      if (!task.assigneeId) mutateAssignedTask(this.db, this.actorId, projectId, taskId, { assigneeId: this.actorId, expectedRevision });
      this.advance(access, taskId, "in_progress");
      return this.withSubmission(access, this.tasks.get(access, taskId));
    })();
  }

  /** Assignee progress only; review and completion have their own entry points. */
  setStatus(projectId: string, taskId: string, input: { expectedRevision: number; status: "in_progress" | "blocked" }): HubTask {
    const access = this.access(projectId, "develop");
    return this.db.transaction(() => {
      this.assigneeTask(access, taskId, input.expectedRevision);
      this.transition(access, taskId, input.status);
      return this.withSubmission(access, this.tasks.get(access, taskId));
    })();
  }

  /** Record the published branch/commit and hand the task to review. */
  submit(projectId: string, taskId: string, input: SubmissionInput): { task: HubTask; submission: HubSubmission } {
    const access = this.access(projectId, "develop");
    return this.db.transaction(() => {
      const task = this.assigneeTask(access, taskId, input.expectedRevision);
      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO hub_task_submissions(id,user_id,project_id,work_item_id,actor_id,branch,commit_sha,pr_url,checks_status,checks_summary,task_semantic_revision,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(id, access.userId, projectId, taskId, this.actorId, input.branch, input.commitSha.toLowerCase(), input.prUrl ?? null,
        input.checksStatus, input.checksSummary ?? "", task.semanticRevision, Date.now());
      this.advance(access, taskId, "ready_for_review");
      this.authority.event(access, taskId, "submission_recorded", { submissionId: id, commitSha: input.commitSha.toLowerCase(), checksStatus: input.checksStatus });
      const submission = this.submissions(access, taskId).find(row => row.id === id)!;
      return { task: this.withSubmission(access, this.tasks.get(access, taskId)), submission };
    })();
  }

  /**
   * Review the latest submission. `actorKind` is supplied by the trusted
   * caller (the HTTP route always passes "human"), never by request input.
   * Kinds the project policy does not empower are stored as advisory records
   * and leave the task untouched.
   */
  confirm(projectId: string, taskId: string, input: ConfirmationInput, actorKind: ConfirmationActorKind): { task: HubTask; confirmation: HubConfirmation } {
    const access = this.access(projectId, "review");
    return this.db.transaction(() => {
      const task = this.openTask(access, taskId, input.expectedRevision);
      const submission = this.reviewableSubmission(access, task, input.submissionId);
      if (task.reviewerId && task.reviewerId !== this.actorId && !access.capabilities.includes("manage")) {
        throw new CollaborationError(403, "TASK_REVIEWER_REQUIRED");
      }
      const effect = this.effectFor(access, actorKind);
      if (effect === "binding" && this.confirmations(submission.id).some(row => row.effect === "binding")) {
        throw new CollaborationError(409, "SUBMISSION_ALREADY_CONFIRMED");
      }
      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO hub_task_confirmations(id,user_id,project_id,work_item_id,submission_id,actor_id,actor_kind,effect,decision,note,commit_sha,task_semantic_revision,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(id, access.userId, projectId, taskId, submission.id, this.actorId, actorKind, effect, input.decision, input.note,
        submission.commitSha, submission.taskSemanticRevision, Date.now());
      if (effect === "binding") this.applyDecision(access, taskId, submission, input.decision);
      this.authority.event(access, taskId, "submission_confirmed", { submissionId: submission.id, decision: input.decision, actorKind, effect });
      const confirmation = this.confirmations(submission.id).find(row => row.id === id)!;
      return { task: this.withSubmission(access, this.tasks.get(access, taskId)), confirmation };
    })();
  }

  comment(projectId: string, taskId: string, text: string) {
    return this.tasks.comment(projectId, taskId, text);
  }

  private settings(access: CollaborationAccess): HubSettings {
    const row = this.db.prepare(
      `SELECT provider,remote_url AS remoteUrl,default_branch AS defaultBranch,confirmation_policy AS confirmationPolicy,revision
       FROM hub_projects WHERE user_id=? AND project_id=?`
    ).get(access.userId, access.projectId) as HubSettings | undefined;
    return row ?? { provider: null, remoteUrl: null, defaultBranch: null, confirmationPolicy: DEFAULT_POLICY, revision: 0 };
  }

  /** Unknown stored policies fail closed to advisory for every non-human kind. */
  private effectFor(access: CollaborationAccess, actorKind: ConfirmationActorKind): ConfirmationEffect {
    const allowed = BINDING_ACTOR_KINDS[this.settings(access).confirmationPolicy] ?? BINDING_ACTOR_KINDS[DEFAULT_POLICY]!;
    return allowed.includes(actorKind) ? "binding" : "advisory";
  }

  private openTask(access: CollaborationAccess, taskId: string, expectedRevision: number): CollaborationTask {
    const task = this.tasks.get(access, taskId);
    if (task.status === "done" || task.status === "cancelled") throw new CollaborationError(409, "TASK_ALREADY_FINISHED");
    if (task.revision !== expectedRevision) throw new CollaborationError(409, "STALE_TASK_REVISION");
    return task;
  }

  private assigneeTask(access: CollaborationAccess, taskId: string, expectedRevision: number): CollaborationTask {
    const task = this.openTask(access, taskId, expectedRevision);
    if (task.assigneeId !== this.actorId) throw new CollaborationError(403, "TASK_ASSIGNEE_REQUIRED");
    return task;
  }

  private reviewableSubmission(access: CollaborationAccess, task: CollaborationTask, submissionId: string): HubSubmission {
    const submissions = this.submissions(access, task.id);
    const submission = submissions.find(row => row.id === submissionId);
    if (!submission) throw new CollaborationError(404, "SUBMISSION_NOT_FOUND");
    if (submissions[0]!.id !== submission.id) throw new CollaborationError(409, "SUBMISSION_SUPERSEDED");
    if (submission.taskSemanticRevision !== task.semanticRevision) throw new CollaborationError(409, "SUBMISSION_STALE");
    if (task.status !== "ready_for_review") throw new CollaborationError(409, "TASK_NOT_AWAITING_REVIEW");
    if (submission.actorId === this.actorId) throw new CollaborationError(403, "SELF_CONFIRMATION_DENIED");
    return submission;
  }

  private applyDecision(access: CollaborationAccess, taskId: string, submission: HubSubmission, decision: ConfirmationDecision): void {
    if (decision === "changes_requested") {
      this.transition(access, taskId, "in_progress");
      return;
    }
    this.transition(access, taskId, "done", [
      { kind: "confirmation", label: "Confirmed submission", ref: submission.commitSha, status: "accepted" }
    ]);
  }

  /** Move forward to `target`, passing through in_progress when required. */
  private advance(access: CollaborationAccess, taskId: string, target: "in_progress" | "ready_for_review"): void {
    const status = this.tasks.get(access, taskId).status;
    if (status === target) return;
    if (target === "ready_for_review" && (status === "todo" || status === "blocked")) this.transition(access, taskId, "in_progress");
    this.transition(access, taskId, target);
  }

  private transition(access: CollaborationAccess, taskId: string, status: "in_progress" | "blocked" | "ready_for_review" | "done", evidenceRefs?: Array<{ kind: string; label: string; ref: string; status: string }>): void {
    const repository = new ProjectManagerRepository(this.db, access.userId, this.actorId);
    if (repository.getWorkItem(access.projectId, taskId)?.status === status) return;
    try {
      repository.updateWorkItemStatus(access.projectId, taskId, { status, ...(evidenceRefs ? { evidenceRefs } : {}) });
    } catch (error) {
      if (error instanceof CollaborationError) throw error;
      throw new CollaborationError(409, "TASK_STATUS_TRANSITION_REJECTED");
    }
  }

  private submissions(access: CollaborationAccess, taskId: string): HubSubmission[] {
    return this.db.prepare(
      `SELECT ${SUBMISSION_COLUMNS} FROM hub_task_submissions WHERE user_id=? AND project_id=? AND work_item_id=?
       ORDER BY created_at DESC,rowid DESC LIMIT 50`
    ).all(access.userId, access.projectId, taskId) as HubSubmission[];
  }

  private confirmations(submissionId: string): HubConfirmation[] {
    return this.db.prepare(
      `SELECT ${CONFIRMATION_COLUMNS} FROM hub_task_confirmations WHERE submission_id=? ORDER BY created_at,rowid`
    ).all(submissionId) as HubConfirmation[];
  }

  private withSubmission(access: CollaborationAccess, task: CollaborationTask): HubTask {
    const latest = this.submissions(access, task.id)[0];
    if (!latest) return { ...task, latestSubmission: null };
    const confirmation = this.confirmations(latest.id).find(row => row.effect === "binding") ?? null;
    return { ...task, latestSubmission: { ...latest, current: latest.taskSemanticRevision === task.semanticRevision, confirmation } };
  }
}
