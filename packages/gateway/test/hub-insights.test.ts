import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
import { createHubInsightRoutes } from "../src/routes/hub-insights.js";
import { DeliveryService } from "../src/services/collaboration/delivery-service.js";
import { CollaborationTasks } from "../src/services/collaboration/tasks.js";
import { CollaborationError } from "../src/services/collaboration/types.js";
import { HubCoordination } from "../src/services/hub/coordination.js";
import { matchesPattern, parseCodeowners, readCodeowners } from "../src/services/hub/codeowners.js";
import { HubInsights, type HubInsightsOptions } from "../src/services/hub/insights.js";
import { changedFiles, fetchMirror, hasCommit, mergeConflicts } from "../src/services/hub/mirror-git.js";
import { TeamInvitations } from "../src/services/teams/invitations.js";
import { TeamService } from "../src/services/teams/service.js";

const MISSING_SHA = "c".repeat(40);

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Dev", "-c", "user.email=dev@hub.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
}

function write(root: string, file: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

/** Commits `files` on a new branch cut from main and pushes it; returns the commit id. */
function pushBranch(work: string, branch: string, files: Record<string, string>): string {
  git(work, "switch", "-q", "-c", branch, "origin/main");
  for (const [file, content] of Object.entries(files)) write(work, file, content);
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", branch);
  git(work, "push", "-q", "origin", branch);
  return git(work, "rev-parse", "HEAD");
}

async function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-insights-")));
  const remote = path.join(root, "remote.git");
  const mirror = path.join(root, "mirror");
  const work = path.join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", mirror]);
  write(mirror, ".github/CODEOWNERS", "# owners\n/src/api/ @alice\n/docs/ @bob @carol  # docs\n");
  write(mirror, "shared.txt", "base\n");
  write(mirror, "src/api/a.ts", "a\n");
  git(mirror, "add", ".");
  git(mirror, "commit", "-q", "-m", "init");
  git(mirror, "remote", "add", "origin", remote);
  git(mirror, "push", "-q", "-u", "origin", "main");
  execFileSync("git", ["clone", "-q", remote, work]);

  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  const users = new UserRepository(db);
  const owner = users.create("owner@ins.test", "hash");
  const dev = users.create("dev@ins.test", "hash");
  const reviewer = users.create("reviewer@ins.test", "hash");
  const viewer = users.create("viewer@ins.test", "hash");
  const outsider = users.create("outsider@ins.test", "hash");
  const team = new TeamRepository(db, owner.id).create("Insights Team");
  const invitations = new TeamInvitations(db);
  for (const member of [dev, reviewer, viewer]) invitations.accept(member.id, invitations.issue(owner.id, team.id, member.email, "member").token);
  const project = new ProjectRepository(db, owner.id).create({ name: "Shared", path: mirror, aiTool: "claude" });
  const delivery = new DeliveryService({ db, workspacesRoot: path.join(root, "workspaces") });
  await new TeamService(delivery).enroll(owner.id, team.id, project.id, 0, new TeamRepository(db, owner.id).access(team.id).team.revision);
  const authority = new CollaborationRepository(db, owner.id);
  authority.putMember(project.id, dev.email, "developer");
  authority.putMember(project.id, reviewer.email, "reviewer");
  authority.putMember(project.id, viewer.email, "viewer");
  const otherPath = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-insights-other-")));
  new ProjectRepository(db, outsider.id).create({ name: "Private", path: otherPath, aiTool: "claude" });

  const setSettings = (remoteUrl: string | null, branch: string | null = "main") => db.prepare(
    `INSERT INTO hub_projects(project_id,user_id,provider,remote_url,default_branch,confirmation_policy,revision,updated_by,updated_at)
     VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(project_id) DO UPDATE SET remote_url=excluded.remote_url,default_branch=excluded.default_branch`
  ).run(project.id, owner.id, "github", remoteUrl, branch, "human_only", owner.id, Date.now());
  setSettings(remote);

  /** A task assigned to dev with a submission for `sha`, left in ready_for_review. */
  const submitted = (title: string, sha: string, moduleBranch = `fb/${title}`) => {
    const task = new CollaborationTasks(db, owner.id).create(project.id, { title, acceptanceCriteria: ["ok"], assigneeId: dev.id });
    const hub = new HubCoordination(db, dev.id);
    const claimed = hub.claim(project.id, task.id, task.revision);
    const result = hub.submit(project.id, task.id, { expectedRevision: claimed.revision, branch: moduleBranch, commitSha: sha, checksStatus: "passed" });
    return { task, submission: result.submission };
  };

  const secret = randomBytes(32).toString("hex");
  const app = express();
  app.locals.db = db;
  app.locals.jwtSecret = secret;
  app.use(express.json());
  app.use("/hub-console", createHubInsightRoutes(db));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = async (method: string, route: string, user: { id: string; email: string }, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/hub-console${route}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, secret)}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as { code: number; message: string; data: Record<string, any> } };
  };

  return {
    db, root, remote, mirror, work, owner, dev, reviewer, viewer, outsider, project, setSettings, submitted, call,
    insights: (user: { id: string }, options: HubInsightsOptions = { cooldownMs: 0 }) => new HubInsights(db, user.id, options),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(otherPath, { recursive: true, force: true });
    }
  };
}

const deniedWith = (status: number, code: string) => (error: unknown) =>
  error instanceof CollaborationError && error.status === status && error.code === code;

test("CODEOWNERS parsing skips comments and enforces limits", () => {
  const entries = parseCodeowners("# top\n\n*.js @a @b\n/docs/ @c # trailing\r\n" + "x".repeat(301) + " @z\n");
  assert.deepEqual(entries, [{ pattern: "*.js", owners: ["@a", "@b"] }, { pattern: "/docs/", owners: ["@c"] }]);
  const many = parseCodeowners(Array.from({ length: 600 }, (_, index) => `/p${index}/ @o`).join("\n"));
  assert.equal(many.length, 500);
  const tooManyWildcards = "*".repeat(17);
  const tooDeep = Array.from({ length: 33 }, () => "d").join("/");
  assert.deepEqual(parseCodeowners(`${tooManyWildcards} @a\n${tooDeep} @b\n/${"*/".repeat(16)}x @c\n`).map(entry => entry.owners[0]), ["@c"]);
});

test("CODEOWNERS matching is not exposed to catastrophic backtracking", () => {
  const cases: Array<[string, string]> = [
    ["a/**/**/**/**/**/**/**/**/z", `a/${"a/".repeat(40)}b`],
    ["*a".repeat(8) + "b", "a".repeat(200)],
    ["**/".repeat(10) + "x", "a/".repeat(100) + "y"],
    ["*a*a*a*a*a*a*a*a*b", "a".repeat(250)]
  ];
  for (const [pattern, file] of cases) {
    const started = Date.now();
    assert.equal(matchesPattern(pattern, file), false);
    assert.ok(Date.now() - started < 1000, `${pattern} took too long`);
  }
  assert.equal(matchesPattern("a/**/**/z", "a/b/c/z"), true);
  assert.equal(matchesPattern("**/".repeat(5) + "x", "p/q/x"), true);
});

test("CODEOWNERS matching follows gitignore-style rules", () => {
  const table: Array<[string, string, boolean]> = [
    ["/src/api/", "src/api/a.ts", true],
    ["/src/api/", "src/api", false],
    ["/src/api/", "other/src/api/a.ts", false],
    ["src/api/", "other/src/api/a.ts", false],
    ["docs/", "a/docs/b.md", true],
    ["docs", "a/docs/b.md", true],
    ["*.md", "docs/deep/readme.md", true],
    ["/*.md", "docs/readme.md", false],
    ["/*.md", "readme.md", true],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/x/a.ts", false],
    ["/src/**/test.ts", "src/test.ts", true],
    ["/src/**/test.ts", "src/a/b/test.ts", true],
    ["/src/**", "src/a/b/c.ts", true],
    ["/a/b", "a/b/c.txt", true],
    ["/a/b", "a/bc/c.txt", false],
    ["file?.txt", "x/file1.txt", true],
    ["a.b", "axb", false]
  ];
  for (const [pattern, file, expected] of table) assert.equal(matchesPattern(pattern, file), expected, `${pattern} vs ${file}`);
});

test("CODEOWNERS file lookup refuses symlinks, oversize files and missing files", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-codeowners-")));
  try {
    assert.deepEqual(readCodeowners(root), []);
    write(root, "real.txt", "/x/ @a\n");
    symlinkSync(path.join(root, "real.txt"), path.join(root, "CODEOWNERS"));
    assert.deepEqual(readCodeowners(root), [], "symlinked CODEOWNERS must be refused");
    rmSync(path.join(root, "CODEOWNERS"));
    write(root, "docs/CODEOWNERS", "/y/ @a\n");
    assert.deepEqual(readCodeowners(root), [{ pattern: "/y/", owners: ["@a"] }]);
    write(root, "CODEOWNERS", "/z/ @a\n");
    assert.deepEqual(readCodeowners(root), [{ pattern: "/z/", owners: ["@a"] }], "root file precedes docs/");
    write(root, ".github/CODEOWNERS", `/big/ ${"@a ".repeat(100_000)}\n`);
    assert.deepEqual(readCodeowners(root), [], "oversized file is ignored");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("git wrappers reject option-like refs before running git", async () => {
  const f = await fixture();
  try {
    const head = git(f.mirror, "rev-parse", "HEAD");
    assert.equal(await hasCommit(f.mirror, head), true);
    assert.equal(await hasCommit(f.mirror, MISSING_SHA), false);
    await assert.rejects(hasCommit(f.mirror, "--upload-pack=x"), /MIRROR_INVALID_REF/);
    await assert.rejects(changedFiles(f.mirror, "--output=/tmp/x", head), /MIRROR_INVALID_REF/);
    await assert.rejects(changedFiles(f.mirror, "refs/remotes/origin/--upload-pack=x", head), /MIRROR_INVALID_REF/);
    await assert.rejects(mergeConflicts(f.mirror, "refs/remotes/origin/main", "--upload-pack=x"), /MIRROR_INVALID_REF/);
    await assert.rejects(mergeConflicts(f.mirror, "main", head), /MIRROR_INVALID_REF/);
  } finally {
    await f.close();
  }
});

test("setTaskModule needs manage, a known pattern and an existing task", async () => {
  const f = await fixture();
  try {
    const { task } = f.submitted("module", MISSING_SHA);
    await assert.rejects(f.insights(f.dev).setTaskModule(f.project.id, task.id, "/src/api/"), deniedWith(403, "PROJECT_CAPABILITY_DENIED"));
    await assert.rejects(f.insights(f.owner).setTaskModule(f.project.id, task.id, "/nope/"), deniedWith(400, "MODULE_PATTERN_UNKNOWN"));
    await assert.rejects(f.insights(f.owner).setTaskModule(f.project.id, "00000000-0000-4000-8000-000000000000", "/src/api/"), deniedWith(404, "TASK_NOT_FOUND"));
    assert.deepEqual(await f.insights(f.owner).setTaskModule(f.project.id, task.id, "/src/api/"), { [task.id]: "/src/api/" });
    assert.deepEqual((await f.insights(f.owner).insights(f.project.id)).taskModules, { [task.id]: "/src/api/" });
    assert.deepEqual(await f.insights(f.owner).setTaskModule(f.project.id, task.id, null), {});
    const events = f.db.prepare("SELECT COUNT(*) AS n FROM collaboration_events WHERE kind='task_module_updated'").get() as { n: number };
    assert.equal(events.n, 2);
  } finally {
    await f.close();
  }
});

test("refresh computes base, scope and peer checks and keeps foreign rows", async () => {
  const f = await fixture();
  try {
    const inside = pushBranch(f.work, "feat-inside", { "src/api/new.ts": "x\n" });
    const wide = pushBranch(f.work, "feat-wide", { "src/api/w.ts": "w\n", "docs/z.md": "z\n" });
    const left = pushBranch(f.work, "conflict-left", { "shared.txt": "left\n" });
    const right = pushBranch(f.work, "conflict-right", { "shared.txt": "right\n" });
    git(f.work, "switch", "-q", "main");
    write(f.work, "shared.txt", "main moved\n");
    git(f.work, "commit", "-q", "-am", "main moves");
    git(f.work, "push", "-q", "origin", "main");

    const a = f.submitted("inside", inside);
    const b = f.submitted("wide", wide);
    const c = f.submitted("left", left);
    const d = f.submitted("right", right);
    const e = f.submitted("missing", MISSING_SHA);
    await f.insights(f.owner).setTaskModule(f.project.id, a.task.id, "/src/api/");
    await f.insights(f.owner).setTaskModule(f.project.id, b.task.id, "/src/api/");
    await f.insights(f.owner).setTaskModule(f.project.id, e.task.id, "/docs/");
    for (const kind of ["pull_request", "ci"]) {
      f.db.prepare("INSERT INTO hub_submission_checks(submission_id,user_id,project_id,kind,status,details_json,checked_at) VALUES(?,?,?,?,?,?,?)")
        .run(a.submission.id, f.owner.id, f.project.id, kind, "ok", JSON.stringify({ from: "remote" }), 1);
    }

    const view = await f.insights(f.owner).refreshMirror(f.project.id);
    const find = (submissionId: string, kind: string) => view.checks.find(check => check.submissionId === submissionId && check.kind === kind)!;

    assert.equal(find(a.submission.id, "base_conflict").status, "ok");
    assert.equal(find(a.submission.id, "scope").status, "ok");
    assert.equal(find(a.submission.id, "peer_conflict").status, "ok");
    assert.equal(find(b.submission.id, "base_conflict").status, "ok");
    const scope = find(b.submission.id, "scope");
    assert.equal(scope.status, "attention");
    assert.deepEqual(scope.details, { pattern: "/src/api/", outside: ["docs/z.md"], total: 1 });
    const base = find(c.submission.id, "base_conflict");
    assert.equal(base.status, "attention");
    assert.deepEqual(base.details, { baseBranch: "main", files: ["shared.txt"], truncated: false });
    assert.equal(find(c.submission.id, "scope"), undefined, "no module, no scope check");
    const peer = find(c.submission.id, "peer_conflict");
    assert.equal(peer.status, "attention");
    assert.deepEqual(peer.details, { peers: [{ submissionId: d.submission.id, taskId: d.task.id, files: ["shared.txt"] }] });
    assert.equal(find(e.submission.id, "base_conflict").status, "unknown");
    assert.deepEqual(find(e.submission.id, "base_conflict").details, { reason: "COMMIT_NOT_FETCHED" });
    assert.equal(find(e.submission.id, "scope").status, "unknown");
    assert.equal(find(a.submission.id, "pull_request").details.from, "remote");
    assert.equal(find(a.submission.id, "ci").status, "ok");
    assert.ok(view.sync.mirrorFetchedAt && view.sync.mirrorError === null);
    assert.deepEqual(view.remote, { tokenConfigured: false });
    assert.ok(!JSON.stringify(view).includes(f.mirror), "mirror path must never be exposed");

    // Leaving flight removes the derived rows but never the remote ones.
    new HubCoordination(f.db, f.reviewer.id).confirm(f.project.id, a.task.id, {
      expectedRevision: new CollaborationTasks(f.db, f.owner.id).get(new CollaborationRepository(f.db, f.owner.id).access(f.project.id), a.task.id).revision,
      submissionId: a.submission.id, decision: "accepted", note: "ok"
    }, "human");
    const after = await f.insights(f.owner).refreshMirror(f.project.id);
    assert.deepEqual(after.checks.filter(check => check.submissionId === a.submission.id).map(check => check.kind).sort(), ["ci", "pull_request"]);
  } finally {
    await f.close();
  }
});

test("refresh authority, configuration and mirror remote validation", async () => {
  const f = await fixture();
  try {
    const view = await f.insights(f.viewer).insights(f.project.id);
    assert.deepEqual(view.modules, [{ pattern: "/src/api/", owners: ["@alice"] }, { pattern: "/docs/", owners: ["@bob", "@carol"] }]);
    await assert.rejects(f.insights(f.viewer).refreshMirror(f.project.id), deniedWith(403, "PROJECT_CAPABILITY_DENIED"));
    await assert.rejects(f.insights(f.dev).refreshMirror(f.project.id), deniedWith(403, "PROJECT_CAPABILITY_DENIED"));
    await assert.rejects(f.insights(f.outsider).insights(f.project.id), deniedWith(404, "TEAM_NOT_FOUND"));
    await assert.rejects(f.insights(f.outsider).refreshMirror(f.project.id), deniedWith(404, "TEAM_NOT_FOUND"));

    f.setSettings(null, null);
    await assert.rejects(f.insights(f.owner).refreshMirror(f.project.id), deniedWith(409, "HUB_REPOSITORY_NOT_CONFIGURED"));

    f.setSettings("https://example.invalid/other/repo.git");
    await assert.rejects(f.insights(f.reviewer).refreshMirror(f.project.id), deniedWith(502, "MIRROR_REMOTE_MISMATCH"));
    assert.equal((await f.insights(f.owner).insights(f.project.id)).sync.mirrorError, "MIRROR_REMOTE_MISMATCH");
    await assert.rejects(fetchMirror(f.mirror, "https://example.invalid/other/repo.git"), /MIRROR_REMOTE_MISMATCH/);

    f.setSettings(`${f.remote}/`);
    await f.insights(f.reviewer).refreshMirror(f.project.id);
    assert.equal((await f.insights(f.owner).insights(f.project.id)).sync.mirrorError, null);
  } finally {
    await f.close();
  }
});

test("concurrent refreshes share one run", async () => {
  const f = await fixture();
  try {
    const [first, second] = await Promise.all([f.insights(f.owner).refreshMirror(f.project.id), f.insights(f.reviewer).refreshMirror(f.project.id)]);
    assert.deepEqual(first.sync, second.sync);
    assert.ok(first.sync.mirrorFetchedAt);
  } finally {
    await f.close();
  }
});

test("HTTP routes enforce auth, validation and the envelope", async () => {
  const f = await fixture();
  try {
    const { task } = f.submitted("http", MISSING_SHA);
    const base = `/projects/${f.project.id}`;
    const read = await f.call("GET", `${base}/insights`, f.viewer);
    assert.equal(read.status, 200);
    assert.equal(read.body.code, 0);
    assert.deepEqual(Object.keys(read.body.data).sort(), ["checks", "modules", "remote", "sync", "taskModules"]);
    assert.ok(!JSON.stringify(read.body).includes(f.mirror));
    assert.equal((await f.call("GET", `${base}/insights`, f.outsider)).status, 404);
    assert.equal((await f.call("GET", "/projects/not-a-uuid/insights", f.owner)).body.message, "INVALID_INPUT");

    const denied = await f.call("PUT", `${base}/tasks/${task.id}/module`, f.dev, { pattern: "/src/api/" });
    assert.deepEqual([denied.status, denied.body.message], [403, "PROJECT_CAPABILITY_DENIED"]);
    assert.equal((await f.call("PUT", `${base}/tasks/${task.id}/module`, f.owner, { pattern: "/nope/" })).body.message, "MODULE_PATTERN_UNKNOWN");
    assert.equal((await f.call("PUT", `${base}/tasks/${task.id}/module`, f.owner, { pattern: "x".repeat(301) })).status, 400);
    assert.equal((await f.call("PUT", `${base}/tasks/${task.id}/module`, f.owner, { pattern: "/src/api/", extra: 1 })).status, 400);
    const set = await f.call("PUT", `${base}/tasks/${task.id}/module`, f.owner, { pattern: "/src/api/" });
    assert.deepEqual(set.body.data, { taskModules: { [task.id]: "/src/api/" } });

    assert.equal((await f.call("POST", `${base}/mirror/refresh`, f.viewer, {})).status, 403);
    assert.equal((await f.call("POST", `${base}/mirror/refresh`, f.owner, { force: true })).status, 400);
    const refreshed = await f.call("POST", `${base}/mirror/refresh`, f.owner, {});
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.data.sync.mirrorFetchedAt);
    assert.equal(refreshed.body.data.checks.find((check: { kind: string }) => check.kind === "scope").status, "unknown");
  } finally {
    await f.close();
  }
});

test("CODEOWNERS come from the fetched default branch, with a working-tree fallback", async () => {
  const f = await fixture();
  try {
    const original = [{ pattern: "/src/api/", owners: ["@alice"] }, { pattern: "/docs/", owners: ["@bob", "@carol"] }];
    // The remote ref does not exist: fall back to the mirror working tree.
    f.setSettings(f.remote, "not-fetched-yet");
    assert.deepEqual((await f.insights(f.owner).insights(f.project.id)).modules, original);
    f.setSettings(f.remote, "main");

    git(f.work, "switch", "-q", "main");
    write(f.work, ".github/CODEOWNERS", "/lib/ @dan\n");
    git(f.work, "commit", "-q", "-am", "owners");
    git(f.work, "push", "-q", "origin", "main");
    await f.insights(f.owner).refreshMirror(f.project.id);
    const refreshed = await f.insights(f.owner).insights(f.project.id);
    assert.deepEqual(refreshed.modules, [{ pattern: "/lib/", owners: ["@dan"] }]);
    assert.equal(git(f.mirror, "status", "--porcelain"), "", "mirror working tree is untouched");
    assert.match(execFileSync("cat", [path.join(f.mirror, ".github/CODEOWNERS")], { encoding: "utf8" }), /\/src\/api\//);
    const { task } = f.submitted("owners", MISSING_SHA);
    await assert.rejects(f.insights(f.owner).setTaskModule(f.project.id, task.id, "/src/api/"), deniedWith(400, "MODULE_PATTERN_UNKNOWN"));
    assert.deepEqual(await f.insights(f.owner).setTaskModule(f.project.id, task.id, "/lib/"), { [task.id]: "/lib/" });

    // A symlinked CODEOWNERS on the default branch is refused.
    git(f.work, "rm", "-q", ".github/CODEOWNERS");
    mkdirSync(path.join(f.work, ".github"), { recursive: true });
    symlinkSync("../shared.txt", path.join(f.work, ".github/CODEOWNERS"));
    git(f.work, "add", ".");
    git(f.work, "commit", "-q", "-m", "symlink owners");
    git(f.work, "push", "-q", "origin", "main");
    await f.insights(f.owner).refreshMirror(f.project.id);
    assert.deepEqual((await f.insights(f.owner).insights(f.project.id)).modules, []);
  } finally {
    await f.close();
  }
});

test("only checks of each task's latest submission are returned", async () => {
  const f = await fixture();
  try {
    const { task, submission } = f.submitted("superseded", MISSING_SHA);
    const newer = "d".repeat(40);
    f.db.prepare(
      `INSERT INTO hub_task_submissions(id,user_id,project_id,work_item_id,actor_id,branch,commit_sha,checks_status,checks_summary,task_semantic_revision,created_at)
       SELECT '11111111-1111-4111-8111-111111111111',user_id,project_id,work_item_id,actor_id,branch,?,checks_status,'',task_semantic_revision,created_at+10 FROM hub_task_submissions WHERE id=?`
    ).run(newer, submission.id);
    const insert = f.db.prepare("INSERT INTO hub_submission_checks(submission_id,user_id,project_id,kind,status,details_json,checked_at) VALUES(?,?,?,?,?,?,?)");
    insert.run(submission.id, f.owner.id, f.project.id, "pull_request", "attention", "{}", 1);
    insert.run("11111111-1111-4111-8111-111111111111", f.owner.id, f.project.id, "pull_request", "ok", "{}", 2);
    const view = await f.insights(f.owner).insights(f.project.id);
    assert.deepEqual(view.checks.map(check => [check.submissionId, check.taskId, check.kind]), [["11111111-1111-4111-8111-111111111111", task.id, "pull_request"]]);
    const stored = f.db.prepare("SELECT COUNT(*) AS n FROM hub_submission_checks").get() as { n: number };
    assert.equal(stored.n, 2, "older rows stay in the table");
  } finally {
    await f.close();
  }
});

test("refresh honours the cooldown and the analysis budget, and pair results are symmetric", async () => {
  const f = await fixture();
  try {
    const left = pushBranch(f.work, "pair-left", { "shared.txt": "left\n" });
    const right = pushBranch(f.work, "pair-right", { "shared.txt": "right\n" });
    const a = f.submitted("pair-l", left);
    const b = f.submitted("pair-r", right);
    const view = await f.insights(f.owner).refreshMirror(f.project.id);
    const peer = (id: string) => view.checks.find(check => check.submissionId === id && check.kind === "peer_conflict")!;
    assert.equal(peer(a.submission.id).status, "attention");
    assert.deepEqual((peer(a.submission.id).details.peers as Array<{ files: string[] }>)[0]!.files, ["shared.txt"]);
    assert.deepEqual((peer(b.submission.id).details.peers as Array<{ submissionId: string; files: string[] }>).map(p => [p.submissionId, p.files]), [[a.submission.id, ["shared.txt"]]]);

    const before = git(f.mirror, "rev-parse", "refs/remotes/origin/main");
    git(f.work, "switch", "-q", "main");
    write(f.work, "later.txt", "later\n");
    git(f.work, "add", ".");
    git(f.work, "commit", "-q", "-m", "later");
    git(f.work, "push", "-q", "origin", "main");
    await f.insights(f.owner, { cooldownMs: 60_000 }).refreshMirror(f.project.id);
    assert.equal(git(f.mirror, "rev-parse", "refs/remotes/origin/main"), before, "cooldown must skip the fetch");
    await f.insights(f.owner, { cooldownMs: 0 }).refreshMirror(f.project.id);
    assert.notEqual(git(f.mirror, "rev-parse", "refs/remotes/origin/main"), before);

    const starved = await f.insights(f.owner, { cooldownMs: 0, analysisBudgetMs: 0 }).refreshMirror(f.project.id);
    assert.ok(starved.checks.length > 0);
    for (const check of starved.checks) {
      assert.equal(check.status, "unknown");
      assert.deepEqual(check.details, { reason: "ANALYSIS_BUDGET_EXCEEDED" });
    }
  } finally {
    await f.close();
  }
});
