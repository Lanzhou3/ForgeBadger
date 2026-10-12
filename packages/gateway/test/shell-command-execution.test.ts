import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";

import { InMemorySessionManager } from "../src/services/session-manager.js";
import { SessionWriterLeases } from "../src/services/session-writer-leases.js";
import type { TerminalBackendClient } from "../src/services/terminal-backend.js";
import {
  COPILOT_SHELL_NAME,
  closeCopilotShell,
  openCopilotShell,
  runShellCommand,
  runShellCommandInSession,
  stripAnsi
} from "../src/services/shell-command-execution.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";

interface FakeBackendOptions {
  output?: string;
  exitCode?: number;
  delaySentinel?: boolean;
  onStage?: (payload: string) => void;
  onEnter?: () => void;
  onKill?: () => void;
  /** Mutable liveness flag (daemon restart / process exit simulation). */
  aliveRef?: { alive: boolean };
}

function fakeBackend(options: FakeBackendOptions = {}): TerminalBackendClient {
  let stagedPayload = "";
  let pollCount = 0;
  const live = new Set<string>();
  return {
    async createSession(input) { live.add(input.name); if (options.aliveRef) options.aliveRef.alive = true; },
    async killSession(name) { options.onKill?.(); live.delete(name); },
    async capturePane() {
      pollCount += 1;
      const sentinelMatch = stagedPayload.match(/__FB_DONE_[a-f0-9]+/);
      const sentinel = sentinelMatch?.[0] ?? "__FB_DONE_test";
      const output = options.output ?? "hello world";
      const code = options.exitCode ?? 0;
      if (options.delaySentinel && pollCount === 1) return "no sentinel yet";
      return `${output}\n${sentinel}:${code}\n$ `;
    },
    async listSessions() {
      return [];
    },
    async hasSession(name) {
      return live.has(name) && (options.aliveRef?.alive ?? true);
    },
    async showEnvironment() {
      return {};
    },
    async sendInput(_name: string, data: string) {
      stagedPayload = data;
      options.onStage?.(data);
    },
    async pressEnter() {
      options.onEnter?.();
    }
  };
}

describe("stripAnsi", () => {
  it("removes CSI escape sequences", () => {
    assert.equal(stripAnsi("\x1b[32mhello\x1b[0m"), "hello");
  });

  it("removes OSC sequences terminated by BEL", () => {
    assert.equal(stripAnsi("\x1b]0;title\x07hello"), "hello");
  });

  it("removes carriage returns", () => {
    assert.equal(stripAnsi("hello\r\nworld"), "hello\nworld");
  });
});

describe("runShellCommand (ephemeral)", () => {
  it('keeps an ephemeral session alive when the owner takes over before cancellation', async () => {
    const input = ephemeralInput();
    const repo = new SessionRepository(input.db, input.userId);
    const controller = new AbortController();
    const manager = new InMemorySessionManager(fakeBackend({ onEnter() {
      const row = repo.list().find(row => row.name === 'Copilot command')!;
      manager.takeoverSession(input.userId, row.id);
      controller.abort();
    } }), undefined, undefined, { db: input.db });
    const result = await runShellCommand({ ...input, sessionManager: manager, projectRoot: WORKDIR,
      command: 'printf harmless', signal: controller.signal });
    assert.equal(result.userTookOver, true);
    assert.equal(await manager.hasLiveTerminal(result.sessionId!), true);
    assert.ok(repo.getById(result.sessionId!));
    await manager.stopSession(result.sessionId!);
  });
  it('claims stopping before yielding so a later takeover cannot claim the dying Shell', async () => {
    const input = ephemeralInput();
    const repo = new SessionRepository(input.db, input.userId);
    const controller = new AbortController();
    const manager = new InMemorySessionManager(fakeBackend({ onEnter() { controller.abort(); }, onKill() {
      const row = repo.list().find(row => row.name === 'Copilot command')!;
      assert.throws(() => manager.takeoverSession(input.userId, row.id), /SESSION_STOP_IN_PROGRESS/);
    } }), undefined, undefined, { db: input.db });
    const before = repo.list().length;
    await assert.rejects(runShellCommand({ ...input, sessionManager: manager, projectRoot: WORKDIR,
      command: 'printf harmless', signal: controller.signal }), /abort/i);
    assert.equal(repo.list().length, before);
  });
  it('stops the actual terminal on cancellation after submission', async () => {
    const controller = new AbortController();
    const manager = new InMemorySessionManager(fakeBackend({ onEnter() { controller.abort(); } }));
    const input = ephemeralInput();
    const before = new SessionRepository(input.db, input.userId).list().length;
    await assert.rejects(runShellCommand({ ...input, sessionManager: manager, projectRoot: WORKDIR,
      command: 'printf harmless', signal: controller.signal }), /abort/i);
    assert.equal(new SessionRepository(input.db, input.userId).list().length, before);
  });
  it("runs with a durable writer lease and removes the temporary row afterwards", async () => {
    const input = ephemeralInput();
    const repo = new SessionRepository(input.db, input.userId);
    const before = repo.list().length;
    const manager = new InMemorySessionManager(fakeBackend(), undefined, undefined, { db: input.db });
    const result = await runShellCommand({ ...input, sessionManager: manager, projectRoot: WORKDIR, command: "echo hello" });
    assert.equal(result.exitCode, 0);
    assert.equal(repo.list().length, before);
    assert.equal(await manager.hasLiveTerminal(result.sessionId!), false);
  });
  it("keeps a staged POSIX script private and removes it after completion", { skip: process.platform === "win32" }, async () => {
    let scriptPath = "";
    const command = "printf '你好\nquoted'";
    const manager = new InMemorySessionManager(fakeBackend({ onStage(payload) {
      scriptPath = /; \. '([^']+)'/.exec(payload)![1]!;
      assert.equal(statSync(scriptPath).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(scriptPath)).mode & 0o777, 0o700);
      assert.equal(readFileSync(scriptPath, "utf8"), command + "\n");
    } }));
    assert.equal((await runShellCommand({ ...ephemeralInput(), sessionManager: manager, projectRoot: WORKDIR, command })).exitCode, 0);
    assert.equal(existsSync(dirname(scriptPath)), false);
  });
  it("captures exit code 0 and output for a successful command", async () => {
    const manager = new InMemorySessionManager(
      fakeBackend({ output: "hello world", exitCode: 0 })
    );

    const result = await runShellCommand({
      ...ephemeralInput(),
      sessionManager: manager,
      projectRoot: "/tmp",
      command: "echo hello world"
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.userTookOver, false);
    assert.equal(result.exitCode, 0);
    assert.ok(result.output.includes("hello world"));
  });

  it("captures a non-zero exit code", async () => {
    const manager = new InMemorySessionManager(
      fakeBackend({ output: "error output", exitCode: 1 })
    );

    const result = await runShellCommand({
      ...ephemeralInput(),
      sessionManager: manager,
      projectRoot: "/tmp",
      command: "exit 1"
    });

    assert.equal(result.exitCode, 1);
    assert.ok(result.output.includes("error output"));
  });

  it("polls until the sentinel appears", async () => {
    const manager = new InMemorySessionManager(
      fakeBackend({ output: "delayed output", exitCode: 0, delaySentinel: true })
    );

    const result = await runShellCommand({
      ...ephemeralInput(),
      sessionManager: manager,
      projectRoot: "/tmp",
      command: "echo delayed output"
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.output.includes("delayed output"));
  });

  it("returns timedOut when the sentinel never appears", async () => {
    const neverBackend: TerminalBackendClient = {
      ...fakeBackend({}),
      async capturePane() {
        return "still running...\n$ ";
      }
    };
    const manager = new InMemorySessionManager(neverBackend);

    const result = await runShellCommand({
      ...ephemeralInput(),
      sessionManager: manager,
      projectRoot: "/tmp",
      command: "sleep 100",
      timeoutMs: 50
    });

    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
  });

  it("rejects an empty command", async () => {
    const manager = new InMemorySessionManager(fakeBackend({}));
    await assert.rejects(
      () =>
        runShellCommand({
          ...ephemeralInput(),
          sessionManager: manager,
          projectRoot: "/tmp",
          command: "   "
        }),
      /SHELL_COMMAND_EMPTY/
    );
  });

  it("rejects a command that exceeds the max length", async () => {
    const manager = new InMemorySessionManager(fakeBackend({}));
    await assert.rejects(
      () =>
        runShellCommand({
          ...ephemeralInput(),
          sessionManager: manager,
          projectRoot: "/tmp",
          command: "a".repeat(4001)
        }),
      /SHELL_COMMAND_TOO_LONG/
    );
  });

  it("strips ANSI from the captured output before sentinel matching", async () => {
    let stagedPayload = "";
    const backend: TerminalBackendClient = {
      ...fakeBackend({}),
      async capturePane() {
        const sentinelMatch = stagedPayload.match(/__FB_DONE_[a-f0-9]+/);
        const sentinel = sentinelMatch?.[0] ?? "__FB_DONE_test";
        return `\x1b[32mhello\x1b[0m\n\x1b[32m${sentinel}:0\x1b[0m\n$ `;
      },
      async sendInput(_name: string, data: string) {
        stagedPayload = data;
      }
    };
    const manager = new InMemorySessionManager(backend);

    const result = await runShellCommand({
      ...ephemeralInput(),
      sessionManager: manager,
      projectRoot: "/tmp",
      command: "echo hello"
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.output.includes("hello"));
  });

  it("accepts a progress sink and still returns complete output", async () => {
    let stagedPayload = "";
    let polls = 0;
    const backend: TerminalBackendClient = {
      ...fakeBackend({}),
      async capturePane() {
        polls += 1;
        const sentinelMatch = stagedPayload.match(/__FB_DONE_[a-f0-9]+/);
        const sentinel = sentinelMatch?.[0] ?? "__FB_DONE_test";
        if (polls < 3) return `line ${polls}\n$ `;
        return `line 1\nline 2\nline 3\n${sentinel}:0\n$ `;
      },
      async sendInput(_name: string, data: string) {
        stagedPayload = data;
      }
    };
    const manager = new InMemorySessionManager(backend);

    const result = await runShellCommand({
      ...ephemeralInput(),
      sessionManager: manager,
      projectRoot: "/tmp",
      command: "long job",
      timeoutMs: 5_000,
      onProgress: () => undefined
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.output.includes("line 3"));
  });
});

// ---------------------------------------------------------------------------
// Persistent Copilot shell (Phase 2)
// ---------------------------------------------------------------------------

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); });

function ephemeralInput() {
  const db = testDb();
  const { user, project } = makeCopilotShellFixture(db);
  return { db, userId: user.id, projectId: project.id };
}

function testDb(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(drizzle(db), {
    migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url))
  });
  return db;
}

const WORKDIR = "/tmp";

function makeCopilotShellFixture(
  db: Database.Database,
  sessionId = "s-copilot",
  overrides: { name?: string } = {}
) {
  const user = new UserRepository(db).create("shell@test.dev", "hash");
  const project = new ProjectRepository(db, user.id).create({
    name: "p",
    path: WORKDIR,
    aiTool: "claude"
  });
  const repo = new SessionRepository(db, user.id);
  repo.upsert({
    id: sessionId,
    userId: user.id,
    projectId: project.id,
    name: overrides.name ?? COPILOT_SHELL_NAME,
    aiTool: "terminal",
    modelId: null,
    status: "running",
    attachToken: "tok",
    runtimeSessionName: null,
    workingDir: WORKDIR,
    credentialMode: "host_environment",
    apiKeyId: null,
    lastPrompt: null,
    lastActive: new Date(),
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  return { user, project, repo };
}

async function startInMemoryShell(
  manager: InMemorySessionManager,
  userId: string,
  sessionId: string
): Promise<void> {
  await manager.createSession({
    userId,
    sessionId,
    launchPlan: {
      command: "sh",
      args: [],
      cwd: WORKDIR,
      env: {},
      secretEnvNames: [],
      credentialMode: "host_environment"
    }
  });
}

describe("runShellCommandInSession (persistent)", () => {
  it("stops the command if capture fails after submission", async () => {
    const db = testDb();
    const { user, project, repo } = makeCopilotShellFixture(db, "error-capture");
    const manager = new InMemorySessionManager({ ...fakeBackend(), async capturePane() {
      throw new Error("capture failed");
    } }, undefined, undefined, { db });
    await startInMemoryShell(manager, user.id, "error-capture");
    const runtime = manager.getSession("error-capture")!.runtimeSessionName;
    await assert.rejects(runShellCommandInSession({ db, userId: user.id, projectId: project.id,
      sessionId: "error-capture", sessionManager: manager, command: "sleep 10"
    }), /capture failed/);
    assert.equal(await manager.hasRuntimeTerminal(runtime), false);
    assert.equal(repo.getById("error-capture")?.status, "exited");
  });
  it("completes the command when the progress sink keeps failing", async () => {
    const db = testDb();
    const { user, project } = makeCopilotShellFixture(db, "progress-shell");
    let staged = "", polls = 0;
    const manager = new InMemorySessionManager({ ...fakeBackend(),
      async sendInput(_name, data) { staged = data; },
      async capturePane() {
        polls += 1;
        const sentinel = staged.match(/__FB_DONE_[a-f0-9]+/)?.[0] ?? "__FB_DONE_test";
        if (polls < 18) return `line ${polls}\n$ `;
        return `line 1\nline 2\nline 3\n${sentinel}:0\n$ `;
      }
    }, undefined, undefined, { db });
    await startInMemoryShell(manager, user.id, "progress-shell");
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      // A failing emit (e.g. a busy event DB) must never take down the shell.
      const result = await runShellCommandInSession({ db, userId: user.id, projectId: project.id,
        sessionId: "progress-shell", sessionManager: manager, command: "long job",
        timeoutMs: 10_000,
        onProgress: () => { throw new Error("emit failed"); }
      });
      assert.equal(result.timedOut, false);
      assert.equal(result.exitCode, 0);
      assert.ok(result.output.includes("line 3"));
    } finally {
      console.warn = originalWarn;
    }
    // The shell survives, and the failure is logged exactly once, code-only.
    assert.ok(manager.getSession("progress-shell"));
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0]), /progress sink failed/);
    assert.deepEqual(warnings[0]?.[1], { code: "SHELL_PROGRESS_SINK_FAILED" });
  });
  it("releases the lease and clears the in-flight flag when the session leaves the manager mid-command", async () => {
    const db = testDb();
    const { user, project, repo } = makeCopilotShellFixture(db, "reconciled-shell");
    const aliveRef = { alive: true };
    let removed = false;
    const manager = new InMemorySessionManager({ ...fakeBackend({ aliveRef }),
      async capturePane() {
        if (!removed) {
          removed = true;
          // Simulate a reconcile dropping the session from the in-memory map.
          aliveRef.alive = false;
          await manager.reconcileSessionStatus("reconciled-shell");
        }
        throw new Error("capture failed");
      }
    }, undefined, undefined, { db });
    await startInMemoryShell(manager, user.id, "reconciled-shell");
    repo.update("reconciled-shell", { runtimeSessionName: manager.getSession("reconciled-shell")!.runtimeSessionName });
    const input = { db, userId: user.id, projectId: project.id, sessionId: "reconciled-shell", sessionManager: manager, command: "sleep 10" };
    await assert.rejects(runShellCommandInSession(input), /capture failed/);
    // The DB-fallback stop was confirmed and the row is exited.
    assert.equal(repo.getById("reconciled-shell")?.status, "exited");
    // The writer lease was released: the same workspace can be leased again.
    const lease = manager.acquireWriterLease({ userId: user.id, sessionId: "reconciled-shell", workspace: WORKDIR });
    manager.releaseWriterLease(lease);
    // The in-flight flag was cleared: a retry fails on liveness, not the guard.
    await assert.rejects(runShellCommandInSession(input), /SHELL_SESSION_DEAD/);
  });
  it("quarantines the shell when the session left the manager and shutdown cannot be confirmed", async () => {
    const db = testDb();
    const { user, project, repo } = makeCopilotShellFixture(db, "orphaned-shell");
    const aliveRef = { alive: true };
    let removed = false;
    const manager = new InMemorySessionManager({ ...fakeBackend({ aliveRef }),
      async killSession() { throw new Error("kill failed"); },
      async capturePane() {
        if (!removed) {
          removed = true;
          aliveRef.alive = false;
          await manager.reconcileSessionStatus("orphaned-shell");
          aliveRef.alive = true;
        }
        throw new Error("capture failed");
      }
    }, undefined, undefined, { db });
    await startInMemoryShell(manager, user.id, "orphaned-shell");
    repo.update("orphaned-shell", { runtimeSessionName: manager.getSession("orphaned-shell")!.runtimeSessionName });
    const input = { db, userId: user.id, projectId: project.id, sessionId: "orphaned-shell", sessionManager: manager, command: "sleep 10" };
    await assert.rejects(runShellCommandInSession(input), /SHELL_SESSION_STOP_UNCONFIRMED/);
    assert.equal(repo.getById("orphaned-shell")?.status, "error");
    assert.equal(repo.getById("orphaned-shell")?.errorMessage, "SHELL_SESSION_STOP_UNCONFIRMED");
    await assert.rejects(runShellCommandInSession(input), /SHELL_SESSION_STOP_UNCONFIRMED/);
  });
  it("quarantines a shell when shutdown cannot be confirmed", async () => {
    const db = testDb();
    const { user, project, repo } = makeCopilotShellFixture(db, "unconfirmed-shell");
    const manager = new InMemorySessionManager({ ...fakeBackend(),
      async killSession() { throw new Error("kill failed"); },
      async capturePane() { return "still working"; }
    }, undefined, undefined, { db });
    await startInMemoryShell(manager, user.id, "unconfirmed-shell");
    const input = { db, userId: user.id, projectId: project.id, sessionId: "unconfirmed-shell", sessionManager: manager, command: "sleep 10", timeoutMs: 50 };
    await assert.rejects(runShellCommandInSession(input), /SHELL_SESSION_STOP_UNCONFIRMED/);
    assert.equal(repo.getById("unconfirmed-shell")?.status, "error");
    await assert.rejects(runShellCommandInSession(input), /SHELL_SESSION_STOP_UNCONFIRMED/);
    await assert.rejects(openCopilotShell(db, user.id, manager, project), /SHELL_SESSION_STOP_UNCONFIRMED/);
    await assert.rejects(runShellCommand({ ...input, projectRoot: project.path }), /SHELL_SESSION_STOP_UNCONFIRMED/);
  });
  it("stops a timed-out shell and preserves its last output", async () => {
    const db = testDb();
    const { user, project, repo } = makeCopilotShellFixture(db, "timeout-shell");
    const manager = new InMemorySessionManager({ ...fakeBackend(), async capturePane() { return "still working"; } }, undefined, undefined, { db });
    await startInMemoryShell(manager, user.id, "timeout-shell");
    const runtime = manager.getSession("timeout-shell")!.runtimeSessionName;
    const result = await runShellCommandInSession({ db, userId: user.id, projectId: project.id, sessionId: "timeout-shell", sessionManager: manager, command: "sleep 10", timeoutMs: 50 });
    assert.equal(result.timedOut, true);
    assert.match(result.output, /still working/);
    assert.equal(await manager.hasRuntimeTerminal(runtime), false);
    assert.equal(repo.getById("timeout-shell")?.status, "exited");
  });
  it("allows retry after a workspace lease conflict", async () => {
    const db = testDb();
    const { user, project } = makeCopilotShellFixture(db, "busy-shell");
    const manager = new InMemorySessionManager(fakeBackend(), undefined, undefined, { db });
    await startInMemoryShell(manager, user.id, "busy-shell");
    const lease = manager.acquireWriterLease({ userId: user.id, sessionId: "busy-shell", workspace: WORKDIR });
    const input = { db, userId: user.id, projectId: project.id, sessionId: "busy-shell", sessionManager: manager, command: "echo retry" };
    try {
      await assert.rejects(runShellCommandInSession(input), /SESSION_WRITER_BUSY/);
      manager.releaseWriterLease(lease);
      assert.equal((await runShellCommandInSession(input)).exitCode, 0);
    } finally { db.close(); }
  });

  it("ignores echoed sentinel until a numeric completion record arrives", async () => {
    const db = testDb();
    const { user, project } = makeCopilotShellFixture(db, "echo-shell");
    let staged = "", polls = 0;
    const manager = new InMemorySessionManager({ ...fakeBackend(),
      async sendInput(_name, data) { staged = data; },
      async capturePane() {
        polls++;
        const sentinel = staged.match(/__FB_DONE_[a-f0-9]+/)![0];
        return `${staged}\n${polls > 1 ? `finished\n${sentinel}:7\n` : ""}`;
      }
    });
    await startInMemoryShell(manager, user.id, "echo-shell");
    try {
      const result = await runShellCommandInSession({ db, userId: user.id, projectId: project.id, sessionId: "echo-shell", sessionManager: manager, command: "echo finished" });
      assert.equal(result.exitCode, 7);
      assert.ok(polls > 1);
      assert.match(result.output, /finished/);
    } finally { db.close(); }
  });
  it("runs a command in the existing shell and leaves it alive", async () => {
    const db = testDb();
    const { user, project } = makeCopilotShellFixture(db, "s-copilot");
    const manager = new InMemorySessionManager(
      fakeBackend({ output: "persisted output", exitCode: 0 })
    );
    await startInMemoryShell(manager, user.id, "s-copilot");

    const result = await runShellCommandInSession({
      db,
      userId: user.id,
      sessionManager: manager,
      projectId: project.id,
      sessionId: "s-copilot",
      command: "echo persisted output"
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.output.includes("persisted output"));
    assert.equal(result.sessionId, "s-copilot");
    // The shell must survive the command.
    assert.ok(manager.getSession("s-copilot"));
  });

  it("rejects a second command while one is in flight", async () => {
    const db = testDb();
    const { user, project } = makeCopilotShellFixture(db, "s-copilot");
    let staged = false;
    let stagedPayload = "";
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backend: TerminalBackendClient = {
      ...fakeBackend({}),
      async sendInput(_name: string, data: string) {
        stagedPayload = data;
        staged = true;
      },
      async capturePane() {
        await gate;
        const sentinelMatch = stagedPayload.match(/__FB_DONE_[a-f0-9]+/);
        return `${sentinelMatch?.[0] ?? ""}:0\n$ `;
      }
    };
    const manager = new InMemorySessionManager(backend);
    await startInMemoryShell(manager, user.id, "s-copilot");

    const first = runShellCommandInSession({
      db,
      userId: user.id,
      sessionManager: manager,
      projectId: project.id,
      sessionId: "s-copilot",
      command: "first",
      timeoutMs: 5_000
    });
    while (!staged) await new Promise((r) => setTimeout(r, 1));
    await assert.rejects(
      () =>
        runShellCommandInSession({
          db,
          userId: user.id,
          sessionManager: manager,
          projectId: project.id,
          sessionId: "s-copilot",
          command: "second"
        }),
      /SHELL_COMMAND_IN_FLIGHT/
    );
    release?.();
    await first;
    // After completion the shell accepts commands again.
    const again = await runShellCommandInSession({
      db,
      userId: user.id,
      sessionManager: manager,
      projectId: project.id,
      sessionId: "s-copilot",
      command: "after"
    });
    assert.equal(again.exitCode, 0);
  });

  it("transfers control without killing the owner shell on takeover", async () => {
    const db = testDb();
    const { user, project } = makeCopilotShellFixture(db, "s-copilot");
    const backend: TerminalBackendClient = {
      ...fakeBackend({}),
      async pressEnter() {
        // The owner takes over while the command runs.
        manager.takeoverSession(user.id, "s-copilot");
      }
    };
    const manager = new InMemorySessionManager(backend);
    await startInMemoryShell(manager, user.id, "s-copilot");

    const result = await runShellCommandInSession({
      db,
      userId: user.id,
      sessionManager: manager,
      projectId: project.id,
      sessionId: "s-copilot",
      command: "long job",
      timeoutMs: 5_000
    });

    assert.equal(result.userTookOver, true);
    assert.equal(result.exitCode, null);
    // The persistent shell stays alive under the owner's control.
    assert.ok(manager.getSession("s-copilot"));
    // And the owner can type again.
    manager.assertManualInputAllowed(user.id, "s-copilot");
  });

  it("rejects when the shell session is dead", async () => {
    const db = testDb();
    const { user, project } = makeCopilotShellFixture(db, "s-copilot");
    const aliveRef = { alive: true };
    const manager = new InMemorySessionManager(fakeBackend({ aliveRef }));
    await startInMemoryShell(manager, user.id, "s-copilot");
    aliveRef.alive = false;

    await assert.rejects(
      () =>
        runShellCommandInSession({
          db,
          userId: user.id,
          sessionManager: manager,
          projectId: project.id,
          sessionId: "s-copilot",
          command: "echo hi"
        }),
      /SHELL_SESSION_DEAD/
    );
  });

  it("rejects a session that is not a Copilot shell", async () => {
    const db = testDb();
    const { user, project } = makeCopilotShellFixture(db, "s-user", {
      name: "My terminal"
    });
    const manager = new InMemorySessionManager(fakeBackend({}));
    await startInMemoryShell(manager, user.id, "s-user");

    await assert.rejects(
      () =>
        runShellCommandInSession({
          db,
          userId: user.id,
          sessionManager: manager,
          projectId: project.id,
          sessionId: "s-user",
          command: "echo hi"
        }),
      /SHELL_SESSION_NOT_COPILOT_SHELL/
    );
  });

  it("rejects a project mismatch", async () => {
    const db = testDb();
    const foreignUser = new UserRepository(db).create("foreign@test.dev", "hash");
    const foreign = new ProjectRepository(db, foreignUser.id).create({
      name: "foreign",
      path: "/elsewhere",
      aiTool: "claude"
    });
    const { user, project } = makeCopilotShellFixture(db, "s-copilot");
    const manager = new InMemorySessionManager(fakeBackend({}));
    await startInMemoryShell(manager, user.id, "s-copilot");

    await assert.rejects(
      () =>
        runShellCommandInSession({
          db,
          userId: user.id,
          sessionManager: manager,
          projectId: foreign.id,
          sessionId: "s-copilot",
          command: "echo hi"
        }),
      /SHELL_SESSION_PROJECT_MISMATCH/
    );
    assert.ok(project.id);
  });
});

describe("openCopilotShell / closeCopilotShell", () => {
  it("reuses the live replacement after a previous shell exits", async () => {
    const db = testDb();
    const { user, project, repo } = makeCopilotShellFixture(db, "retired-shell");
    repo.updateStatus("retired-shell", "exited");
    const manager = new InMemorySessionManager(fakeBackend(), undefined, undefined, { db });
    try {
      const first = await openCopilotShell(db, user.id, manager, project);
      const second = await openCopilotShell(db, user.id, manager, project);
      assert.equal(second.reused, true);
      assert.equal(second.sessionId, first.sessionId);
    } finally { db.close(); }
  });
  it("creates one shell per project and reuses it while live", async () => {
    const db = testDb();
    const user = new UserRepository(db).create("shell@test.dev", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "p",
      path: WORKDIR,
      aiTool: "claude"
    });
    const manager = new InMemorySessionManager(fakeBackend({}));

    const first = await openCopilotShell(db, user.id, manager, {
      id: project.id,
      path: WORKDIR
    });
    assert.equal(first.reused, false);
    const row = new SessionRepository(db, user.id).getById(first.sessionId);
    assert.equal(row?.name, COPILOT_SHELL_NAME);
    assert.equal(row?.aiTool, "terminal");
    assert.equal(row?.status, "running");

    const second = await openCopilotShell(db, user.id, manager, {
      id: project.id,
      path: WORKDIR
    });
    assert.equal(second.reused, true);
    assert.equal(second.sessionId, first.sessionId);

    // Exactly one Copilot shell row per project.
    const shells = new SessionRepository(db, user.id)
      .listByProject(project.id)
      .filter((s) => s.name === COPILOT_SHELL_NAME);
    assert.equal(shells.length, 1);
  });

  it("replaces a stale shell whose backend session is gone", async () => {
    const db = testDb();
    const user = new UserRepository(db).create("shell@test.dev", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "p",
      path: WORKDIR,
      aiTool: "claude"
    });
    const aliveRef = { alive: true };
    const manager = new InMemorySessionManager(fakeBackend({ aliveRef }));

    const first = await openCopilotShell(db, user.id, manager, {
      id: project.id,
      path: WORKDIR
    });
    // Kill the backend session (daemon restart / process exit).
    aliveRef.alive = false;
    const runtimeName = manager.getSession(first.sessionId)?.runtimeSessionName;
    if (runtimeName) await manager.stopSession(first.sessionId, runtimeName);

    const second = await openCopilotShell(db, user.id, manager, {
      id: project.id,
      path: WORKDIR
    });
    assert.equal(second.reused, false);
    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(
      new SessionRepository(db, user.id).getById(first.sessionId)?.status,
      "exited"
    );
  });

  it("closeCopilotShell stops the backend session and marks the row exited", async () => {
    const db = testDb();
    const user = new UserRepository(db).create("shell@test.dev", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "p",
      path: WORKDIR,
      aiTool: "claude"
    });
    const manager = new InMemorySessionManager(fakeBackend({}));
    const opened = await openCopilotShell(db, user.id, manager, {
      id: project.id,
      path: WORKDIR
    });
    const session = new SessionRepository(db, user.id).getById(opened.sessionId)!;

    await closeCopilotShell(db, user.id, manager, session);

    assert.equal(
      new SessionRepository(db, user.id).getById(opened.sessionId)?.status,
      "exited"
    );
    assert.equal(
      await manager.hasLiveTerminal(opened.sessionId),
      false
    );
  });
});

describe("writer lease renewal", () => {
  it("renew extends the in-memory lease beyond the TTL", () => {
    let now = 1000;
    const leases = new SessionWriterLeases({ now: () => now, ttlMs: 30_000 });
    const scope = { userId: "u", sessionId: "s", workspace: "/tmp" };
    let lease = leases.acquire(scope);
    now = 10_000; // 10s in, still inside the TTL
    lease = leases.renew(lease);
    now = 39_000; // 29s after renewal — the renewed lease still holds
    leases.assertCurrent(lease);
    leases.release(lease);
  });

  it("renew throws when the lease was taken over", () => {
    let now = 1000;
    const leases = new SessionWriterLeases({ now: () => now, ttlMs: 30_000 });
    const scope = { userId: "u", sessionId: "s", workspace: "/tmp" };
    const lease = leases.acquire(scope);
    leases.takeover(scope);
    assert.throws(() => leases.renew(lease), /WRITER_FENCE_STALE/);
  });
});

describe("workspace-scoped takeover (human wins)", () => {
  it("the same user can take over from a different session in the workspace", () => {
    let now = 1000;
    const leases = new SessionWriterLeases({ now: () => now, ttlMs: 30_000 });
    const copilotScope = { userId: "u", sessionId: "copilot-shell", workspace: "/tmp" };
    const userSessionScope = { userId: "u", sessionId: "user-terminal", workspace: "/tmp" };
    const lease = leases.acquire(copilotScope);
    // The user takes over from their own terminal session in the same project.
    leases.takeover(userSessionScope);
    assert.throws(() => leases.assertCurrent(lease), /WRITER_FENCE_STALE/);
    // The user can type now.
    leases.assertManualInputAllowed(userSessionScope);
    // And Copilot can re-acquire once the work is resumed.
    const reacquired = leases.acquire(copilotScope);
    assert.ok(reacquired.fence > lease.fence);
    leases.release(reacquired);
  });

  it("another tenant still cannot take over", () => {
    const leases = new SessionWriterLeases();
    const scope = { userId: "a", sessionId: "s", workspace: "/tmp" };
    const lease = leases.acquire(scope);
    assert.throws(() => leases.takeover({ ...scope, userId: "b" }), /WRITER_BUSY/);
    leases.assertCurrent(lease);
  });
});
