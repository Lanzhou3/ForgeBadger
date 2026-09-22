import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeWorktree, inspectWorktree, integrateWorktree, provisionWorktree, readDeliveryDiff } from "../src/services/collaboration/git-workspaces.js";
import { assertVerificationProcessStopped, getVerificationProcessState, recoverVerificationProcess } from "../src/services/collaboration/legacy-verification-recovery.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
}
let root: string;
let sourcePath: string;
let workspacesRoot: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-collaboration-runtime-")));
  sourcePath = path.join(root, "source");
  workspacesRoot = path.join(root, "workspaces");
  mkdirSync(sourcePath); mkdirSync(workspacesRoot);
  git(sourcePath, "init", "-q", "-b", "main");
  git(sourcePath, "config", "user.email", "runtime@fixture.test");
  git(sourcePath, "config", "user.name", "Fixture");
  writeFileSync(path.join(sourcePath, "app.txt"), "before\n");
  git(sourcePath, "add", "."); git(sourcePath, "commit", "-qm", "base");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function provision() { return provisionWorktree({ sourcePath, workspacesRoot, runId: randomUUID() }); }
function commit(workspacePath: string): string {
  writeFileSync(path.join(workspacePath, "app.txt"), "after\n");
  git(workspacePath, "add", "."); git(workspacePath, "commit", "-qm", "deliver");
  return git(workspacePath, "rev-parse", "HEAD");
}

describe("collaboration git workspaces", () => {
  it("isolates tasks, inspects committed changes, and fast-forwards an unchanged clean target", async () => {
    const workspace = await provision();
    assert.equal(workspace.targetBranch, "main");
    assert.match(workspace.branch, /^codex\/task-/);
    assert.equal(workspace.path, path.join(workspacesRoot, workspace.branch.slice("codex/task-".length)));
    assert.equal(readFileSync(path.join(sourcePath, "app.txt"), "utf8"), "before\n");
    const head = commit(workspace.path);
    const state = await inspectWorktree(workspace);
    assert.equal(state.commit, head);
    assert.equal(state.dirty, false);
    assert.deepEqual(state.files, [{ path: "app.txt", status: "M" }]);
    assert.match(await readDeliveryDiff({ ...workspace, filePath: "app.txt" }), /\+after/);
    assert.equal(readFileSync(path.join(sourcePath, "app.txt"), "utf8"), "before\n");
    assert.deepEqual(await integrateWorktree({ ...workspace, sourcePath, expectedCommit: head }), { commit: head });
    assert.equal(git(sourcePath, "rev-parse", "HEAD"), head);
    await closeWorktree({ ...workspace, sourcePath });
  });

  it("preserves dirty source files during provision and rejects dirty integration or close", async () => {
    writeFileSync(path.join(sourcePath, "app.txt"), "unsaved source\n");
    const workspace = await provision();
    const head = commit(workspace.path);
    await assert.rejects(integrateWorktree({ ...workspace, sourcePath, expectedCommit: head }), /clean|dirty/i);
    assert.equal(readFileSync(path.join(sourcePath, "app.txt"), "utf8"), "unsaved source\n");
    writeFileSync(path.join(workspace.path, "untracked"), "keep");
    assert.equal((await inspectWorktree(workspace)).dirty, true);
    await assert.rejects(closeWorktree({ ...workspace, sourcePath }), /clean|dirty/i);
    assert.equal(readFileSync(path.join(workspace.path, "untracked"), "utf8"), "keep");
  });

  it("rejects stale HEAD, source divergence and branch changes without altering source", async () => {
    const workspace = await provision();
    const head = commit(workspace.path);
    await assert.rejects(integrateWorktree({ ...workspace, sourcePath, expectedCommit: workspace.baseCommit }), /commit|HEAD|revision/i);
    writeFileSync(path.join(sourcePath, "another"), "source commit");
    git(sourcePath, "add", "."); git(sourcePath, "commit", "-qm", "advance");
    const advanced = git(sourcePath, "rev-parse", "HEAD");
    await assert.rejects(integrateWorktree({ ...workspace, sourcePath, expectedCommit: head }), /base|diverg|revision/i);
    assert.equal(git(sourcePath, "rev-parse", "HEAD"), advanced);
    git(sourcePath, "switch", "-qc", "another-branch");
    await assert.rejects(integrateWorktree({ ...workspace, sourcePath, expectedCommit: head }), /branch/i);
  });

  it("fails closed for symlink roots, path traversal, existing targets, subdirectories and locks", async () => {
    const alias = path.join(root, "alias"); symlinkSync(sourcePath, alias, "dir");
    await assert.rejects(provisionWorktree({ sourcePath: alias, workspacesRoot, runId: randomUUID() }), /canonical|symlink/i);
    await assert.rejects(provisionWorktree({ sourcePath, workspacesRoot, runId: "../escape" }), /run|UUID/i);
    const runId = randomUUID();
    await provisionWorktree({ sourcePath, workspacesRoot, runId });
    await assert.rejects(provisionWorktree({ sourcePath, workspacesRoot, runId }), /exist/i);
    const child = path.join(sourcePath, "child"); mkdirSync(child);
    await assert.rejects(provisionWorktree({ sourcePath: child, workspacesRoot, runId: randomUUID() }), /root|top/i);
    mkdirSync(path.join(sourcePath, ".git", "forgebadger-collaboration.lock"));
    await assert.rejects(provision(), /busy|lock/i);
  });

  it("bounds diff output and refuses traversal or symlink escaping delivery files", async () => {
    const workspace = await provision();
    commit(workspace.path);
    await assert.rejects(readDeliveryDiff({ ...workspace, filePath: "../source/app.txt" }), /path|escape/i);
    symlinkSync(path.join(sourcePath, "app.txt"), path.join(workspace.path, "escape"));
    await assert.rejects(readDeliveryDiff({ ...workspace, filePath: "escape" }), /path|escape/i);
    writeFileSync(path.join(workspace.path, "app.txt"), "x".repeat(200_000));
    git(workspace.path, "add", "app.txt"); git(workspace.path, "commit", "-qm", "large change");
    const bounded = await readDeliveryDiff({ ...workspace, filePath: "app.txt" });
    assert.ok(bounded.length < 132_000);
    assert.match(bounded, /Diff truncated/);
  });
  it("preserves ignored source files during integration and ignored workspace files on close", async () => {
    writeFileSync(path.join(sourcePath, ".gitignore"), "ignored.txt\n");
    git(sourcePath, "add", ".gitignore"); git(sourcePath, "commit", "-qm", "ignore rule");
    const workspace = await provision();
    writeFileSync(path.join(workspace.path, "ignored.txt"), "keep workspace");
    await assert.rejects(closeWorktree({ ...workspace, sourcePath }), /clean|dirty/i);
    git(workspace.path, "add", "-f", "ignored.txt"); git(workspace.path, "commit", "-qm", "tracked now");
    const expectedCommit = git(workspace.path, "rev-parse", "HEAD");
    writeFileSync(path.join(sourcePath, "ignored.txt"), "keep source");
    await assert.rejects(integrateWorktree({ ...workspace, sourcePath, expectedCommit }));
    assert.equal(readFileSync(path.join(sourcePath, "ignored.txt"), "utf8"), "keep source");
    assert.equal(git(sourcePath, "rev-parse", "HEAD"), workspace.baseCommit);
  });

  it("rejects concurrent mutations on the same repository", async () => {
    const results = await Promise.allSettled([provision(), provision()]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && /busy|lock/i.test(String(rejected.reason)));
  });

  it("does not execute repository hooks or checkout/diff filters", async () => {
    const marker = path.join(root, "unrequested-execution");
    const script = path.join(root, "danger.cjs");
    writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`);
    const hook = path.join(sourcePath, ".git", "hooks", "post-checkout");
    writeFileSync(hook, `#!/bin/sh\nnode "${script}"\n`); chmodSync(hook, 0o700);
    writeFileSync(path.join(sourcePath, ".gitattributes"), "app.txt filter=unsafe diff=unsafe\n");
    git(sourcePath, "add", ".gitattributes"); git(sourcePath, "commit", "-qm", "attributes");
    git(sourcePath, "config", "filter.unsafe.smudge", `node "${script}"`);
    git(sourcePath, "config", "filter.unsafe.clean", `node "${script}"`);
    git(sourcePath, "config", "filter.unsafe.required", "true");
    git(sourcePath, "config", "diff.unsafe.textconv", `node "${script}"`);
    const workspace = await provision();
    assert.equal(existsSync(marker), false);
    await inspectWorktree(workspace);
    await readDeliveryDiff({ ...workspace, filePath: "app.txt" });
    assert.equal(existsSync(marker), false);
  });

  it("rejects a workspace replaced by a symlink before inspection", async () => {
    const workspace = await provision();
    rmSync(workspace.path, { recursive: true });
    symlinkSync(sourcePath, workspace.path, "dir");
    await assert.rejects(inspectWorktree(workspace), /canonical|symlink/i);
  });

  it("reclaims only known-dead idle Git leases and preserves live or ambiguous owners", async () => {
    const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const deadPid = exited.pid!;
    await new Promise((resolve) => exited.once("exit", resolve));
    assert.throws(() => process.kill(deadPid, 0));
    const lock = path.join(sourcePath, ".git", "forgebadger-collaboration.lock");
    const writeLease = (ownerPid: number, childPid: number | null, phase: string) => {
      mkdirSync(lock, { mode: 0o700 });
      writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ path: lock, token: randomUUID(), ownerPid, childPid, phase }), { mode: 0o600 });
    };
    writeLease(deadPid, null, "idle");
    await provision();
    assert.equal(existsSync(lock), false);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      for (const lease of [
        { ownerPid: process.pid, childPid: null, phase: "idle" },
        { ownerPid: deadPid, childPid: child.pid!, phase: "running" },
        { ownerPid: deadPid, childPid: null, phase: "spawning" },
        { ownerPid: deadPid, childPid: null, phase: "running" }
      ]) {
        writeLease(lease.ownerPid, lease.childPid, lease.phase);
        const initial = readFileSync(path.join(lock, "owner.json"), "utf8");
        await assert.rejects(provision(), /busy|lock/i);
        assert.equal(readFileSync(path.join(lock, "owner.json"), "utf8"), initial);
        process.kill(process.pid, 0); process.kill(child.pid!, 0);
        rmSync(lock, { recursive: true });
      }
    } finally { child.kill("SIGKILL"); await new Promise((resolve) => child.once("exit", resolve)); }
  });

  it("checks authorization immediately before final merge and preserves source on denial", async () => {
    const workspace = await provision();
    const expectedCommit = commit(workspace.path);
    let checks = 0;
    await assert.rejects(integrateWorktree({ ...workspace, sourcePath, expectedCommit, authorize: () => {
      checks++;
      assert.equal(git(sourcePath, "rev-parse", "HEAD"), workspace.baseCommit);
      throw new Error("authority revoked before merge");
    } }), /authority revoked/);
    assert.equal(checks, 1);
    assert.equal(git(sourcePath, "rev-parse", "HEAD"), workspace.baseCommit);
    await integrateWorktree({ ...workspace, sourcePath, expectedCommit, authorize: () => { checks++; } });
    assert.equal(checks, 2);
    assert.equal(git(sourcePath, "rev-parse", "HEAD"), expectedCommit);
  });

});

describe("fresh workspace reconciliation", () => {
  it("merges a prior commit onto the latest base without touching dirty old/source worktrees", async () => {
    const old = await provision(); const prior = commit(old.path);
    writeFileSync(path.join(old.path, "private-draft.txt"), "keep old work");
    writeFileSync(path.join(sourcePath, "source.txt"), "new source");
    git(sourcePath, "add", "."); git(sourcePath, "commit", "-qm", "advance source");
    const latest = git(sourcePath, "rev-parse", "HEAD");
    writeFileSync(path.join(sourcePath, "source-draft.txt"), "keep source work");
    const fresh = await provisionWorktree({ sourcePath, workspacesRoot, runId: randomUUID(), mergeCommit: prior });
    assert.equal(fresh.baseCommit, latest);
    assert.equal(readFileSync(path.join(fresh.path, "app.txt"), "utf8"), "after\n");
    assert.equal(readFileSync(path.join(fresh.path, "source.txt"), "utf8"), "new source");
    assert.equal(readFileSync(path.join(old.path, "private-draft.txt"), "utf8"), "keep old work");
    assert.equal(readFileSync(path.join(sourcePath, "source-draft.txt"), "utf8"), "keep source work");
    assert.equal(git(sourcePath, "rev-parse", "HEAD"), latest);
    assert.equal((await inspectWorktree(fresh)).dirty, false);
    assert.deepEqual((await inspectWorktree(fresh)).conflicts, []);
  });

  it("keeps real merge conflicts in a new usable workspace for explicit resolution", async () => {
    const old = await provision(); const prior = commit(old.path);
    writeFileSync(path.join(sourcePath, "app.txt"), "source changed same line\n");
    git(sourcePath, "add", "."); git(sourcePath, "commit", "-qm", "conflict source");
    const latest = git(sourcePath, "rev-parse", "HEAD");
    const fresh = await provisionWorktree({ sourcePath, workspacesRoot, runId: randomUUID(), mergeCommit: prior });
    const status = await inspectWorktree(fresh);
    assert.equal(status.dirty, true); assert.deepEqual(status.conflicts, ["app.txt"]);
    assert.equal(git(sourcePath, "rev-parse", "HEAD"), latest);
    assert.equal(git(old.path, "rev-parse", "HEAD"), prior);
    assert.equal(readFileSync(path.join(sourcePath, "app.txt"), "utf8"), "source changed same line\n");
  });

  it("checks authority before provisioning and rejects a revoked reconciliation", async () => {
    const prior = git(sourcePath, "rev-parse", "HEAD");
    await assert.rejects(provisionWorktree({ sourcePath, workspacesRoot, runId: randomUUID(), mergeCommit: prior, authorize: () => { throw new Error("revoked"); } }), /revoked/);
    assert.equal(readdirSync(workspacesRoot).length, 0);
  });
});

it('reconciliation disables repository merge drivers and commit hooks',async()=>{
  const marker=path.join(root,'driver-ran');
  writeFileSync(path.join(sourcePath,'.gitattributes'),'app.txt merge=unsafe\n');
  git(sourcePath,'add','.');git(sourcePath,'commit','-qm','attributes');
  const old=await provision(),selected=commit(old.path);
  writeFileSync(path.join(sourcePath,'app.txt'),'source conflict\n');git(sourcePath,'add','.');git(sourcePath,'commit','-qm','source');
  git(sourcePath,'config','merge.unsafe.driver',`touch '${marker}'`);
  const hook=path.join(sourcePath,'.git','hooks','post-merge');writeFileSync(hook,`#!/bin/sh\ntouch '${marker}'\n`);chmodSync(hook,0o700);
  const fresh=await provisionWorktree({sourcePath,workspacesRoot,runId:randomUUID(),mergeCommit:selected});
  assert.deepEqual((await inspectWorktree(fresh)).conflicts,['app.txt']);assert.equal(existsSync(marker),false);
});
