import { CollaborationRepository } from "../../db/repositories/collaboration-repository.js";
import type { Database } from "../../db/types.js";
import { CollaborationTasks } from "../collaboration/tasks.js";
import { CollaborationError, type CollaborationAccess } from "../collaboration/types.js";
import { CODEOWNERS_CANDIDATES, CODEOWNERS_MAX_BYTES, matchesPattern, parseCodeowners, readCodeowners, type CodeownersEntry } from "./codeowners.js";
import { HubCoordination } from "./coordination.js";
import { changedFiles, fetchMirror, hasCommit, mergeConflicts, readFileAtRef, remoteBranchExists, remoteRef } from "./mirror-git.js";

export type CheckKind = "base_conflict" | "peer_conflict" | "scope" | "pull_request" | "ci";
export type CheckStatus = "ok" | "attention" | "unknown";
type MirrorKind = "base_conflict" | "peer_conflict" | "scope";

export interface HubCheck {
  submissionId: string;
  taskId: string;
  kind: CheckKind;
  status: CheckStatus;
  details: Record<string, unknown>;
  checkedAt: number;
}

export interface HubInsightsView {
  modules: CodeownersEntry[];
  taskModules: Record<string, string>;
  checks: HubCheck[];
  sync: { mirrorFetchedAt: number | null; mirrorError: string | null; remotePolledAt: number | null; remoteError: string | null };
  remote: { tokenConfigured: boolean };
}

interface InFlight {
  submissionId: string;
  taskId: string;
  commitSha: string;
}

interface CheckResult {
  submissionId: string;
  kind: MirrorKind;
  status: CheckStatus;
  details: Record<string, unknown>;
}

const IN_FLIGHT_STATUSES = new Set(["in_progress", "blocked", "ready_for_review"]);
const MAX_IN_FLIGHT = 30;
const MAX_BASE_FILES = 50;
const MAX_PEER_FILES = 20;
const MIRROR_KINDS: MirrorKind[] = ["base_conflict", "peer_conflict", "scope"];

type PairResult = { files: string[] } | { reason: string };

const pairKey = (first: InFlight, second: InFlight): string =>
  first.submissionId < second.submissionId ? `${first.submissionId}|${second.submissionId}` : `${second.submissionId}|${first.submissionId}`;

export interface HubInsightsOptions {
  /** Minimum age of the last successful fetch before another refresh runs git. */
  cooldownMs?: number;
  /** Wall-clock budget for the analysis phase of one refresh. */
  analysisBudgetMs?: number;
}

const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_ANALYSIS_BUDGET_MS = 120_000;

// One refresh per project at a time; concurrent callers share the running one.
const running = new Map<string, Promise<void>>();

function unknown(reason: string): { status: CheckStatus; details: Record<string, unknown> } {
  return { status: "unknown", details: { reason } };
}

export class HubInsights {
  private readonly coordination: HubCoordination;
  private readonly authority: CollaborationRepository;
  private readonly tasks: CollaborationTasks;

  private readonly cooldownMs: number;
  private readonly analysisBudgetMs: number;

  constructor(private readonly db: Database, actorId: string, options: HubInsightsOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.analysisBudgetMs = options.analysisBudgetMs ?? DEFAULT_ANALYSIS_BUDGET_MS;
    this.coordination = new HubCoordination(db, actorId);
    this.authority = new CollaborationRepository(db, actorId);
    this.tasks = new CollaborationTasks(db, actorId);
  }

  async insights(projectId: string): Promise<HubInsightsView> {
    const access = this.coordination.access(projectId, "read");
    return this.view(access);
  }

  async setTaskModule(projectId: string, taskId: string, pattern: string | null): Promise<Record<string, string>> {
    const access = this.coordination.access(projectId, "manage");
    this.tasks.get(access, taskId);
    if (pattern !== null && !(await this.modules(access)).some(entry => entry.pattern === pattern)) {
      throw new CollaborationError(400, "MODULE_PATTERN_UNKNOWN");
    }
    this.db.transaction(() => {
      if (pattern === null) {
        this.db.prepare("DELETE FROM hub_task_modules WHERE user_id=? AND project_id=? AND work_item_id=?").run(access.userId, projectId, taskId);
      } else {
        this.db.prepare(
          `INSERT INTO hub_task_modules(work_item_id,user_id,project_id,pattern,updated_by,updated_at) VALUES(?,?,?,?,?,?)
           ON CONFLICT(work_item_id) DO UPDATE SET pattern=excluded.pattern,updated_by=excluded.updated_by,updated_at=excluded.updated_at`
        ).run(taskId, access.userId, projectId, pattern, this.authority.actorId, Date.now());
      }
      this.authority.event(access, taskId, "task_module_updated", { pattern });
    })();
    return this.taskModules(access);
  }

  async refreshMirror(projectId: string): Promise<HubInsightsView> {
    const access = this.coordination.access(projectId, "read");
    if (!access.capabilities.includes("review") && !access.capabilities.includes("manage")) {
      throw new CollaborationError(403, "PROJECT_CAPABILITY_DENIED");
    }
    const { remoteUrl, defaultBranch } = this.coordination.project(projectId).settings;
    if (!remoteUrl || !defaultBranch) throw new CollaborationError(409, "HUB_REPOSITORY_NOT_CONFIGURED");
    const key = access.projectId;
    let job = running.get(key);
    if (!job && this.recentlyFetched(access)) return this.view(access);
    if (!job) {
      job = this.runRefresh(access, remoteUrl, defaultBranch).finally(() => running.delete(key));
      running.set(key, job);
    }
    await job;
    return this.view(this.coordination.access(projectId, "read"));
  }

  private recentlyFetched(access: CollaborationAccess): boolean {
    const fetchedAt = this.sync(access).mirrorFetchedAt;
    return fetchedAt !== null && Date.now() - fetchedAt < this.cooldownMs;
  }

  /**
   * CODEOWNERS from the fetched default branch; the mirror working tree is
   * only a fallback before the repository is configured or first fetched.
   */
  private async modules(access: CollaborationAccess): Promise<CodeownersEntry[]> {
    const branch = this.coordination.project(access.projectId).settings.defaultBranch;
    try {
      if (branch && await remoteBranchExists(access.path, branch)) {
        const text = await readFileAtRef(access.path, remoteRef(branch), CODEOWNERS_CANDIDATES, CODEOWNERS_MAX_BYTES);
        return text === null ? [] : parseCodeowners(text);
      }
    } catch {
      return [];
    }
    return readCodeowners(access.path);
  }

  private async runRefresh(access: CollaborationAccess, remoteUrl: string, defaultBranch: string): Promise<void> {
    try {
      await fetchMirror(access.path, remoteUrl);
    } catch (error) {
      const code = error instanceof Error && /^MIRROR_[A-Z_]+$/u.test(error.message) ? error.message : "MIRROR_FETCH_FAILED";
      this.recordSync(access, null, code);
      throw new CollaborationError(502, code);
    }
    const flight = this.inFlight(access);
    const results = await this.analyze(access, defaultBranch, flight);
    this.store(access, results);
    this.recordSync(access, Date.now(), null);
  }

  private async analyze(access: CollaborationAccess, branch: string, flight: InFlight[]): Promise<CheckResult[]> {
    const over = this.budget();
    const present = new Set<string>();
    for (const item of flight) if (await this.safeHasCommit(access.path, item.commitSha)) present.add(item.submissionId);
    const modules = this.taskModules(access);
    const fetched = flight.filter(item => present.has(item.submissionId));
    const pairs = await this.peerPairs(access.path, fetched, over);
    const results: CheckResult[] = [];
    for (const item of flight) {
      if (!present.has(item.submissionId)) {
        for (const kind of this.kindsFor(modules, item)) results.push({ submissionId: item.submissionId, kind, ...unknown("COMMIT_NOT_FETCHED") });
        continue;
      }
      results.push(over() ? this.exhausted(item, "base_conflict") : await this.baseCheck(access.path, branch, item));
      const pattern = modules[item.taskId];
      if (pattern) results.push(over() ? this.exhausted(item, "scope") : await this.scopeCheck(access.path, branch, item, pattern));
      results.push(this.peerResult(item, fetched, pairs));
    }
    return results;
  }

  /** Wall-clock budget for the analysis phase of one refresh. */
  private budget(): () => boolean {
    const deadline = Date.now() + this.analysisBudgetMs;
    return () => Date.now() >= deadline;
  }

  private exhausted(item: InFlight, kind: MirrorKind): CheckResult {
    return { submissionId: item.submissionId, kind, ...unknown("ANALYSIS_BUDGET_EXCEEDED") };
  }

  private kindsFor(modules: Record<string, string>, item: InFlight): MirrorKind[] {
    return modules[item.taskId] ? MIRROR_KINDS : ["base_conflict", "peer_conflict"];
  }

  private async safeHasCommit(path: string, sha: string): Promise<boolean> {
    try {
      return await hasCommit(path, sha);
    } catch {
      return false;
    }
  }

  private async baseCheck(path: string, branch: string, item: InFlight): Promise<CheckResult> {
    const base = { submissionId: item.submissionId, kind: "base_conflict" as const };
    try {
      const files = await mergeConflicts(path, remoteRef(branch), item.commitSha);
      return { ...base, status: files.length ? "attention" : "ok", details: { baseBranch: branch, files: files.slice(0, MAX_BASE_FILES), truncated: files.length > MAX_BASE_FILES } };
    } catch {
      return { ...base, ...unknown("ANALYSIS_FAILED") };
    }
  }

  private async scopeCheck(path: string, branch: string, item: InFlight, pattern: string): Promise<CheckResult> {
    const base = { submissionId: item.submissionId, kind: "scope" as const };
    try {
      const outside = (await changedFiles(path, remoteRef(branch), item.commitSha)).filter(file => !matchesPattern(pattern, file));
      return { ...base, status: outside.length ? "attention" : "ok", details: { pattern, outside: outside.slice(0, MAX_BASE_FILES), total: outside.length } };
    } catch {
      return { ...base, ...unknown("ANALYSIS_FAILED") };
    }
  }

  /** One merge-tree per unordered pair of submissions of different tasks. */
  private async peerPairs(path: string, items: InFlight[], over: () => boolean): Promise<Map<string, PairResult>> {
    const pairs = new Map<string, PairResult>();
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const [first, second] = [items[i]!, items[j]!];
        if (first.taskId === second.taskId || first.commitSha === second.commitSha) continue;
        pairs.set(pairKey(first, second), await this.pairResult(path, first, second, over));
      }
    }
    return pairs;
  }

  private async pairResult(path: string, first: InFlight, second: InFlight, over: () => boolean): Promise<PairResult> {
    if (over()) return { reason: "ANALYSIS_BUDGET_EXCEEDED" };
    try {
      return { files: await mergeConflicts(path, first.commitSha, second.commitSha) };
    } catch {
      return { reason: "ANALYSIS_FAILED" };
    }
  }

  private peerResult(item: InFlight, items: InFlight[], pairs: Map<string, PairResult>): CheckResult {
    const base = { submissionId: item.submissionId, kind: "peer_conflict" as const };
    const peers: Array<{ submissionId: string; taskId: string; files: string[] }> = [];
    let reason: string | null = null;
    for (const peer of items) {
      const result = pairs.get(pairKey(item, peer));
      if (!result) continue;
      if ("reason" in result) reason = reason === "ANALYSIS_BUDGET_EXCEEDED" ? reason : result.reason;
      else if (result.files.length) peers.push({ submissionId: peer.submissionId, taskId: peer.taskId, files: result.files.slice(0, MAX_PEER_FILES) });
    }
    if (peers.length) return { ...base, status: "attention", details: { peers } };
    return reason ? { ...base, ...unknown(reason) } : { ...base, status: "ok", details: { peers } };
  }

  /** Latest, current submissions of open tasks, most recent first. */
  private inFlight(access: CollaborationAccess): InFlight[] {
    const open = new Map(this.tasks.list(access).filter(task => IN_FLIGHT_STATUSES.has(task.status)).map(task => [task.id, task]));
    const rows = this.db.prepare(
      `SELECT id,work_item_id AS taskId,commit_sha AS commitSha,task_semantic_revision AS revision FROM hub_task_submissions
       WHERE user_id=? AND project_id=? ORDER BY created_at DESC,rowid DESC`
    ).all(access.userId, access.projectId) as Array<{ id: string; taskId: string; commitSha: string; revision: number }>;
    const seen = new Set<string>();
    const flight: InFlight[] = [];
    for (const row of rows) {
      if (seen.has(row.taskId)) continue;
      seen.add(row.taskId);
      if (open.get(row.taskId)?.semanticRevision !== row.revision) continue;
      flight.push({ submissionId: row.id, taskId: row.taskId, commitSha: row.commitSha });
      if (flight.length >= MAX_IN_FLIGHT) break;
    }
    return flight;
  }

  private store(access: CollaborationAccess, results: CheckResult[]): void {
    const now = Date.now();
    const upsert = this.db.prepare(
      `INSERT INTO hub_submission_checks(submission_id,user_id,project_id,kind,status,details_json,checked_at) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(submission_id,kind) DO UPDATE SET status=excluded.status,details_json=excluded.details_json,checked_at=excluded.checked_at`
    );
    this.db.transaction(() => {
      const keep = new Set(results.map(result => `${result.submissionId}:${result.kind}`));
      const existing = this.db.prepare(
        `SELECT submission_id AS submissionId,kind FROM hub_submission_checks WHERE user_id=? AND project_id=? AND kind IN ('base_conflict','peer_conflict','scope')`
      ).all(access.userId, access.projectId) as Array<{ submissionId: string; kind: MirrorKind }>;
      const remove = this.db.prepare("DELETE FROM hub_submission_checks WHERE submission_id=? AND kind=?");
      for (const row of existing) if (!keep.has(`${row.submissionId}:${row.kind}`)) remove.run(row.submissionId, row.kind);
      for (const result of results) {
        upsert.run(result.submissionId, access.userId, access.projectId, result.kind, result.status, JSON.stringify(result.details), now);
      }
    })();
  }

  private recordSync(access: CollaborationAccess, fetchedAt: number | null, error: string | null): void {
    this.db.prepare(
      `INSERT INTO hub_project_sync(project_id,user_id,mirror_fetched_at,mirror_error) VALUES(?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET mirror_fetched_at=COALESCE(excluded.mirror_fetched_at,hub_project_sync.mirror_fetched_at),mirror_error=excluded.mirror_error`
    ).run(access.projectId, access.userId, fetchedAt, error);
  }

  private taskModules(access: CollaborationAccess): Record<string, string> {
    const rows = this.db.prepare("SELECT work_item_id AS taskId,pattern FROM hub_task_modules WHERE user_id=? AND project_id=?")
      .all(access.userId, access.projectId) as Array<{ taskId: string; pattern: string }>;
    return Object.fromEntries(rows.map(row => [row.taskId, row.pattern]));
  }

  private async view(access: CollaborationAccess): Promise<HubInsightsView> {
    return {
      modules: await this.modules(access),
      taskModules: this.taskModules(access),
      checks: this.checks(access),
      sync: this.sync(access),
      remote: { tokenConfigured: Boolean(this.db.prepare("SELECT 1 FROM hub_remote_credentials WHERE user_id=? AND project_id=?").get(access.userId, access.projectId)) }
    };
  }

  private checks(access: CollaborationAccess): HubCheck[] {
    const rows = this.db.prepare(
      `SELECT c.submission_id AS submissionId,s.work_item_id AS taskId,c.kind,c.status,c.details_json AS details,c.checked_at AS checkedAt
       FROM hub_submission_checks c JOIN hub_task_submissions s ON s.id=c.submission_id
       WHERE c.user_id=? AND c.project_id=?
         AND s.id=(SELECT l.id FROM hub_task_submissions l WHERE l.user_id=s.user_id AND l.project_id=s.project_id AND l.work_item_id=s.work_item_id
                   ORDER BY l.created_at DESC,l.rowid DESC LIMIT 1)
       ORDER BY c.checked_at DESC,c.rowid DESC LIMIT 500`
    ).all(access.userId, access.projectId) as Array<Omit<HubCheck, "details"> & { details: string }>;
    return rows.map(row => ({ ...row, details: parseDetails(row.details) }));
  }

  private sync(access: CollaborationAccess): HubInsightsView["sync"] {
    const row = this.db.prepare(
      `SELECT mirror_fetched_at AS mirrorFetchedAt,mirror_error AS mirrorError,remote_polled_at AS remotePolledAt,remote_error AS remoteError
       FROM hub_project_sync WHERE user_id=? AND project_id=?`
    ).get(access.userId, access.projectId) as HubInsightsView["sync"] | undefined;
    return row ?? { mirrorFetchedAt: null, mirrorError: null, remotePolledAt: null, remoteError: null };
  }
}

function parseDetails(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
