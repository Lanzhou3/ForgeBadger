import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
import { HubNodeTokenRepository } from "../src/db/repositories/hub-node-token-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { TeamRepository } from "../src/db/repositories/team-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createHubNodeRoutes } from "../src/routes/hub.js";
import { createHubLinkRoutes } from "../src/routes/hub-links.js";
import { DeliveryService } from "../src/services/collaboration/delivery-service.js";
import { CollaborationTasks } from "../src/services/collaboration/tasks.js";
import { HubCoordination } from "../src/services/hub/coordination.js";
import { HubClient, HubLinkError, hubEndpointOptions, normalizeHubUrl } from "../src/services/hub-link/client.js";
import { readLocalGitState } from "../src/services/hub-link/local-git.js";
import { HubLinkService, suggestedBranch } from "../src/services/hub-link/service.js";
import { TeamInvitations } from "../src/services/teams/invitations.js";
import { TeamService } from "../src/services/teams/service.js";

const MIGRATIONS = fileURLToPath(new URL("../src/db/migrations", import.meta.url));
const MASTER_KEY = randomBytes(32).toString("hex");

function newDb() {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: MIGRATIONS });
  return db;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Node", "-c", "user.email=node@hub.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
}

/** A clone with a pushed `main` and a bare remote next to it. */
function newClone(): { clone: string; cleanup: () => void } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-hub-node-")));
  const remote = path.join(root, "remote.git");
  const clone = path.join(root, "clone");
  execFileSync("git", ["init", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-b", "main", clone]);
  writeFileSync(path.join(clone, "README.md"), "hello\n");
  git(clone, "add", ".");
  git(clone, "commit", "-m", "init");
  git(clone, "remote", "add", "origin", remote);
  git(clone, "push", "-u", "origin", "main");
  return { clone, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const rejects = (code: string) => (error: unknown) => error instanceof HubLinkError && error.code === code;

async function fixture() {
  // ---- hub instance -------------------------------------------------------
  const hubRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-hub-mirror-")));
  const hubDb = newDb();
  const hubUsers = new UserRepository(hubDb);
  const owner = hubUsers.create("owner@hub.test", "hash");
  const dev = hubUsers.create("dev@hub.test", "hash");
  const team = new TeamRepository(hubDb, owner.id).create("Team");
  const invitations = new TeamInvitations(hubDb);
  invitations.accept(dev.id, invitations.issue(owner.id, team.id, dev.email, "member").token);
  const hubProject = new ProjectRepository(hubDb, owner.id).create({ name: "Shared", path: hubRoot, aiTool: "claude" });
  await new TeamService(new DeliveryService({ db: hubDb, workspacesRoot: path.join(hubRoot, "workspaces") }))
    .enroll(owner.id, team.id, hubProject.id, 0, new TeamRepository(hubDb, owner.id).access(team.id).team.revision);
  new CollaborationRepository(hubDb, owner.id).putMember(hubProject.id, dev.email, "developer");
  new HubCoordination(hubDb, owner.id).putSettings(hubProject.id, { expectedRevision: 0, provider: "github", remoteUrl: "https://github.com/acme/repo.git", defaultBranch: "main" });
  const hubTask = new CollaborationTasks(hubDb, owner.id).create(hubProject.id, { title: "Add export API", description: "Expose CSV export", acceptanceCriteria: ["returns csv"] });
  const hubTokens = new HubNodeTokenRepository(hubDb);
  const issued = hubTokens.create({ userId: dev.id, projectId: hubProject.id, name: "laptop", expiresAt: Date.now() + 86_400_000 });

  const hubApp = express();
  hubApp.locals.db = hubDb;
  hubApp.use(express.json());
  hubApp.use("/api/v1/hub", createHubNodeRoutes(hubDb));
  const hubServer = hubApp.listen(0, "127.0.0.1");
  await once(hubServer, "listening");
  const hubAddress = hubServer.address();
  assert.ok(hubAddress && typeof hubAddress !== "string");
  const hubUrl = `http://127.0.0.1:${hubAddress.port}`;

  // ---- node instance (the member's own machine) ---------------------------
  const nodeDb = newDb();
  const nodeUsers = new UserRepository(nodeDb);
  const me = nodeUsers.create("me@node.test", "hash", { role: "admin" });
  const stranger = nodeUsers.create("stranger@node.test", "hash", { role: "admin" });
  const plainMember = nodeUsers.create("member@node.test", "hash");
  const { clone, cleanup } = newClone();
  const localProject = new ProjectRepository(nodeDb, me.id).create({ name: "My clone", path: clone, aiTool: "claude" });
  const service = new HubLinkService(nodeDb, me.id, MASTER_KEY);

  return {
    hubDb, hubUrl, hubProject, hubTask, hubTokens, issued, owner, dev,
    nodeDb, me, stranger, plainMember, clone, localProject, service,
    close: async () => {
      hubServer.closeAllConnections();
      await new Promise<void>(resolve => hubServer.close(() => resolve()));
      hubDb.close();
      nodeDb.close();
      cleanup();
      rmSync(hubRoot, { recursive: true, force: true });
    }
  };
}

test("a node links its clone, claims a task and submits the pushed branch read from Git", async () => {
  const f = await fixture();
  try {
    const link = await f.service.connect({ hubUrl: `${f.hubUrl}/`, token: f.issued.token, localProjectId: f.localProject.id });
    assert.deepEqual(
      { url: link.hubUrl, project: link.hubProjectId, name: link.hubProjectName, actor: link.hubActorId, error: link.lastError },
      { url: f.hubUrl, project: f.hubProject.id, name: "Shared", actor: f.dev.id, error: null }
    );
    assert.ok(!JSON.stringify(link).includes(f.issued.token));
    const stored = (f.nodeDb.prepare("SELECT token_encrypted AS value FROM hub_links").get() as { value: string }).value;
    assert.ok(!stored.includes(f.issued.token), "the node token is stored encrypted");

    let [task] = f.service.tasks(link.id);
    assert.ok(task);
    assert.deepEqual({ title: task.title, mine: task.mine, status: task.status, branch: task.suggestedBranch },
      { title: "Add export API", mine: false, status: "todo", branch: `fb/${f.hubTask.id.slice(0, 8)}-add-export-api` });

    task = await f.service.claim(link.id, f.hubTask.id);
    assert.deepEqual({ mine: task.mine, status: task.status }, { mine: true, status: "in_progress" });

    const local = f.service.createLocalTask(link.id, f.hubTask.id);
    assert.deepEqual(f.service.createLocalTask(link.id, f.hubTask.id), local, "creating the local task is idempotent");
    const item = new ProjectManagerRepository(f.nodeDb, f.me.id).getWorkItem(f.localProject.id, local.workItemId)!;
    assert.equal(item.title, "Add export API");
    assert.deepEqual(item.acceptanceCriteria, ["returns csv"]);
    assert.match(item.description ?? "", new RegExp(local.suggestedBranch));
    assert.equal(f.service.tasks(link.id)[0]!.localWorkItemId, local.workItemId);

    const submit = () => f.service.submit(link.id, f.hubTask.id, { checksStatus: "passed", checksSummary: "12 passed", prUrl: "https://github.com/acme/repo/pull/7" });
    await assert.rejects(submit, rejects("SUBMIT_FROM_DEFAULT_BRANCH"));
    git(f.clone, "switch", "-c", local.suggestedBranch);
    writeFileSync(path.join(f.clone, "export.ts"), "export const csv = 1;\n");
    await assert.rejects(submit, rejects("LOCAL_CHANGES_UNCOMMITTED"));
    git(f.clone, "add", ".");
    git(f.clone, "commit", "-m", "export");
    await assert.rejects(submit, rejects("LOCAL_BRANCH_NOT_PUSHED"));
    git(f.clone, "push", "-u", "origin", local.suggestedBranch);

    const submitted = await submit();
    const head = git(f.clone, "rev-parse", "HEAD");
    assert.equal(submitted.status, "ready_for_review");
    assert.deepEqual(
      { branch: submitted.latestSubmission!.branch, commit: submitted.latestSubmission!.commitSha, pr: submitted.latestSubmission!.prUrl, actor: submitted.latestSubmission!.actorId },
      { branch: local.suggestedBranch, commit: head, pr: "https://github.com/acme/repo/pull/7", actor: f.dev.id }
    );
    // The hub recorded exactly what the node read from the clone.
    const onHub = new HubCoordination(f.hubDb, f.owner.id).task(f.hubProject.id, f.hubTask.id);
    assert.equal(onHub.submissions[0]!.commitSha, head);
    assert.equal(onHub.task.status, "ready_for_review");
  } finally { await f.close(); }
});

test("links are private to their owner and hub revocation is surfaced on the link", async () => {
  const f = await fixture();
  try {
    const input = { hubUrl: f.hubUrl, token: f.issued.token, localProjectId: f.localProject.id };
    const link = await f.service.connect(input);
    await assert.rejects(() => f.service.connect(input), rejects("LOCAL_PROJECT_ALREADY_LINKED"));

    const stranger = new HubLinkService(f.nodeDb, f.stranger.id, MASTER_KEY);
    assert.deepEqual(stranger.list(), []);
    assert.throws(() => stranger.tasks(link.id), rejects("HUB_LINK_NOT_FOUND"));
    await assert.rejects(() => stranger.sync(link.id), rejects("HUB_LINK_NOT_FOUND"));
    assert.equal(stranger.remove(link.id), false);
    await assert.rejects(() => stranger.connect(input), rejects("LOCAL_PROJECT_NOT_FOUND"));

    // A different master key cannot read the stored token.
    await assert.rejects(() => new HubLinkService(f.nodeDb, f.me.id, randomBytes(32).toString("hex")).sync(link.id), rejects("HUB_TOKEN_UNREADABLE"));

    f.hubTokens.revoke(f.dev.id, f.issued.record.id);
    await assert.rejects(() => f.service.sync(link.id), rejects("HUB_TOKEN_REJECTED"));
    assert.equal(f.service.list()[0]!.lastError, "HUB_TOKEN_REJECTED");
    assert.equal(f.service.tasks(link.id).length, 1, "the cached view survives a failed sync");

    assert.equal(f.service.remove(link.id), true);
    assert.equal((f.nodeDb.prepare("SELECT COUNT(*) AS n FROM hub_link_tasks").get() as { n: number }).n, 0);
  } finally { await f.close(); }
});

test("connect validates the token and the hub address before storing anything", async () => {
  const f = await fixture();
  try {
    const base = { hubUrl: f.hubUrl, token: f.issued.token, localProjectId: f.localProject.id };
    await assert.rejects(() => f.service.connect({ ...base, token: "not-a-node-token" }), rejects("HUB_TOKEN_INVALID"));
    await assert.rejects(() => f.service.connect({ ...base, token: "fbnode_" + "0".repeat(64) }), rejects("HUB_TOKEN_REJECTED"));
    await assert.rejects(() => f.service.connect({ ...base, hubUrl: "http://192.168.1.20:18332" }), rejects("HUB_URL_HTTPS_REQUIRED"));
    await assert.rejects(() => f.service.connect({ ...base, hubUrl: "http://127.0.0.1:1" }), rejects("HUB_UNREACHABLE"));
    assert.deepEqual(f.service.list(), []);
  } finally { await f.close(); }
});

test("hub address policy: HTTPS on the LAN, plain HTTP only for loopback, metadata never", async () => {
  assert.equal(normalizeHubUrl("https://forge.lan/"), "https://forge.lan");
  assert.equal(normalizeHubUrl(" https://192.168.1.20:8443 "), "https://192.168.1.20:8443");
  assert.equal(normalizeHubUrl("http://localhost:28332"), "http://localhost:28332");
  for (const bad of ["ftp://forge.lan", "https://user:pw@forge.lan", "https://forge.lan/api", "https://forge.lan/?x=1", "not a url"]) {
    assert.throws(() => normalizeHubUrl(bad), rejects("HUB_URL_INVALID"), bad);
  }
  assert.throws(() => normalizeHubUrl("http://forge.lan"), rejects("HUB_URL_HTTPS_REQUIRED"));
  assert.deepEqual(hubEndpointOptions(new URL("https://192.168.1.20")), { allowPrivateNetworks: true, allowPlaintextHttp: false });
  assert.deepEqual(hubEndpointOptions(new URL("http://127.0.0.1:28332")), { allowPrivateNetworks: true, allowPlaintextHttp: true });

  let called = false;
  const client = new HubClient("https://169.254.169.254", "fbnode_x", { fetch: (async () => { called = true; return new Response("{}"); }) as typeof fetch });
  await assert.rejects(() => client.get("/self"), rejects("HUB_URL_REJECTED"));
  assert.equal(called, false, "a rejected address is never contacted");
});

test("the hub client normalizes bad envelopes and unknown error codes", async () => {
  const reply = (status: number, body: string) => ({ fetch: (async () => new Response(body, { status })) as typeof fetch, validate: async () => {} });
  await assert.rejects(() => new HubClient("https://forge.lan", "t", reply(200, "<html>")).get("/self"), rejects("HUB_RESPONSE_INVALID"));
  await assert.rejects(() => new HubClient("https://forge.lan", "t", reply(409, JSON.stringify({ code: 1, message: "STALE_TASK_REVISION" }))).get("/self"), rejects("STALE_TASK_REVISION"));
  await assert.rejects(() => new HubClient("https://forge.lan", "t", reply(500, JSON.stringify({ code: 1, message: "stack trace: secret" }))).get("/self"), rejects("HUB_REQUEST_FAILED"));
  assert.deepEqual(await new HubClient("https://forge.lan", "t", reply(200, JSON.stringify({ code: 0, data: { ok: true } }))).get("/self"), { ok: true });
});

test("local Git inspection reports detached and non-repository states without running hooks", async () => {
  const { clone, cleanup } = newClone();
  const plain = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-hub-plain-")));
  try {
    const marker = path.join(clone, "hook-ran");
    writeFileSync(path.join(clone, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`, { mode: 0o755 });
    assert.deepEqual(await readLocalGitState(clone), { branch: "main", commit: git(clone, "rev-parse", "HEAD"), dirty: false, pushed: true });
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "checkout", "--detach"], { cwd: clone, stdio: "ignore" });
    assert.equal((await readLocalGitState(clone)).branch, null);
    await assert.rejects(() => readLocalGitState(plain), /LOCAL_REPOSITORY_UNAVAILABLE/);
    assert.throws(() => execFileSync("test", ["-e", marker]), "inspection must not create the hook marker");
  } finally { cleanup(); rmSync(plain, { recursive: true, force: true }); }
});

test("branch suggestions stay valid for non-ASCII titles", () => {
  assert.equal(suggestedBranch({ id: "12345678-aaaa", title: "修复 登录" }), "fb/12345678");
  assert.equal(suggestedBranch({ id: "12345678-aaaa", title: "  Fix: login / SSO!! " }), "fb/12345678-fix-login-sso");
});

test("hub-link HTTP routes enforce input and never return the token", async () => {
  const f = await fixture();
  const secret = randomBytes(32).toString("hex");
  const app = express();
  app.locals.db = f.nodeDb;
  app.locals.jwtSecret = secret;
  app.use(express.json());
  app.use("/hub-links", createHubLinkRoutes(f.nodeDb, MASTER_KEY));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = async (method: string, route: string, user: { id: string; email: string } | undefined, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method,
      headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, secret)}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as { code: number; message: string; data: Record<string, any> } };
  };
  try {
    assert.equal((await call("GET", "/hub-links", undefined)).status, 401);
    // Only the instance admin may make this instance call a private-network hub.
    const denied = await call("GET", "/hub-links", f.plainMember);
    assert.deepEqual({ status: denied.status, message: denied.body.message }, { status: 403, message: "HUB_LINK_ADMIN_REQUIRED" });
    assert.equal((await call("POST", "/hub-links", f.plainMember, { hubUrl: "https://10.0.0.5", token: f.issued.token, localProjectId: f.localProject.id })).status, 403);
    assert.equal((await call("POST", "/hub-links", f.me, { hubUrl: f.hubUrl, token: f.issued.token })).status, 400);
    const created = await call("POST", "/hub-links", f.me, { hubUrl: f.hubUrl, token: f.issued.token, localProjectId: f.localProject.id });
    assert.equal(created.status, 201);
    assert.ok(!JSON.stringify(created.body).includes(f.issued.token));
    const linkId = created.body.data.link.id as string;

    assert.ok(!JSON.stringify((await call("GET", "/hub-links", f.me)).body).includes("token"));
    assert.equal((await call("GET", `/hub-links/${linkId}/tasks`, f.me)).body.data.tasks.length, 1);
    assert.equal((await call("GET", `/hub-links/${linkId}/tasks`, f.stranger)).status, 404);
    assert.equal((await call("GET", `/hub-links/${linkId}/git`, f.me)).body.data.git.branch, "main");
    assert.equal((await call("PATCH", `/hub-links/${linkId}/tasks/${f.hubTask.id}/status`, f.me, { status: "done" })).status, 400);
    const blocked = await call("PATCH", `/hub-links/${linkId}/tasks/${f.hubTask.id}/status`, f.me, { status: "blocked" });
    assert.equal(blocked.body.message, "TASK_ASSIGNEE_REQUIRED", "hub rules pass through as stable codes");
    assert.equal((await call("POST", `/hub-links/${linkId}/tasks/${f.hubTask.id}/claim`, f.me, {})).body.data.task.mine, true);
    assert.equal((await call("DELETE", `/hub-links/${linkId}`, f.me)).body.data.removed, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await f.close();
  }
});

test("replies from the hub are validated before they are cached or become local tasks", async () => {
  const f = await fixture();
  try {
    const task = { id: f.hubTask.id, title: "T", description: null, status: "todo", acceptanceCriteria: [], revision: 1, semanticRevision: 1, assigneeId: null, reviewerId: null, latestSubmission: null };
    const project = { project: { id: f.hubProject.id, name: "Shared" }, actorId: f.dev.id, settings: { provider: null, remoteUrl: null, defaultBranch: null, confirmationPolicy: "human_only", revision: 0 } };
    const hub = (tasks: unknown[]) => ({
      validate: async () => {},
      fetch: (async (input: URL | string) => {
        const path = new URL(String(input)).pathname;
        const data = path.endsWith("/self") ? { userId: f.dev.id, projectId: f.hubProject.id } : path.endsWith("/tasks") ? { tasks } : project;
        return new Response(JSON.stringify({ code: 0, data, message: "" }));
      }) as typeof fetch
    });
    const input = { hubUrl: "https://forge.lan", token: f.issued.token, localProjectId: f.localProject.id };

    for (const bad of [{ ...task, id: "../../etc/passwd" }, { ...task, status: "owned" }, { ...task, title: "x".repeat(300) }, { ...task, acceptanceCriteria: "rm -rf" }]) {
      await assert.rejects(() => new HubLinkService(f.nodeDb, f.me.id, MASTER_KEY, hub([bad])).connect(input), rejects("HUB_RESPONSE_INVALID"));
      f.nodeDb.prepare("DELETE FROM hub_links").run();
    }

    const link = await new HubLinkService(f.nodeDb, f.me.id, MASTER_KEY, hub([{ ...task, injected: "<script>", prototypeLike: { a: 1 } }])).connect(input);
    const cached = (f.nodeDb.prepare("SELECT snapshot_json AS value FROM hub_link_tasks WHERE link_id=?").get(link.id) as { value: string }).value;
    assert.ok(!cached.includes("injected"), "unknown fields from the hub are dropped");
  } finally { await f.close(); }
});
