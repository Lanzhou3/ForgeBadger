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
import { createHubRemoteRoutes } from "../src/routes/hub-remote.js";
import { DeliveryService } from "../src/services/collaboration/delivery-service.js";
import { CollaborationTasks } from "../src/services/collaboration/tasks.js";
import { CollaborationError } from "../src/services/collaboration/types.js";
import { HubCoordination } from "../src/services/hub/coordination.js";
import { GiteeClient, GithubClient, RemoteError, parseRepository } from "../src/services/hub/remote-providers.js";
import { HubRemoteStatus } from "../src/services/hub/remote-status.js";
import { TeamInvitations } from "../src/services/teams/invitations.js";
import { TeamService } from "../src/services/teams/service.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const TOKEN = "tok_SECRET_value_123";
const MASTER_KEY = randomBytes(32).toString("hex");

interface Stub { status?: number; body?: unknown; headers?: Record<string, string> }
type Responder = (url: URL, init: RequestInit) => Stub | undefined;
interface Seen { url: string; headers: Record<string, string> }

function fakeFetch(responder: Responder) {
  const seen: Seen[] = [];
  const impl = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    seen.push({ url: url.toString(), headers: { ...(init.headers as Record<string, string>) } });
    assert.equal(init.redirect, "error");
    assert.ok(init.signal, "a timeout signal is required");
    const stub = responder(url, init) ?? { status: 404, body: {} };
    return new Response(JSON.stringify(stub.body ?? {}), { status: stub.status ?? 200, headers: stub.headers ?? {} });
  }) as unknown as typeof fetch;
  return { fetch: impl, seen };
}

const pass = async () => undefined;

function ghPull(over: Record<string, unknown> = {}) {
  return { number: 7, html_url: "https://github.com/acme/repo/pull/7", state: "open", draft: false, merged_at: null, updated_at: "2026-01-02T00:00:00Z", head: { sha: SHA_A }, ...over };
}

async function fixture(provider: "github" | "gitee" = "github", remoteUrl = "https://github.com/acme/repo.git") {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-hubr-")));
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  const users = new UserRepository(db);
  const owner = users.create("owner@hubr.test", "hash");
  const dev = users.create("dev@hubr.test", "hash");
  const reviewer = users.create("reviewer@hubr.test", "hash");
  const viewer = users.create("viewer@hubr.test", "hash");
  const outsider = users.create("outsider@hubr.test", "hash");
  const team = new TeamRepository(db, owner.id).create("Hub Team");
  const invitations = new TeamInvitations(db);
  for (const member of [dev, reviewer, viewer]) invitations.accept(member.id, invitations.issue(owner.id, team.id, member.email, "member").token);
  const project = new ProjectRepository(db, owner.id).create({ name: "Shared", path: root, aiTool: "claude" });
  const delivery = new DeliveryService({ db, workspacesRoot: path.join(root, "workspaces") });
  await new TeamService(delivery).enroll(owner.id, team.id, project.id, 0, new TeamRepository(db, owner.id).access(team.id).team.revision);
  const authority = new CollaborationRepository(db, owner.id);
  authority.putMember(project.id, dev.email, "developer");
  authority.putMember(project.id, reviewer.email, "reviewer");
  authority.putMember(project.id, viewer.email, "viewer");
  new HubCoordination(db, owner.id).putSettings(project.id, { expectedRevision: 0, provider, remoteUrl, defaultBranch: "main" });

  function submitTask(prUrl: string | null = "https://github.com/acme/repo/pull/7", commitSha = SHA_A) {
    const task = new CollaborationTasks(db, owner.id).create(project.id, { title: "Build", acceptanceCriteria: ["works"] });
    const hub = new HubCoordination(db, dev.id);
    const claimed = hub.claim(project.id, task.id, task.revision);
    const result = hub.submit(project.id, task.id, { expectedRevision: claimed.revision, branch: "fb/task-1", commitSha, prUrl, checksStatus: "passed" });
    return { task, submission: result.submission };
  }
  const service = (user: { id: string }, io: { fetch: typeof fetch }, options: { cooldownMs?: number; budgetMs?: number } = { cooldownMs: 0 }) =>
    new HubRemoteStatus(db, user.id, MASTER_KEY, { fetch: io.fetch, validate: pass }, options);
  const checkRows = () => db.prepare("SELECT submission_id AS s,kind,status,details_json AS d FROM hub_submission_checks ORDER BY kind").all() as Array<{ s: string; kind: string; status: string; d: string }>;
  const syncRow = () => db.prepare("SELECT remote_polled_at AS polled,remote_error AS error FROM hub_project_sync WHERE project_id=?").get(project.id) as { polled: number | null; error: string | null } | undefined;
  return { db, root, owner, dev, reviewer, viewer, outsider, project, submitTask, service, checkRows, syncRow, users, secret: randomBytes(32).toString("hex"), close: () => { db.close(); rmSync(root, { recursive: true, force: true }); } };
}

function githubHost(overrides: { pull?: Stub; runs?: unknown; status?: unknown } = {}): Responder {
  return url => {
    if (url.pathname.endsWith("/check-runs")) return { body: overrides.runs ?? { total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] } };
    if (url.pathname.endsWith("/status")) return { body: overrides.status ?? { state: "success", total_count: 0, statuses: [] } };
    if (url.pathname.includes("/pulls")) return overrides.pull ?? { body: ghPull() };
    return undefined;
  };
}

test("parseRepository accepts only the provider's own host and rejects look-alikes", () => {
  const ok: Array<[ "github" | "gitee", string, string, string ]> = [
    ["github", "https://github.com/acme/repo", "acme", "repo"],
    ["github", "https://github.com/acme/repo.git", "acme", "repo"],
    ["github", "git@github.com:acme/repo.git", "acme", "repo"],
    ["gitee", "https://gitee.com/acme/my.repo.git", "acme", "my.repo"],
    ["gitee", "git@gitee.com:acme/repo", "acme", "repo"]
  ];
  for (const [provider, url, owner, repo] of ok) assert.deepEqual(parseRepository(provider, url), { owner, repo }, url);
  const bad: Array<[ "github" | "gitee", string ]> = [
    ["github", "https://github.com.evil.test/acme/repo"],
    ["github", "https://evilgithub.com/acme/repo"],
    ["github", "https://user:pw@github.com/acme/repo"],
    ["github", "https://token@github.com/acme/repo"],
    ["github", "http://github.com/acme/repo"],
    ["github", "git@github.com.evil.test:acme/repo.git"],
    ["github", "https://gitee.com/acme/repo"],
    ["gitee", "https://github.com/acme/repo"],
    ["github", "https://github.com/acme"],
    ["github", "https://github.com/acme/repo/extra"],
    ["github", "https://github.com/ac me/repo"],
    ["github", "https://github.com/acme/re%70o"],
    ["github", "https://github.com:8443/acme/repo"],
    ["github", "ssh://git@github.com/acme/repo"]
  ];
  for (const [provider, url] of bad) {
    assert.throws(() => parseRepository(provider, url), (error: unknown) => error instanceof RemoteError && error.code === "REMOTE_REPOSITORY_UNSUPPORTED", url);
  }
});

test("GitHub finds a PR by URL, ignores a PR URL of another repository, and falls back to the branch", async () => {
  const host = fakeFetch(githubHost({ pull: undefined }));
  const client = new GithubClient(TOKEN, { fetch: host.fetch, validate: pass });
  const byUrl = await client.findPullRequest({ owner: "acme", repo: "repo", branch: "fb/x", sha: SHA_A, prUrl: "https://github.com/acme/repo/pull/7" });
  assert.deepEqual(byUrl, { number: 7, url: "https://github.com/acme/repo/pull/7", state: "open", draft: false, headSha: SHA_A });
  assert.equal(host.seen[0]!.url, "https://api.github.com/repos/acme/repo/pulls/7");
  assert.equal(host.seen[0]!.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(host.seen[0]!.headers.Accept, "application/vnd.github+json");
  assert.equal(host.seen[0]!.headers["User-Agent"], "forgebadger-hub");

  const listHost = fakeFetch(url => url.searchParams.has("head") ? { body: [ghPull({ number: 1, updated_at: "2025-01-01T00:00:00Z" }), ghPull({ number: 2, html_url: "https://github.com/acme/repo/pull/2", merged_at: "2026-01-01T00:00:00Z", state: "closed" })] } : undefined);
  const listed = new GithubClient(null, { fetch: listHost.fetch, validate: pass });
  const other = await listed.findPullRequest({ owner: "acme", repo: "repo", branch: "fb/x y", sha: SHA_A, prUrl: "https://github.com/evil/repo/pull/9" });
  assert.equal(other?.number, 2);
  assert.equal(other?.state, "merged");
  assert.equal(listHost.seen.length, 1, "the foreign PR URL must not be fetched");
  assert.equal(listHost.seen[0]!.url, "https://api.github.com/repos/acme/repo/pulls?head=acme%3Afb%2Fx%20y&state=all&per_page=5");
  assert.equal(listHost.seen[0]!.headers.Authorization, undefined);
});

test("Gitee finds a PR by URL and by branch with fixed base and no Accept override", async () => {
  const pull = { number: 3, html_url: "https://gitee.com/acme/repo/pulls/3", state: "merged", head: { sha: SHA_B, ref: "feat/a" }, updated_at: "2026-02-01T00:00:00Z" };
  const host = fakeFetch(url => url.pathname.endsWith("/pulls/3") ? { body: pull } : url.pathname.endsWith("/pulls") ? { body: [pull] } : undefined);
  const client = new GiteeClient(TOKEN, { fetch: host.fetch, validate: pass });
  const byUrl = await client.findPullRequest({ owner: "acme", repo: "repo", branch: "b", sha: SHA_A, prUrl: "https://gitee.com/acme/repo/pulls/3" });
  assert.deepEqual(byUrl, { number: 3, url: "https://gitee.com/acme/repo/pulls/3", state: "merged", draft: false, headSha: SHA_B });
  const byBranch = await client.findPullRequest({ owner: "acme", repo: "repo", branch: "feat/a", sha: SHA_A, prUrl: null });
  assert.equal(byBranch?.number, 3);
  assert.deepEqual(host.seen.map(item => item.url), [
    "https://gitee.com/api/v5/repos/acme/repo/pulls/3",
    "https://gitee.com/api/v5/repos/acme/repo/pulls?head=feat%2Fa&state=all&per_page=5"
  ]);
  assert.equal(host.seen[0]!.headers.Authorization, `Bearer ${TOKEN}`);
});

test("a PR whose html_url is not https on the provider host is treated as not found", async () => {
  for (const html_url of ["http://github.com/acme/repo/pull/7", "https://github.com.evil.test/acme/repo/pull/7", "https://evil.test/x"]) {
    const host = fakeFetch(() => ({ body: [ghPull({ html_url })] }));
    const client = new GithubClient(null, { fetch: host.fetch, validate: pass });
    assert.equal(await client.findPullRequest({ owner: "acme", repo: "repo", branch: "b", sha: SHA_A, prUrl: null }), null, html_url);
  }
});

test("GitHub CI never reports success on empty, garbled or incomplete data", async () => {
  const run = (runs: unknown, status: unknown) =>
    new GithubClient(null, { fetch: fakeFetch(githubHost({ runs, status })).fetch, validate: pass }).commitStatus({ owner: "acme", repo: "repo", sha: SHA_A });
  const empty = { total_count: 0, check_runs: [] };
  const none = { state: "pending", total_count: 0, statuses: [] };
  assert.deepEqual(await run(empty, none), { state: "none", total: 0, failed: 0 });
  assert.equal((await run({ total_count: 2, check_runs: [{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "success" }] }, none)).state, "success");
  assert.deepEqual(await run({ total_count: 2, check_runs: [{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "timed_out" }] }, none), { state: "failure", total: 2, failed: 1 });
  assert.equal((await run({ total_count: 2, check_runs: [{ status: "completed", conclusion: "success" }, { status: "in_progress", conclusion: null }] }, none)).state, "pending");
  assert.equal((await run({ total_count: 150, check_runs: [{ status: "completed", conclusion: "success" }] }, none)).state, "pending", "truncated pages are not success");
  assert.equal((await run({ total_count: 1, check_runs: [{ status: "completed", conclusion: "mystery" }] }, none)).state, "pending");
  assert.equal((await run(empty, { state: "failure", total_count: 1, statuses: [{ state: "failure" }] })).state, "failure");
  assert.equal((await run(empty, { state: "success", total_count: 1, statuses: [{ state: "success" }] })).state, "success");
  await assert.rejects(run({ nonsense: true }, none), (error: unknown) => error instanceof RemoteError && error.code === "REMOTE_RESPONSE_INVALID");
});

test("Gitee CI degrades to none when the endpoint is missing or unrecognizable", async () => {
  const sha = SHA_A;
  const status = async (stub: Stub | undefined) =>
    new GiteeClient(null, { fetch: fakeFetch(() => stub).fetch, validate: pass }).commitStatus({ owner: "acme", repo: "repo", sha });
  assert.equal((await status(undefined)).state, "none");
  assert.equal((await status({ body: { message: "garbled" } })).state, "none");
  assert.equal((await status({ body: [] })).state, "none");
  assert.equal((await status({ body: [{ state: "success" }] })).state, "success");
  assert.deepEqual(await status({ body: [{ state: "success" }, { state: "failure" }] }), { state: "failure", total: 2, failed: 1 });
  assert.equal((await status({ body: [{ state: "success" }, { state: "pending" }] })).state, "pending");
});

test("HTTP failures normalize to stable codes and base URLs cannot be redirected", async () => {
  const input = { owner: "acme", repo: "repo", branch: "b", sha: SHA_A, prUrl: null };
  const code = (stub: Stub | "throw") => {
    const impl = stub === "throw" ? (async () => { throw new TypeError("secret detail"); }) as unknown as typeof fetch : fakeFetch(() => stub).fetch;
    return new GithubClient(TOKEN, { fetch: impl, validate: pass }).findPullRequest(input);
  };
  const expect = (c: string) => (error: unknown) => error instanceof RemoteError && error.code === c && !error.message.includes(TOKEN);
  await assert.rejects(code({ status: 401 }), expect("REMOTE_AUTH_REJECTED"));
  await assert.rejects(code({ status: 403 }), expect("REMOTE_AUTH_REJECTED"));
  await assert.rejects(code({ status: 403, headers: { "x-ratelimit-remaining": "0" } }), expect("REMOTE_RATE_LIMITED"));
  await assert.rejects(code({ status: 429 }), expect("REMOTE_RATE_LIMITED"));
  await assert.rejects(code({ status: 404 }), expect("REMOTE_REPOSITORY_NOT_FOUND"));
  await assert.rejects(code("throw"), expect("REMOTE_UNREACHABLE"));
  await assert.rejects(code({ status: 200, body: { not: "a list" } }), expect("REMOTE_RESPONSE_INVALID"));

  const validated: string[] = [];
  const host = fakeFetch(() => ({ body: [] }));
  const strict = (async (endpoint: string | null | undefined, ...rest: unknown[]) => { validated.push(String(endpoint)); assert.equal(rest.length, 0, "strict policy has no options"); }) as never;
  await new GiteeClient(null, { fetch: host.fetch, validate: strict }).findPullRequest(input);
  await new GithubClient(null, { fetch: host.fetch, validate: strict }).findPullRequest(input);
  assert.deepEqual(validated, ["https://gitee.com", "https://api.github.com"]);
  const rejecting = (async () => { throw new Error("private"); }) as never;
  await assert.rejects(new GithubClient(null, { fetch: host.fetch, validate: rejecting }).findPullRequest(input), expect("REMOTE_UNREACHABLE"));
  assert.equal(host.seen.length, 2, "a rejected endpoint must not be requested");
});

test("refresh maps PR and CI states onto checks and keeps other kinds", async () => {
  const f = await fixture();
  try {
    const { submission, task } = f.submitTask();
    f.db.prepare("INSERT INTO hub_submission_checks(submission_id,user_id,project_id,kind,status,details_json,checked_at) VALUES(?,?,?,?,?,?,?)")
      .run(submission.id, f.owner.id, f.project.id, "base_conflict", "ok", "{\"keep\":true}", 1);
    const host = fakeFetch(githubHost());
    const result = await f.service(f.reviewer, host).refresh(f.project.id);
    assert.deepEqual(result.checks.map(c => [c.kind, c.status]), [["pull_request", "ok"], ["ci", "ok"]]);
    assert.equal(result.checks[0]!.taskId, task.id);
    assert.deepEqual(result.checks[0]!.details, { number: 7, url: "https://github.com/acme/repo/pull/7", state: "open", draft: false, headSha: SHA_A, matchesSubmission: true });
    const rows = f.checkRows();
    assert.deepEqual(rows.map(row => row.kind), ["base_conflict", "ci", "pull_request"]);
    assert.equal(rows.find(row => row.kind === "base_conflict")!.d, "{\"keep\":true}");
    assert.equal(f.syncRow()?.error, null);
    assert.ok(f.syncRow()?.polled);

    const diverged = fakeFetch(githubHost({ pull: { body: ghPull({ head: { sha: SHA_B.toUpperCase() } }) }, runs: { total_count: 1, check_runs: [{ status: "completed", conclusion: "failure" }] } }));
    const again = await f.service(f.owner, diverged).refresh(f.project.id);
    assert.deepEqual(again.checks.map(c => [c.kind, c.status]), [["pull_request", "attention"], ["ci", "attention"]]);
    assert.equal(again.checks[0]!.details.matchesSubmission, false);
    assert.equal(f.checkRows().filter(row => row.kind === "ci").length, 1, "upsert keeps one row per kind");

    const closed = fakeFetch(githubHost({ pull: { body: ghPull({ state: "closed" }) }, runs: { total_count: 0, check_runs: [] } }));
    const third = await f.service(f.owner, closed).refresh(f.project.id);
    assert.deepEqual(third.checks.map(c => c.status), ["attention", "unknown"]);
    const base = githubHost({ runs: { total_count: 0, check_runs: [] } });
    const missing = fakeFetch(url => url.pathname.endsWith("/pulls") ? { body: [] } : url.pathname.includes("/pulls/") ? undefined : base(url, {}));
    const fourth = await f.service(f.owner, missing).refresh(f.project.id);
    assert.deepEqual(fourth.checks[0], { ...fourth.checks[0]!, status: "unknown", details: { reason: "NOT_FOUND" } });
    assert.equal(fourth.checks[1]!.details.state, "none");
  } finally { f.close(); }
});

test("refresh skips stale and finished submissions and requires a configured repository", async () => {
  const f = await fixture();
  try {
    const { task } = f.submitTask();
    const current = new CollaborationTasks(f.db, f.owner.id).get(new HubCoordination(f.db, f.owner.id).access(f.project.id), task.id);
    new CollaborationTasks(f.db, f.owner.id).update(f.project.id, task.id, { expectedRevision: current.revision, acceptanceCriteria: ["works", "more"] });
    const host = fakeFetch(githubHost());
    const result = await f.service(f.owner, host).refresh(f.project.id);
    assert.deepEqual(result.checks, []);
    assert.equal(host.seen.length, 0);
  } finally { f.close(); }

  const bare = await fixture();
  try {
    bare.db.prepare("DELETE FROM hub_projects").run();
    await assert.rejects(bare.service(bare.owner, fakeFetch(() => undefined)).refresh(bare.project.id), (e: unknown) => e instanceof CollaborationError && e.status === 409 && e.code === "HUB_REPOSITORY_NOT_CONFIGURED");
  } finally { bare.close(); }
});

test("refresh authority: reviewer and manager may refresh; viewer, developer and outsider may not", async () => {
  const f = await fixture();
  try {
    f.submitTask();
    const host = fakeFetch(githubHost());
    const denied = (e: unknown, status: number, code: string) => e instanceof CollaborationError && e.status === status && e.code === code;
    for (const user of [f.viewer, f.dev]) {
      await assert.rejects(f.service(user, host).refresh(f.project.id), (e: unknown) => denied(e, 403, "PROJECT_CAPABILITY_DENIED"));
    }
    await assert.rejects(f.service(f.outsider, host).refresh(f.project.id), (e: unknown) => e instanceof CollaborationError && e.status === 404);
    assert.equal(host.seen.length, 0);
    assert.equal((await f.service(f.reviewer, host).refresh(f.project.id)).checks.length, 2);
    assert.equal((await f.service(f.owner, host).refresh(f.project.id)).checks.length, 2);
  } finally { f.close(); }
});

test("the token is sent only as a header and never stored in plaintext, returned, logged as event or thrown", async () => {
  const f = await fixture();
  try {
    f.submitTask();
    const service = f.service(f.owner, fakeFetch(() => undefined));
    assert.deepEqual(service.setCredential(f.project.id, TOKEN), { tokenConfigured: true });
    for (const bad of ["", "has space", "a\tb", "x".repeat(513)]) {
      assert.throws(() => service.setCredential(f.project.id, bad), (e: unknown) => e instanceof CollaborationError && e.status === 400);
    }
    const stored = f.db.prepare("SELECT token_encrypted AS t FROM hub_remote_credentials WHERE project_id=?").get(f.project.id) as { t: string };
    assert.ok(!stored.t.includes(TOKEN));

    const host = fakeFetch(githubHost());
    const result = await f.service(f.reviewer, host).refresh(f.project.id);
    assert.ok(host.seen.length >= 3);
    for (const request of host.seen) {
      assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
      assert.ok(!request.url.includes(TOKEN));
    }
    const dump = JSON.stringify([result, f.checkRows(), f.syncRow(), f.db.prepare("SELECT * FROM collaboration_events").all()]);
    assert.ok(!dump.includes(TOKEN));
    const events = f.db.prepare("SELECT body_json AS b FROM collaboration_events WHERE kind='hub_remote_credential_updated'").all() as Array<{ b: string }>;
    assert.deepEqual(events.map(row => JSON.parse(row.b)), [{ configured: true }]);

    const failing = fakeFetch(() => ({ status: 401 }));
    await assert.rejects(f.service(f.reviewer, failing).refresh(f.project.id), (e: unknown) => e instanceof CollaborationError && !JSON.stringify(e).includes(TOKEN) && !String(e.message).includes(TOKEN));

    assert.deepEqual(service.clearCredential(f.project.id), { tokenConfigured: false });
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM hub_remote_credentials").get().valueOf() && (f.db.prepare("SELECT COUNT(*) AS n FROM hub_remote_credentials").get() as { n: number }).n, 0);
    const anonymous = fakeFetch(githubHost());
    await f.service(f.reviewer, anonymous).refresh(f.project.id);
    assert.ok(anonymous.seen.every(request => request.headers.Authorization === undefined), "works anonymously after clearing");
  } finally { f.close(); }
});

test("credentials are manage-only", async () => {
  const f = await fixture();
  try {
    const service = (user: { id: string }) => f.service(user, fakeFetch(() => undefined));
    for (const user of [f.dev, f.reviewer, f.viewer]) {
      assert.throws(() => service(user).setCredential(f.project.id, TOKEN), (e: unknown) => e instanceof CollaborationError && e.status === 403);
      assert.throws(() => service(user).clearCredential(f.project.id), (e: unknown) => e instanceof CollaborationError && e.status === 403);
    }
    assert.throws(() => service(f.outsider).setCredential(f.project.id, TOKEN), (e: unknown) => e instanceof CollaborationError && e.status === 404);
  } finally { f.close(); }
});

test("provider auth rejection is recorded and surfaced as 502; item errors do not abort", async () => {
  const f = await fixture();
  try {
    const { submission } = f.submitTask();
    await assert.rejects(f.service(f.owner, fakeFetch(() => ({ status: 401 }))).refresh(f.project.id),
      (e: unknown) => e instanceof CollaborationError && e.status === 502 && e.code === "REMOTE_AUTH_REJECTED");
    assert.equal(f.syncRow()?.error, "REMOTE_AUTH_REJECTED");

    const garbled = fakeFetch(url => url.pathname.includes("/pulls") ? { body: { nope: 1 } } : githubHost()(url, {}));
    const result = await f.service(f.owner, garbled).refresh(f.project.id);
    assert.deepEqual(result.checks.map(c => [c.kind, c.status]), [["pull_request", "unknown"], ["ci", "ok"]]);
    assert.deepEqual(result.checks[0]!.details, { reason: "REMOTE_RESPONSE_INVALID" });
    assert.equal(f.syncRow()?.error, null);
    assert.equal(f.checkRows().find(row => row.s === submission.id && row.kind === "pull_request")?.status, "unknown");

    await assert.rejects(f.service(f.owner, fakeFetch(() => ({ status: 404 }))).refresh(f.project.id),
      (e: unknown) => e instanceof CollaborationError && e.code === "REMOTE_REPOSITORY_NOT_FOUND");
  } finally { f.close(); }
});

test("refresh works for Gitee projects", async () => {
  const f = await fixture("gitee", "git@gitee.com:acme/repo.git");
  try {
    f.submitTask("https://gitee.com/acme/repo/pulls/3");
    const pull = { number: 3, html_url: "https://gitee.com/acme/repo/pulls/3", state: "open", head: { sha: SHA_A }, updated_at: "2026-01-01T00:00:00Z" };
    const host = fakeFetch(url => url.pathname.endsWith("/statuses") ? { body: [{ state: "success" }] } : url.pathname.endsWith("/pulls/3") ? { body: pull } : undefined);
    const result = await f.service(f.owner, host).refresh(f.project.id);
    assert.deepEqual(result.checks.map(c => [c.kind, c.status]), [["pull_request", "ok"], ["ci", "ok"]]);
    assert.ok(host.seen.every(request => request.url.startsWith("https://gitee.com/api/v5/")));
  } finally { f.close(); }
});

test("HTTP routes: envelope, validation, authority and secure credential transport", async () => {
  const f = await fixture();
  const host = fakeFetch(githubHost());
  const secret = f.secret;
  const app = express();
  app.locals.db = f.db;
  app.locals.jwtSecret = secret;
  app.use(express.json());
  app.use("/hub-console", createHubRemoteRoutes(f.db, MASTER_KEY, { fetch: host.fetch, validate: pass }, { cooldownMs: 0 }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = async (method: string, route: string, user: { id: string; email: string } | null, body?: unknown, extra: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/hub-console${route}`, {
      method,
      headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, secret)}` } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as { code: number; message: string; data: Record<string, any> } };
  };
  try {
    f.submitTask();
    const credential = `/projects/${f.project.id}/remote-credential`;
    const refresh = `/projects/${f.project.id}/remote/refresh`;
    assert.equal((await call("PUT", credential, null, { token: TOKEN })).status, 401);
    assert.equal((await call("PUT", credential, f.dev, { token: TOKEN })).status, 403);
    assert.equal((await call("PUT", credential, f.owner, { token: TOKEN, extra: 1 })).status, 400);
    assert.equal((await call("PUT", credential, f.owner, { token: "a b" })).status, 400);
    const proxied = await call("PUT", credential, f.owner, { token: TOKEN }, { "X-Forwarded-For": "203.0.113.5", "X-Forwarded-Proto": "http" });
    assert.equal(proxied.status, 403);
    assert.equal(proxied.body.message, "SECURE_CREDENTIAL_TRANSPORT_REQUIRED");
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM hub_remote_credentials").get() as { n: number }).n, 0);

    const saved = await call("PUT", credential, f.owner, { token: TOKEN });
    assert.deepEqual([saved.status, saved.body.code, saved.body.data], [200, 0, { tokenConfigured: true }]);
    assert.ok(!JSON.stringify(saved.body).includes(TOKEN));

    assert.equal((await call("POST", refresh, f.viewer, {})).status, 403);
    assert.equal((await call("POST", refresh, f.outsider, {})).status, 404);
    assert.equal((await call("POST", refresh, f.reviewer, { unexpected: true })).status, 400);
    const ok = await call("POST", refresh, f.reviewer, {});
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.checks.length, 2);
    assert.ok(!JSON.stringify(ok.body).includes(TOKEN));
    assert.equal((await call("POST", `/projects/not-a-uuid/remote/refresh`, f.reviewer, {})).status, 400);

    const failing = express();
    failing.locals.db = f.db;
    failing.locals.jwtSecret = secret;
    failing.use(express.json());
    failing.use("/hub-console", createHubRemoteRoutes(f.db, MASTER_KEY, { fetch: fakeFetch(() => ({ status: 401 })).fetch, validate: pass }, { cooldownMs: 0 }));
    const second = failing.listen(0, "127.0.0.1");
    await once(second, "listening");
    try {
      const port = (second.address() as { port: number }).port;
      const reply = await fetch(`http://127.0.0.1:${port}/hub-console${refresh}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${signJwt({ userId: f.owner.id, email: f.owner.email }, secret)}` }, body: "{}" });
      assert.equal(reply.status, 502);
      assert.equal(((await reply.json()) as { message: string }).message, "REMOTE_AUTH_REJECTED");
    } finally { second.closeAllConnections(); await new Promise<void>(resolve => second.close(() => resolve())); }

    const cleared = await call("DELETE", credential, f.owner);
    assert.deepEqual(cleared.body.data, { tokenConfigured: false });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    f.close();
  }
});

test("list results are filtered by head ref/sha, preferring the submission commit", async () => {
  const item = (number: number, ref: string | undefined, sha: string, updated: string) =>
    ghPull({ number, html_url: `https://github.com/acme/repo/pull/${number}`, head: { sha, ...(ref ? { ref } : {}) }, updated_at: updated });
  const find = async (items: unknown[], branch = "fb/x") => {
    const host = fakeFetch(() => ({ body: items }));
    return (await new GithubClient(null, { fetch: host.fetch, validate: pass }).findPullRequest({ owner: "acme", repo: "repo", branch, sha: SHA_A, prUrl: null }))?.number ?? null;
  };
  assert.equal(await find([item(1, "other", SHA_B, "2026-03-01T00:00:00Z")]), null, "provider ignored the head filter");
  assert.equal(await find([item(1, "fb/x", SHA_B, "2026-01-01T00:00:00Z"), item(2, "fb/x", SHA_B, "2026-02-01T00:00:00Z")]), 2);
  assert.equal(await find([item(1, "fb/x", SHA_A, "2026-01-01T00:00:00Z"), item(2, "fb/x", SHA_B, "2026-02-01T00:00:00Z")]), 1, "matching commit wins");
  assert.equal(await find([item(3, undefined, SHA_A.toUpperCase(), "2026-01-01T00:00:00Z")]), 3, "no ref: accepted by sha");
  assert.equal(await find([item(4, undefined, SHA_B, "2026-01-01T00:00:00Z")]), null);
  assert.equal(await find([item(5, "fb/x", SHA_A, "2026-01-01T00:00:00Z")], "fb/y"), null);
});

test("Gitee CI maps odd shapes and server errors to none, but network failure propagates", async () => {
  const status = (stub: Stub) => new GiteeClient(null, { fetch: fakeFetch(() => stub).fetch, validate: pass }).commitStatus({ owner: "acme", repo: "repo", sha: SHA_A });
  assert.equal((await status({ body: { unexpected: "shape" } })).state, "none");
  assert.equal((await status({ status: 500, body: {} })).state, "none");
  assert.equal((await status({ body: [{ state: "weird" }] })).state, "pending");
  await assert.rejects(status({ status: 401 }), (e: unknown) => e instanceof RemoteError && e.code === "REMOTE_AUTH_REJECTED");
  const down = (async () => { throw new TypeError("net"); }) as unknown as typeof fetch;
  await assert.rejects(new GiteeClient(null, { fetch: down, validate: pass }).commitStatus({ owner: "acme", repo: "repo", sha: SHA_A }),
    (e: unknown) => e instanceof RemoteError && e.code === "REMOTE_UNREACHABLE");
});

test("refresh prunes PR/CI rows of superseded submissions and keeps other kinds", async () => {
  const f = await fixture();
  try {
    const { task, submission: old } = f.submitTask();
    await f.service(f.owner, fakeFetch(githubHost())).refresh(f.project.id);
    f.db.prepare("INSERT INTO hub_submission_checks(submission_id,user_id,project_id,kind,status,details_json,checked_at) VALUES(?,?,?,?,?,?,?)")
      .run(old.id, f.owner.id, f.project.id, "base_conflict", "ok", "{}", 1);
    assert.equal(f.checkRows().length, 3);

    const hub = new HubCoordination(f.db, f.dev.id);
    const current = hub.task(f.project.id, task.id).task;
    const next = hub.submit(f.project.id, task.id, { expectedRevision: current.revision, branch: "fb/task-1", commitSha: SHA_B, prUrl: null, checksStatus: "passed" }).submission;
    await f.service(f.owner, fakeFetch(githubHost())).refresh(f.project.id);
    const rows = f.checkRows();
    assert.deepEqual(rows.filter(row => row.s === old.id).map(row => row.kind), ["base_conflict"]);
    assert.deepEqual(rows.filter(row => row.s === next.id).map(row => row.kind), ["ci", "pull_request"]);
  } finally { f.close(); }
});

test("concurrent refreshes share one run and one set of provider requests", async () => {
  const f = await fixture();
  try {
    f.submitTask();
    const host = fakeFetch(githubHost());
    const service = f.service(f.reviewer, host);
    const [first, second, third] = await Promise.all([service.refresh(f.project.id), service.refresh(f.project.id), f.service(f.owner, host).refresh(f.project.id)]);
    assert.equal(host.seen.length, 3, "one PR lookup plus two CI calls");
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
  } finally { f.close(); }
});

test("a clean poll inside the cooldown is served from stored rows; later and failed polls hit the provider", async () => {
  const f = await fixture();
  try {
    f.submitTask();
    const host = fakeFetch(githubHost());
    const options = { cooldownMs: 60_000 };
    const first = await f.service(f.reviewer, host, options).refresh(f.project.id);
    const requests = host.seen.length;
    const again = await f.service(f.reviewer, host, options).refresh(f.project.id);
    assert.equal(host.seen.length, requests, "no provider request inside the cooldown");
    assert.deepEqual(again.checks.map(c => [c.kind, c.status, c.details]).sort(), first.checks.map(c => [c.kind, c.status, c.details]).sort());

    f.db.prepare("UPDATE hub_project_sync SET remote_polled_at=?").run(Date.now() - 61_000);
    await f.service(f.reviewer, host, options).refresh(f.project.id);
    assert.ok(host.seen.length > requests, "polls again after the interval");

    const failing = fakeFetch(() => ({ status: 401 }));
    await assert.rejects(f.service(f.reviewer, failing, { cooldownMs: 0 }).refresh(f.project.id));
    assert.equal(f.syncRow()?.error, "REMOTE_AUTH_REJECTED");
    const retry = fakeFetch(githubHost());
    await f.service(f.reviewer, retry, options).refresh(f.project.id);
    assert.ok(retry.seen.length > 0, "a failed poll is not subject to the cooldown");
  } finally { f.close(); }
});

test("a refresh past its time budget marks the remaining submissions unknown without more requests", async () => {
  const f = await fixture();
  try {
    f.submitTask();
    f.submitTask();
    const inner = fakeFetch(githubHost());
    const slow = (async (...args: Parameters<typeof fetch>) => { await new Promise(resolve => setTimeout(resolve, 25)); return inner.fetch(...args); }) as typeof fetch;
    const result = await f.service(f.owner, { fetch: slow }, { cooldownMs: 0, budgetMs: 10 }).refresh(f.project.id);
    assert.equal(result.checks.length, 4);
    const exceeded = result.checks.filter(check => check.details.reason === "REMOTE_BUDGET_EXCEEDED");
    assert.equal(exceeded.length, 2);
    assert.ok(exceeded.every(check => check.status === "unknown"));
    assert.equal(inner.seen.length, 3, "only the first submission was fetched");
  } finally { f.close(); }
});
