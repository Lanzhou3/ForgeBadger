import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";

import { signJwt } from "../src/auth/jwt.js";
import { CollaborationRepository } from "../src/db/repositories/collaboration-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { TeamRepository } from "../src/db/repositories/team-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createHubConsoleRoutes, createHubNodeRoutes } from "../src/routes/hub.js";
import { DeliveryService } from "../src/services/collaboration/delivery-service.js";
import { CollaborationTasks } from "../src/services/collaboration/tasks.js";
import { CollaborationError } from "../src/services/collaboration/types.js";
import { HubCoordination } from "../src/services/hub/coordination.js";
import { TeamInvitations } from "../src/services/teams/invitations.js";
import { TeamService } from "../src/services/teams/service.js";

interface Reply { status: number; body: { code: number; message: string; data: Record<string, any> } }

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

async function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-hub-")));
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  const users = new UserRepository(db);
  const owner = users.create("owner@hub.test", "hash");
  const dev = users.create("dev@hub.test", "hash");
  const reviewer = users.create("reviewer@hub.test", "hash");
  const outsider = users.create("outsider@hub.test", "hash");

  const team = new TeamRepository(db, owner.id).create("Hub Team");
  const invitations = new TeamInvitations(db);
  for (const member of [dev, reviewer]) {
    invitations.accept(member.id, invitations.issue(owner.id, team.id, member.email, "member").token);
  }
  const project = new ProjectRepository(db, owner.id).create({ name: "Shared", path: root, aiTool: "claude" });
  const delivery = new DeliveryService({ db, workspacesRoot: path.join(root, "workspaces") });
  await new TeamService(delivery).enroll(owner.id, team.id, project.id, 0, new TeamRepository(db, owner.id).access(team.id).team.revision);
  const authority = new CollaborationRepository(db, owner.id);
  authority.putMember(project.id, dev.email, "developer");
  authority.putMember(project.id, reviewer.email, "reviewer");
  const otherProject = new ProjectRepository(db, outsider.id).create({ name: "Private", path: realpathSync(mkdtempSync(path.join(tmpdir(), "fb-hub-other-"))), aiTool: "claude" });

  const secret = randomBytes(32).toString("hex");
  const app = express();
  app.locals.db = db;
  app.locals.jwtSecret = secret;
  app.use(express.json());
  app.use("/hub-console", createHubConsoleRoutes(db));
  app.use("/hub", createHubNodeRoutes(db));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  async function call(method: string, route: string, token: string | undefined, body?: unknown): Promise<Reply> {
    const response = await fetch(base + route, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let parsed: Reply["body"];
    try { parsed = JSON.parse(text) as Reply["body"]; } catch { parsed = { code: 1, message: "NON_JSON_RESPONSE", data: {} }; }
    return { status: response.status, body: parsed };
  }
  const session = (user: { id: string; email: string }) => signJwt({ userId: user.id, email: user.email }, secret);
  const createTask = (input: { assigneeId?: string | null; reviewerId?: string | null } = {}) =>
    new CollaborationTasks(db, owner.id).create(project.id, { title: "Build module", acceptanceCriteria: ["works"], ...input });
  async function nodeToken(user: { id: string; email: string }, expiresInDays = 30): Promise<string> {
    const reply = await call("POST", "/hub-console/tokens", session(user), { projectId: project.id, name: "laptop", expiresInDays });
    assert.equal(reply.status, 201);
    return reply.body.data.token as string;
  }
  const tasksUrl = `/projects/${project.id}/tasks`;
  const submission = (expectedRevision: number, commitSha = COMMIT_A) =>
    ({ expectedRevision, branch: "fb/task-1-module", commitSha, prUrl: "https://github.com/acme/repo/pull/1", checksStatus: "passed", checksSummary: "42 passed" });

  return {
    db, root, users, owner, dev, reviewer, outsider, project, otherProject, delivery, call, session, createTask, nodeToken, tasksUrl, submission,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(otherProject.path, { recursive: true, force: true });
    }
  };
}

test("node claims and submits, a human reviewer confirms in the console", async () => {
  const f = await fixture();
  try {
    const task = f.createTask({ reviewerId: f.reviewer.id });
    const token = await f.nodeToken(f.dev);

    const project = await f.call("GET", `/hub/projects/${f.project.id}`, token);
    assert.equal(project.status, 200);
    assert.deepEqual(project.body.data.project.capabilities, ["read", "comment", "develop"]);
    assert.equal(project.body.data.settings.confirmationPolicy, "human_only");
    assert.ok(!JSON.stringify(project.body).includes(f.root), "node responses must not expose the hub filesystem path");

    assert.deepEqual((await f.call("GET", `/hub${f.tasksUrl}`, token)).body.data.tasks, []);
    const all = await f.call("GET", `/hub${f.tasksUrl}?assignee=all`, token);
    assert.equal(all.body.data.tasks.length, 1);

    const claimed = await f.call("POST", `/hub${f.tasksUrl}/${task.id}/claim`, token, { expectedRevision: task.revision });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.data.task.assigneeId, f.dev.id);
    assert.equal(claimed.body.data.task.status, "in_progress");

    const submitted = await f.call("POST", `/hub${f.tasksUrl}/${task.id}/submissions`, token, f.submission(claimed.body.data.task.revision));
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.data.task.status, "ready_for_review");
    assert.equal(submitted.body.data.task.latestSubmission.current, true);
    const submissionId = submitted.body.data.submission.id as string;
    const revision = submitted.body.data.task.revision as number;
    const confirmation = { expectedRevision: revision, submissionId, decision: "accepted", note: "meets the criteria" };

    // The node credential cannot act as the human reviewer.
    assert.equal((await f.call("POST", `/hub${f.tasksUrl}/${task.id}/confirmations`, token, confirmation)).status, 404);
    const selfReview = await f.call("POST", `/hub-console${f.tasksUrl}/${task.id}/confirmations`, f.session(f.dev), confirmation);
    assert.equal(selfReview.status, 403);

    const confirmed = await f.call("POST", `/hub-console${f.tasksUrl}/${task.id}/confirmations`, f.session(f.reviewer), confirmation);
    assert.equal(confirmed.status, 201);
    assert.equal(confirmed.body.data.task.status, "done");
    assert.deepEqual(
      { kind: confirmed.body.data.confirmation.actorKind, effect: confirmed.body.data.confirmation.effect, commit: confirmed.body.data.confirmation.commitSha },
      { kind: "human", effect: "binding", commit: COMMIT_A }
    );
    const again = await f.call("POST", `/hub-console${f.tasksUrl}/${task.id}/confirmations`, f.session(f.reviewer), confirmation);
    assert.equal(again.body.message, "TASK_ALREADY_FINISHED");

    const detail = await f.call("GET", `/hub${f.tasksUrl}/${task.id}`, token);
    assert.equal(detail.body.data.submissions[0].confirmations.length, 1);
    assert.deepEqual(f.db.pragma("foreign_key_check"), []);
  } finally { await f.close(); }
});

test("node tokens are pinned to one project and one router", async () => {
  const f = await fixture();
  try {
    const token = await f.nodeToken(f.dev);
    assert.match(token, /^fbnode_[a-f0-9]{64}$/);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM hub_node_tokens WHERE token_hash=?").get(token) as { n: number }).n, 0, "only the hash is stored");

    assert.equal((await f.call("GET", `/hub/projects/${f.otherProject.id}`, token)).status, 404);
    assert.equal((await f.call("GET", "/hub-console/tokens", token)).status, 401);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, f.session(f.dev))).status, 401);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, undefined)).status, 401);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, "fbnode_" + "0".repeat(64))).status, 401);

    const outsider = await f.call("POST", "/hub-console/tokens", f.session(f.outsider), { projectId: f.project.id, name: "x" });
    assert.equal(outsider.status, 404);

    const listed = await f.call("GET", "/hub-console/tokens", f.session(f.dev));
    assert.equal(listed.body.data.tokens.length, 1);
    assert.ok(!JSON.stringify(listed.body).includes(token));
    assert.equal((await f.call("GET", "/hub-console/tokens", f.session(f.reviewer))).body.data.tokens.length, 0);
    const tokenId = listed.body.data.tokens[0].id as string;
    assert.equal((await f.call("DELETE", `/hub-console/tokens/${tokenId}`, f.session(f.reviewer))).body.data.revoked, false);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, token)).status, 200);
    assert.equal((await f.call("DELETE", `/hub-console/tokens/${tokenId}`, f.session(f.dev))).body.data.revoked, true);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, token)).status, 401);
  } finally { await f.close(); }
});

test("expiry, membership revocation and account disablement cut a node off immediately", async () => {
  const f = await fixture();
  try {
    const expired = await f.nodeToken(f.dev);
    f.db.prepare("UPDATE hub_node_tokens SET expires_at=?").run(Date.now() - 1);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, expired)).status, 401);

    const devToken = await f.nodeToken(f.dev);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, devToken)).status, 200);
    await f.delivery.revoke(f.owner.id, f.project.id, f.dev.id);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, devToken)).status, 404);

    const reviewerToken = await f.nodeToken(f.reviewer);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, reviewerToken)).status, 200);
    f.users.update(f.reviewer.id, { status: "disabled" });
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, reviewerToken)).status, 404);
  } finally { await f.close(); }
});

test("assignment, revision and input rules are enforced for nodes", async () => {
  const f = await fixture();
  try {
    const devToken = await f.nodeToken(f.dev);
    const reviewerToken = await f.nodeToken(f.reviewer);
    const ownerToken = await f.nodeToken(f.owner);
    const task = f.createTask();
    const url = `/hub${f.tasksUrl}/${task.id}`;

    assert.equal((await f.call("POST", `${url}/claim`, reviewerToken, { expectedRevision: task.revision })).status, 403, "reviewers cannot develop");
    assert.equal((await f.call("POST", `${url}/claim`, devToken, { expectedRevision: task.revision + 7 })).body.message, "STALE_TASK_REVISION");
    assert.equal((await f.call("POST", `${url}/submissions`, devToken, f.submission(task.revision))).body.message, "TASK_ASSIGNEE_REQUIRED");

    const claimed = await f.call("POST", `${url}/claim`, devToken, { expectedRevision: task.revision });
    const revision = claimed.body.data.task.revision as number;
    assert.equal((await f.call("POST", `${url}/claim`, ownerToken, { expectedRevision: revision })).body.message, "TASK_ASSIGNED_TO_ANOTHER_MEMBER");
    assert.equal((await f.call("PATCH", `${url}/status`, ownerToken, { expectedRevision: revision, status: "blocked" })).body.message, "TASK_ASSIGNEE_REQUIRED");
    assert.equal((await f.call("PATCH", `${url}/status`, devToken, { expectedRevision: revision, status: "done" })).status, 400, "nodes cannot complete a task");

    for (const bad of [
      { ...f.submission(revision), branch: "fb/../main" },
      { ...f.submission(revision), commitSha: "abc" },
      { ...f.submission(revision), prUrl: "http://github.com/acme/repo/pull/1" },
      { ...f.submission(revision), prUrl: "https://user:secret@github.com/acme/repo/pull/1" },
      { ...f.submission(revision), extra: true }
    ]) {
      assert.equal((await f.call("POST", `${url}/submissions`, devToken, bad)).body.message, "INVALID_INPUT");
    }

    const blocked = await f.call("PATCH", `${url}/status`, devToken, { expectedRevision: revision, status: "blocked" });
    assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
    assert.equal(blocked.body.data.task.status, "blocked");
    const submitted = await f.call("POST", `${url}/submissions`, devToken, f.submission(blocked.body.data.task.revision));
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    assert.equal(submitted.body.data.task.status, "ready_for_review");
    assert.equal((await f.call("POST", `${url}/comments`, devToken, { text: "ready" })).status, 201);
    assert.equal((await f.call("GET", url, reviewerToken)).body.data.comments.length, 1);
  } finally { await f.close(); }
});

test("changes requested reopens the task and only the latest current submission can be confirmed", async () => {
  const f = await fixture();
  try {
    const dev = new HubCoordination(f.db, f.dev.id);
    const reviewer = new HubCoordination(f.db, f.reviewer.id);
    const created = f.createTask();
    let task = dev.claim(f.project.id, created.id, created.revision);
    const first = dev.submit(f.project.id, task.id, f.submission(task.revision) as never);
    const rejected = reviewer.confirm(f.project.id, task.id, { expectedRevision: first.task.revision, submissionId: first.submission.id, decision: "changes_requested", note: "add tests" }, "human");
    assert.equal(rejected.task.status, "in_progress");

    const second = dev.submit(f.project.id, task.id, f.submission(rejected.task.revision, COMMIT_B) as never);
    const confirm = (submissionId: string, expectedRevision: number) =>
      reviewer.confirm(f.project.id, task.id, { expectedRevision, submissionId, decision: "accepted", note: "ok" }, "human");
    assert.throws(() => confirm(first.submission.id, second.task.revision), (error: unknown) => error instanceof CollaborationError && error.code === "SUBMISSION_SUPERSEDED");

    // Changing the requirements invalidates what was submitted against them.
    const edited = new CollaborationTasks(f.db, f.owner.id).update(f.project.id, task.id, { expectedRevision: second.task.revision, acceptanceCriteria: ["works", "has tests"] });
    assert.throws(() => confirm(second.submission.id, edited.revision), (error: unknown) => error instanceof CollaborationError && error.code === "SUBMISSION_STALE");
    assert.equal(dev.listTasks(f.project.id, "mine")[0]!.latestSubmission!.current, false);

    const third = dev.submit(f.project.id, task.id, f.submission(edited.revision, COMMIT_B) as never);
    task = confirm(third.submission.id, third.task.revision).task;
    assert.equal(task.status, "done");
    assert.throws(() => f.db.prepare("UPDATE hub_task_confirmations SET decision='changes_requested'").run(), /immutable/);
    assert.throws(() => f.db.prepare("UPDATE hub_task_submissions SET commit_sha='x'").run(), /immutable/);
  } finally { await f.close(); }
});

test("non-human reviewers are advisory under the human_only policy and nobody confirms their own work", async () => {
  const f = await fixture();
  try {
    const owner = new HubCoordination(f.db, f.owner.id);
    const reviewer = new HubCoordination(f.db, f.reviewer.id);
    const created = f.createTask();
    const task = owner.claim(f.project.id, created.id, created.revision);
    const { submission, task: submitted } = owner.submit(f.project.id, task.id, f.submission(task.revision) as never);
    const input = { expectedRevision: submitted.revision, submissionId: submission.id, decision: "accepted" as const, note: "looks right" };

    assert.throws(() => owner.confirm(f.project.id, task.id, input, "human"), (error: unknown) => error instanceof CollaborationError && error.code === "SELF_CONFIRMATION_DENIED");

    const advisory = reviewer.confirm(f.project.id, task.id, input, "copilot");
    assert.equal(advisory.confirmation.effect, "advisory");
    assert.equal(advisory.task.status, "ready_for_review", "an advisory record never moves the task");
    assert.equal(advisory.task.latestSubmission!.confirmation, null);

    const binding = reviewer.confirm(f.project.id, task.id, input, "human");
    assert.equal(binding.confirmation.effect, "binding");
    assert.equal(binding.task.status, "done");
    assert.equal(owner.task(f.project.id, task.id).submissions[0]!.confirmations.length, 2);
  } finally { await f.close(); }
});

test("an assigned reviewer is required unless the actor manages the project", async () => {
  const f = await fixture();
  try {
    const second = f.users.create("second-reviewer@hub.test", "hash");
    const invitations = new TeamInvitations(f.db);
    const teamId = (f.db.prepare("SELECT team_id AS id FROM team_projects WHERE project_id=?").get(f.project.id) as { id: string }).id;
    invitations.accept(second.id, invitations.issue(f.owner.id, teamId, second.email, "member").token);
    new CollaborationRepository(f.db, f.owner.id).putMember(f.project.id, second.email, "reviewer");

    const dev = new HubCoordination(f.db, f.dev.id);
    const created = f.createTask({ assigneeId: f.dev.id, reviewerId: f.reviewer.id });
    const { submission, task } = dev.submit(f.project.id, created.id, f.submission(created.revision) as never);
    const input = { expectedRevision: task.revision, submissionId: submission.id, decision: "accepted" as const, note: "ok" };
    assert.throws(() => new HubCoordination(f.db, second.id).confirm(f.project.id, task.id, input, "human"), (error: unknown) => error instanceof CollaborationError && error.code === "TASK_REVIEWER_REQUIRED");
    assert.equal(new HubCoordination(f.db, f.owner.id).confirm(f.project.id, task.id, input, "human").task.status, "done");
  } finally { await f.close(); }
});

test("only managers change hub settings and unsupported policies are refused", async () => {
  const f = await fixture();
  try {
    const url = `/hub-console/projects/${f.project.id}/settings`;
    const body = { expectedRevision: 0, provider: "gitee", remoteUrl: "git@gitee.com:acme/repo.git", defaultBranch: "main" };
    assert.equal((await f.call("PUT", url, f.session(f.dev), body)).status, 403);
    assert.equal((await f.call("PUT", url, f.session(f.owner), { ...body, confirmationPolicy: "copilot_only" })).body.message, "CONFIRMATION_POLICY_UNSUPPORTED");
    assert.equal((await f.call("PUT", url, f.session(f.owner), { ...body, remoteUrl: "https://token@gitee.com/acme/repo.git" })).status, 400);

    const saved = await f.call("PUT", url, f.session(f.owner), body);
    assert.deepEqual(saved.body.data.settings, { provider: "gitee", remoteUrl: body.remoteUrl, defaultBranch: "main", confirmationPolicy: "human_only", revision: 1 });
    assert.equal((await f.call("PUT", url, f.session(f.owner), body)).body.message, "STALE_HUB_SETTINGS_REVISION");
    assert.equal((await f.call("PUT", url, f.session(f.owner), { ...body, expectedRevision: 1, provider: "github", remoteUrl: "https://github.com/acme/repo.git" })).body.data.settings.revision, 2);

    const token = await f.nodeToken(f.dev);
    assert.equal((await f.call("GET", `/hub/projects/${f.project.id}`, token)).body.data.settings.provider, "github");
  } finally { await f.close(); }
});

test("a task with submissions cannot be deleted, so confirmation evidence survives", async () => {
  const f = await fixture();
  try {
    const dev = new HubCoordination(f.db, f.dev.id);
    const created = f.createTask({ assigneeId: f.dev.id });
    const { submission, task } = dev.submit(f.project.id, created.id, f.submission(created.revision) as never);
    new HubCoordination(f.db, f.reviewer.id).confirm(f.project.id, task.id, { expectedRevision: task.revision, submissionId: submission.id, decision: "accepted", note: "ok" }, "human");

    assert.throws(() => f.db.prepare("DELETE FROM project_manager_work_items WHERE id=?").run(created.id), /FOREIGN KEY/);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM hub_task_confirmations WHERE work_item_id=?").get(created.id) as { n: number }).n, 1);

    const untouched = f.createTask();
    f.db.prepare("DELETE FROM collaboration_tasks WHERE work_item_id=?").run(untouched.id);
    f.db.prepare("DELETE FROM project_manager_work_items WHERE id=?").run(untouched.id);
  } finally { await f.close(); }
});

test("changing the provider or repository discards the stored Git host token", async () => {
  const f = await fixture();
  try {
    const owner = new HubCoordination(f.db, f.owner.id);
    const base = { provider: "github" as const, remoteUrl: "https://github.com/acme/repo.git", defaultBranch: "main" };
    owner.putSettings(f.project.id, { expectedRevision: 0, ...base });
    const storeToken = () => f.db.prepare("INSERT OR REPLACE INTO hub_remote_credentials(project_id,user_id,token_encrypted,updated_by,updated_at) VALUES(?,?,?,?,?)")
      .run(f.project.id, f.owner.id, "{}", f.owner.id, Date.now());
    const stored = () => (f.db.prepare("SELECT COUNT(*) AS n FROM hub_remote_credentials WHERE project_id=?").get(f.project.id) as { n: number }).n;

    storeToken();
    owner.putSettings(f.project.id, { expectedRevision: 1, ...base, defaultBranch: "develop" });
    assert.equal(stored(), 1, "an unrelated settings change keeps the token");

    owner.putSettings(f.project.id, { expectedRevision: 2, ...base, provider: "gitee", remoteUrl: "https://gitee.com/acme/repo.git" });
    assert.equal(stored(), 0, "a provider change discards it");

    storeToken();
    owner.putSettings(f.project.id, { expectedRevision: 3, provider: "gitee", remoteUrl: "https://gitee.com/other/repo.git", defaultBranch: "main" });
    assert.equal(stored(), 0, "a repository change discards it");
  } finally { await f.close(); }
});
