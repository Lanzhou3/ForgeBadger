import { CollaborationRepository } from "../../db/repositories/collaboration-repository.js";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../crypto/secret-box.js";
import type { Database } from "../../db/types.js";
import { CollaborationError, type CollaborationAccess } from "../collaboration/types.js";
import { HubCoordination, type HubTask } from "./coordination.js";
import {
  RemoteError,
  createRemoteProvider,
  parseRepository,
  type RemoteProviderClient,
  type RemoteProviderIO
} from "./remote-providers.js";

export type CheckKind = "pull_request" | "ci";
export type CheckStatus = "ok" | "attention" | "unknown";

export interface RemoteCheck {
  submissionId: string;
  taskId: string;
  kind: CheckKind;
  status: CheckStatus;
  details: Record<string, unknown>;
  checkedAt: number;
}

const MAX_TASKS = 30;
const REFRESHABLE = new Set(["in_progress", "blocked", "ready_for_review"]);
const ALWAYS_FATAL = new Set(["REMOTE_AUTH_REJECTED", "REMOTE_RATE_LIMITED", "REMOTE_REPOSITORY_NOT_FOUND"]);
const TOKEN_PATTERN = /^\S{1,512}$/;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_BUDGET_MS = 60_000;
const running = new Map<string, Promise<{ checks: RemoteCheck[] }>>();

export interface RemoteStatusOptions {
  /** A clean poll younger than this is answered from stored rows. */
  cooldownMs?: number;
  /** Wall-clock budget for one refresh; later submissions are marked unknown. */
  budgetMs?: number;
}

type Submission = NonNullable<HubTask["latestSubmission"]>;

function errorCode(error: unknown): string {
  return error instanceof RemoteError ? error.code : "REMOTE_RESPONSE_INVALID";
}

/** Pull request and CI status fetched from the project's Git host. Derived state only; never evidence. */
export class HubRemoteStatus {
  private readonly hub: HubCoordination;
  private readonly authority: CollaborationRepository;

  constructor(private readonly db: Database, private readonly actorId: string, private readonly masterKey: string, private readonly io: RemoteProviderIO = {}, private readonly options: RemoteStatusOptions = {}) {
    this.hub = new HubCoordination(db, actorId);
    this.authority = new CollaborationRepository(db, actorId);
  }

  setCredential(projectId: string, token: string): { tokenConfigured: true } {
    const access = this.hub.access(projectId, "manage");
    if (!TOKEN_PATTERN.test(token)) throw new CollaborationError(400, "INVALID_INPUT");
    const encrypted = JSON.stringify(encryptSecret(token, { key: this.masterKey }));
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO hub_remote_credentials(project_id,user_id,token_encrypted,updated_by,updated_at) VALUES(?,?,?,?,?)
         ON CONFLICT(project_id) DO UPDATE SET token_encrypted=excluded.token_encrypted,updated_by=excluded.updated_by,updated_at=excluded.updated_at`
      ).run(projectId, access.userId, encrypted, this.actorId, Date.now());
      this.authority.event(access, null, "hub_remote_credential_updated", { configured: true });
    })();
    return { tokenConfigured: true };
  }

  clearCredential(projectId: string): { tokenConfigured: false } {
    const access = this.hub.access(projectId, "manage");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM hub_remote_credentials WHERE user_id=? AND project_id=?").run(access.userId, projectId);
      this.authority.event(access, null, "hub_remote_credential_updated", { configured: false });
    })();
    return { tokenConfigured: false };
  }

  /** Concurrent refreshes of one project share a single in-flight run instead of queueing. */
  async refresh(projectId: string): Promise<{ checks: RemoteCheck[] }> {
    const access = this.refreshAccess(projectId);
    const key = `${access.userId}:${projectId}`;
    const existing = running.get(key);
    if (existing) return existing;
    const run = this.runRefresh(access);
    running.set(key, run);
    const clear = () => { if (running.get(key) === run) running.delete(key); };
    run.then(clear, clear);
    return run;
  }

  private refreshAccess(projectId: string): CollaborationAccess {
    try {
      return this.hub.access(projectId, "review");
    } catch (error) {
      if (error instanceof CollaborationError && error.status === 403) return this.hub.access(projectId, "manage");
      throw error;
    }
  }

  private async runRefresh(access: CollaborationAccess): Promise<{ checks: RemoteCheck[] }> {
    const settings = this.hub.project(access.projectId).settings;
    if (!settings.provider || !settings.remoteUrl) throw new CollaborationError(409, "HUB_REPOSITORY_NOT_CONFIGURED");
    let repository: { owner: string; repo: string };
    try {
      repository = parseRepository(settings.provider, settings.remoteUrl);
    } catch (error) {
      return this.fail(access, errorCode(error));
    }
    const inFlight = this.eligible(access.projectId);
    const cached = this.cachedChecks(access, inFlight);
    if (cached) return { checks: cached };
    const client = createRemoteProvider(settings.provider, this.token(access), this.io);
    const checks: RemoteCheck[] = [];
    let succeeded = false;
    const deadline = Date.now() + (this.options.budgetMs ?? DEFAULT_BUDGET_MS);
    try {
      for (const submission of inFlight) {
        if (Date.now() >= deadline) {
          checks.push(...this.budgetExceeded(access, submission));
          continue;
        }
        checks.push(...await this.checkSubmission(access, client, repository, submission, () => succeeded, () => { succeeded = true; }));
      }
    } catch (error) {
      return this.fail(access, errorCode(error));
    }
    this.pruneChecks(access, inFlight.map(submission => submission.id));
    this.recordSync(access, null);
    return { checks };
  }

  /** Drops derived PR/CI rows of submissions that are no longer in flight; other kinds are never touched. */
  private pruneChecks(access: CollaborationAccess, keepIds: string[]): void {
    const marks = keepIds.map(() => "?").join(",");
    this.db.prepare(
      `DELETE FROM hub_submission_checks WHERE user_id=? AND project_id=? AND kind IN ('pull_request','ci')${keepIds.length ? ` AND submission_id NOT IN (${marks})` : ""}`
    ).run(access.userId, access.projectId, ...keepIds);
  }

  private budgetExceeded(access: CollaborationAccess, submission: Submission): RemoteCheck[] {
    const details = { reason: "REMOTE_BUDGET_EXCEEDED" };
    return (["pull_request", "ci"] as const).map(kind => this.write(access, submission, kind, "unknown", details));
  }

  /** Stored rows for a clean poll inside the cooldown, else null (poll the provider). */
  private cachedChecks(access: CollaborationAccess, submissions: Submission[]): RemoteCheck[] | null {
    const sync = this.db.prepare("SELECT remote_polled_at AS polled,remote_error AS error FROM hub_project_sync WHERE user_id=? AND project_id=?")
      .get(access.userId, access.projectId) as { polled: number | null; error: string | null } | undefined;
    const cooldown = this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    if (!sync?.polled || sync.error || Date.now() - sync.polled >= cooldown) return null;
    const select = this.db.prepare("SELECT kind,status,details_json AS details,checked_at AS checkedAt FROM hub_submission_checks WHERE submission_id=? AND user_id=? AND kind IN ('pull_request','ci') ORDER BY kind DESC");
    return submissions.flatMap(submission =>
      (select.all(submission.id, access.userId) as Array<{ kind: CheckKind; status: CheckStatus; details: string; checkedAt: number }>)
        .map(row => ({ submissionId: submission.id, taskId: submission.taskId, kind: row.kind, status: row.status, details: JSON.parse(row.details) as Record<string, unknown>, checkedAt: row.checkedAt })));
  }

  private fail(access: CollaborationAccess, code: string): never {
    this.recordSync(access, code);
    throw new CollaborationError(502, code);
  }

  private eligible(projectId: string): Array<Submission & { taskId: string }> {
    return this.hub.listTasks(projectId, "all")
      .filter(task => task.latestSubmission?.current && REFRESHABLE.has(task.status))
      .map(task => task.latestSubmission!)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_TASKS);
  }

  private async checkSubmission(
    access: CollaborationAccess,
    client: RemoteProviderClient,
    repository: { owner: string; repo: string },
    submission: Submission,
    hasSucceeded: () => boolean,
    markSucceeded: () => void
  ): Promise<RemoteCheck[]> {
    const guard = (error: unknown): { reason: string } => {
      const code = errorCode(error);
      if (ALWAYS_FATAL.has(code) || (code === "REMOTE_UNREACHABLE" && !hasSucceeded())) throw error;
      return { reason: code };
    };
    const pr = await this.pullRequestCheck(client, repository, submission).then(result => { markSucceeded(); return result; }, error => ({ status: "unknown" as const, details: guard(error) }));
    const ci = await client.commitStatus({ ...repository, sha: submission.commitSha }).then(
      status => { markSucceeded(); return ciCheck(status); },
      error => ({ status: "unknown" as const, details: guard(error) })
    );
    return [
      this.write(access, submission, "pull_request", pr.status, pr.details),
      this.write(access, submission, "ci", ci.status, ci.details)
    ];
  }

  private async pullRequestCheck(client: RemoteProviderClient, repository: { owner: string; repo: string }, submission: Submission) {
    const pull = await client.findPullRequest({ ...repository, branch: submission.branch, sha: submission.commitSha, prUrl: submission.prUrl });
    if (!pull) return { status: "unknown" as CheckStatus, details: { reason: "NOT_FOUND" } as Record<string, unknown> };
    const matches = pull.headSha.toLowerCase() === submission.commitSha.toLowerCase();
    const live = pull.state === "open" || pull.state === "merged";
    return {
      status: (live && matches ? "ok" : "attention") as CheckStatus,
      details: { number: pull.number, url: pull.url, state: pull.state, draft: pull.draft, headSha: pull.headSha, matchesSubmission: matches } as Record<string, unknown>
    };
  }

  private write(access: CollaborationAccess, submission: Submission, kind: CheckKind, status: CheckStatus, details: Record<string, unknown>): RemoteCheck {
    const checkedAt = Date.now();
    this.db.prepare(
      `INSERT INTO hub_submission_checks(submission_id,user_id,project_id,kind,status,details_json,checked_at) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(submission_id,kind) DO UPDATE SET status=excluded.status,details_json=excluded.details_json,checked_at=excluded.checked_at`
    ).run(submission.id, access.userId, access.projectId, kind, status, JSON.stringify(details), checkedAt);
    return { submissionId: submission.id, taskId: submission.taskId, kind, status, details, checkedAt };
  }

  private recordSync(access: CollaborationAccess, error: string | null): void {
    this.db.prepare(
      `INSERT INTO hub_project_sync(project_id,user_id,remote_polled_at,remote_error) VALUES(?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET remote_polled_at=excluded.remote_polled_at,remote_error=excluded.remote_error`
    ).run(access.projectId, access.userId, Date.now(), error);
  }

  private token(access: CollaborationAccess): string | null {
    const row = this.db.prepare("SELECT token_encrypted AS value FROM hub_remote_credentials WHERE user_id=? AND project_id=?")
      .get(access.userId, access.projectId) as { value: string } | undefined;
    if (!row) return null;
    try {
      return decryptSecret(JSON.parse(row.value) as EncryptedSecret, { key: this.masterKey });
    } catch {
      throw new CollaborationError(409, "HUB_REMOTE_CREDENTIAL_UNREADABLE");
    }
  }
}

function ciCheck(status: { state: string; total: number; failed: number }): { status: CheckStatus; details: Record<string, unknown> } {
  const mapped: CheckStatus = status.state === "success" ? "ok" : status.state === "failure" ? "attention" : "unknown";
  return { status: mapped, details: { state: status.state, total: status.total, failed: status.failed } };
}
