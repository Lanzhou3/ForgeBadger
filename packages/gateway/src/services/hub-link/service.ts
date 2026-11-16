import { randomUUID } from "node:crypto";

import { z } from "zod";

import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../crypto/secret-box.js";
import { HUB_NODE_TOKEN_PREFIX } from "../../db/repositories/hub-node-token-repository.js";
import { ProjectManagerRepository } from "../../db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import type { Database } from "../../db/types.js";
import type { ChecksStatus, HubSettings, HubTask } from "../hub/coordination.js";
import { HubClient, HubLinkError, normalizeHubUrl, type HubClientIO } from "./client.js";
import { readLocalGitState, type LocalGitReader, type LocalGitState } from "./local-git.js";

export interface HubLink {
  id: string;
  hubUrl: string;
  hubProjectId: string;
  hubProjectName: string;
  hubActorId: string;
  localProjectId: string;
  lastSyncedAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface HubLinkTask extends HubTask {
  mine: boolean;
  localWorkItemId: string | null;
  suggestedBranch: string;
}

export interface HubLinkIO extends HubClientIO {
  readGit?: LocalGitReader;
}

interface LinkRow extends HubLink { tokenEncrypted: string }

// The hub is another machine: everything it returns is validated and bounded
// before it is cached or turned into a local work item. Unknown fields are
// dropped by zod's default object parsing.
const uuid = z.string().uuid();
const submissionReply = z.object({
  id: uuid,
  taskId: uuid,
  actorId: uuid,
  branch: z.string().max(200),
  commitSha: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i),
  prUrl: z.string().max(2048).nullable(),
  checksStatus: z.enum(["passed", "failed", "not_run"]),
  checksSummary: z.string().max(2000),
  taskSemanticRevision: z.number().int(),
  createdAt: z.number(),
  current: z.boolean(),
  confirmation: z.object({
    id: uuid,
    submissionId: uuid,
    actorId: uuid,
    actorKind: z.enum(["human", "copilot", "system"]),
    effect: z.enum(["binding", "advisory"]),
    decision: z.enum(["accepted", "changes_requested"]),
    note: z.string().max(5000),
    commitSha: z.string().max(64),
    createdAt: z.number()
  }).nullable()
});
const taskReply = z.object({
  id: uuid,
  title: z.string().min(1).max(256),
  description: z.string().max(20_000).nullable(),
  status: z.enum(["todo", "in_progress", "blocked", "ready_for_review", "done", "cancelled"]),
  acceptanceCriteria: z.array(z.string().max(1000)).max(50),
  revision: z.number().int().min(1),
  semanticRevision: z.number().int().min(1),
  assigneeId: uuid.nullable(),
  reviewerId: uuid.nullable(),
  latestSubmission: submissionReply.nullable()
});
const selfReply = z.object({ userId: uuid, projectId: uuid });
const projectReply = z.object({
  project: z.object({ id: uuid, name: z.string().max(500) }),
  actorId: uuid,
  settings: z.object({
    provider: z.enum(["github", "gitee"]).nullable(),
    remoteUrl: z.string().max(512).nullable(),
    defaultBranch: z.string().max(200).nullable(),
    confirmationPolicy: z.string().max(64),
    revision: z.number().int()
  })
});
const tasksReply = z.object({ tasks: z.array(taskReply).max(2000) });
type HubProjectReply = z.infer<typeof projectReply>;

function parseReply<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HubLinkError(502, "HUB_RESPONSE_INVALID");
  return parsed.data;
}

const LINK_COLUMNS = `id,hub_url AS hubUrl,hub_project_id AS hubProjectId,hub_project_name AS hubProjectName,hub_actor_id AS hubActorId,
  local_project_id AS localProjectId,last_synced_at AS lastSyncedAt,last_error AS lastError,created_at AS createdAt,token_encrypted AS tokenEncrypted`;

/** `fb/<short id>-<ascii slug>`; titles without ASCII words fall back to the id alone. */
export function suggestedBranch(task: { id: string; title: string }): string {
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `fb/${task.id.slice(0, 8)}${slug ? `-${slug}` : ""}`;
}

/**
 * A member's own instance acting as a node of the team hub. The hub owns the
 * task content and state; this service only caches it for display, relays the
 * member's explicit actions and reads the local clone to describe what was
 * pushed. Nothing here writes to the working tree or runs project code.
 */
export class HubLinkService {
  private readonly readGit: LocalGitReader;

  constructor(private readonly db: Database, private readonly userId: string, private readonly masterKey: string, private readonly io: HubLinkIO = {}) {
    this.readGit = io.readGit ?? readLocalGitState;
  }

  list(): HubLink[] {
    const rows = this.db.prepare(`SELECT ${LINK_COLUMNS} FROM hub_links WHERE user_id=? ORDER BY created_at,id`).all(this.userId) as LinkRow[];
    return rows.map(toLink);
  }

  async connect(input: { hubUrl: string; token: string; localProjectId: string }): Promise<HubLink> {
    const hubUrl = normalizeHubUrl(input.hubUrl);
    const token = input.token.trim();
    if (!token.startsWith(HUB_NODE_TOKEN_PREFIX) || /\s/.test(token) || token.length > 256) throw new HubLinkError(400, "HUB_TOKEN_INVALID");
    if (!new ProjectRepository(this.db, this.userId).getById(input.localProjectId)) throw new HubLinkError(404, "LOCAL_PROJECT_NOT_FOUND");
    if (this.db.prepare("SELECT 1 FROM hub_links WHERE user_id=? AND local_project_id=?").get(this.userId, input.localProjectId)) {
      throw new HubLinkError(409, "LOCAL_PROJECT_ALREADY_LINKED");
    }
    const client = new HubClient(hubUrl, token, this.io);
    const self = parseReply(selfReply, await client.get("/self"));
    const remote = parseReply(projectReply, await client.get(`/projects/${encodeURIComponent(self.projectId)}`));
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO hub_links(id,user_id,hub_url,hub_project_id,hub_project_name,hub_actor_id,token_encrypted,local_project_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    ).run(id, this.userId, hubUrl, self.projectId, String(remote.project.name).slice(0, 200), self.userId,
      JSON.stringify(encryptSecret(token, { key: this.masterKey })), input.localProjectId, Date.now());
    await this.sync(id);
    return toLink(this.row(id));
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM hub_links WHERE user_id=? AND id=?").run(this.userId, id).changes > 0;
  }

  /** Refreshes the cached task list from the hub and records the outcome on the link. */
  async sync(id: string): Promise<{ link: HubLink; settings: HubSettings; tasks: HubLinkTask[] }> {
    const link = this.row(id);
    try {
      const client = this.client(link);
      const remote = parseReply(projectReply, await client.get(`/projects/${encodeURIComponent(link.hubProjectId)}`));
      const { tasks } = parseReply(tasksReply, await client.get(`/projects/${encodeURIComponent(link.hubProjectId)}/tasks?assignee=all`));
      this.store(link, remote, tasks);
      return { link: toLink(this.row(id)), settings: remote.settings, tasks: this.tasks(id) };
    } catch (error) {
      const code = error instanceof HubLinkError ? error.code : "HUB_SYNC_FAILED";
      this.db.prepare("UPDATE hub_links SET last_error=? WHERE user_id=? AND id=?").run(code, this.userId, id);
      throw error instanceof HubLinkError ? error : new HubLinkError(502, code);
    }
  }

  /** The cached view; call `sync` first when freshness matters. */
  tasks(id: string): HubLinkTask[] {
    const link = this.row(id);
    const rows = this.db.prepare(
      "SELECT snapshot_json AS snapshot,local_work_item_id AS localWorkItemId FROM hub_link_tasks WHERE user_id=? AND link_id=? ORDER BY hub_task_id"
    ).all(this.userId, id) as Array<{ snapshot: string; localWorkItemId: string | null }>;
    return rows.map(row => {
      const task = JSON.parse(row.snapshot) as HubTask;
      return { ...task, mine: task.assigneeId === link.hubActorId, localWorkItemId: row.localWorkItemId, suggestedBranch: suggestedBranch(task) };
    });
  }

  async claim(id: string, taskId: string): Promise<HubLinkTask> {
    return this.relay(id, taskId, (client, path, task) => client.send("POST", `${path}/claim`, { expectedRevision: task.revision }));
  }

  async setStatus(id: string, taskId: string, status: "in_progress" | "blocked"): Promise<HubLinkTask> {
    return this.relay(id, taskId, (client, path, task) => client.send("PATCH", `${path}/status`, { expectedRevision: task.revision, status }));
  }

  async gitState(id: string): Promise<LocalGitState> {
    const link = this.row(id);
    const project = new ProjectRepository(this.db, this.userId).getById(link.localProjectId);
    if (!project) throw new HubLinkError(404, "LOCAL_PROJECT_NOT_FOUND");
    try {
      return await this.readGit(project.path);
    } catch {
      throw new HubLinkError(409, "LOCAL_REPOSITORY_UNAVAILABLE");
    }
  }

  /**
   * Reports the current branch of the local clone to the hub. The branch and
   * commit always come from the checkout, never from request input, and only
   * a clean, pushed, non-default branch is accepted so reviewers can fetch
   * exactly what was submitted.
   */
  async submit(id: string, taskId: string, input: { prUrl?: string | null | undefined; checksStatus: ChecksStatus; checksSummary?: string | undefined }): Promise<HubLinkTask> {
    const git = await this.gitState(id);
    if (!git.branch) throw new HubLinkError(409, "LOCAL_HEAD_DETACHED");
    if (git.dirty) throw new HubLinkError(409, "LOCAL_CHANGES_UNCOMMITTED");
    if (!git.pushed) throw new HubLinkError(409, "LOCAL_BRANCH_NOT_PUSHED");
    const { settings } = await this.sync(id);
    if (settings.defaultBranch && settings.defaultBranch === git.branch) throw new HubLinkError(409, "SUBMIT_FROM_DEFAULT_BRANCH");
    return this.relay(id, taskId, (client, path, task) => client.send("POST", `${path}/submissions`, {
      expectedRevision: task.revision,
      branch: git.branch,
      commitSha: git.commit,
      prUrl: input.prUrl ?? null,
      checksStatus: input.checksStatus,
      checksSummary: input.checksSummary ?? ""
    }), false);
  }

  /** Creates (once) a private local work item mirroring the hub task so existing local CLI flows can run it. */
  createLocalTask(id: string, taskId: string): { workItemId: string; suggestedBranch: string } {
    const link = this.row(id);
    const task = this.tasks(id).find(item => item.id === taskId);
    if (!task) throw new HubLinkError(404, "HUB_TASK_NOT_FOUND");
    const repository = new ProjectManagerRepository(this.db, this.userId);
    if (task.localWorkItemId && repository.getWorkItem(link.localProjectId, task.localWorkItemId)) {
      return { workItemId: task.localWorkItemId, suggestedBranch: task.suggestedBranch };
    }
    return this.db.transaction(() => {
      const note = `Team task ${task.id} from ${link.hubProjectName}. Work on branch ${task.suggestedBranch}, push it, then submit it from Team tasks.`;
      const item = repository.createWorkItem(link.localProjectId, {
        title: task.title,
        description: [task.description ?? "", note].filter(Boolean).join("\n\n"),
        acceptanceCriteria: task.acceptanceCriteria,
        details: { hub: { linkId: link.id, taskId: task.id } }
      });
      this.db.prepare("UPDATE hub_link_tasks SET local_work_item_id=? WHERE user_id=? AND link_id=? AND hub_task_id=?").run(item.id, this.userId, id, taskId);
      return { workItemId: item.id, suggestedBranch: task.suggestedBranch };
    })();
  }

  /** Sync, act on the freshly cached revision, then sync again so the cache shows the result. */
  private async relay(id: string, taskId: string, action: (client: HubClient, taskPath: string, task: HubLinkTask) => Promise<unknown>, refreshFirst = true): Promise<HubLinkTask> {
    const link = this.row(id);
    const before = (refreshFirst ? (await this.sync(id)).tasks : this.tasks(id)).find(item => item.id === taskId);
    if (!before) throw new HubLinkError(404, "HUB_TASK_NOT_FOUND");
    await action(this.client(link), `/projects/${encodeURIComponent(link.hubProjectId)}/tasks/${encodeURIComponent(taskId)}`, before);
    const after = (await this.sync(id)).tasks.find(item => item.id === taskId);
    if (!after) throw new HubLinkError(404, "HUB_TASK_NOT_FOUND");
    return after;
  }

  private store(link: LinkRow, remote: HubProjectReply, tasks: HubTask[]): void {
    const now = Date.now();
    this.db.transaction(() => {
      const upsert = this.db.prepare(
        `INSERT INTO hub_link_tasks(link_id,user_id,hub_task_id,snapshot_json,synced_at) VALUES(?,?,?,?,?)
         ON CONFLICT(link_id,hub_task_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,synced_at=excluded.synced_at`
      );
      for (const task of tasks) upsert.run(link.id, this.userId, task.id, JSON.stringify(task), now);
      // Tasks the hub no longer returns (deleted or access changed) leave the cache.
      this.db.prepare("DELETE FROM hub_link_tasks WHERE user_id=? AND link_id=? AND synced_at<?").run(this.userId, link.id, now);
      this.db.prepare("UPDATE hub_links SET hub_project_name=?,last_synced_at=?,last_error=NULL WHERE user_id=? AND id=?")
        .run(String(remote.project.name).slice(0, 200), now, this.userId, link.id);
    })();
  }

  private client(link: LinkRow): HubClient {
    let token: string;
    try {
      token = decryptSecret(JSON.parse(link.tokenEncrypted) as EncryptedSecret, { key: this.masterKey });
    } catch {
      throw new HubLinkError(409, "HUB_TOKEN_UNREADABLE");
    }
    return new HubClient(link.hubUrl, token, this.io);
  }

  private row(id: string): LinkRow {
    const row = this.db.prepare(`SELECT ${LINK_COLUMNS} FROM hub_links WHERE user_id=? AND id=?`).get(this.userId, id) as LinkRow | undefined;
    if (!row) throw new HubLinkError(404, "HUB_LINK_NOT_FOUND");
    return row;
  }
}

function toLink(row: LinkRow): HubLink {
  const { tokenEncrypted: _token, ...link } = row;
  return link;
}
