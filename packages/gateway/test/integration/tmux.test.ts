import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import type { LaunchPlan } from "../../src/adapters/claude.js";
import {
  InMemorySessionManager,
  type SessionRecoveryStore,
  type StoredSession
} from "../../src/services/session-manager.js";
import { createTmuxClient } from "../../src/services/tmux.js";

const runTmuxTests = process.env.RUN_TMUX_TESTS === "1";
const execFileAsync = promisify(execFile);

describe("tmux integration", { skip: !runTmuxTests }, () => {
  it("creates, captures, and kills a real tmux session", async () => {
    const tmux = createTmuxClient();
    const sessionName = `fb-test-${process.pid}`;

    await tmux.createSession({
      name: sessionName,
      cwd: tmpdir(),
      command: "bash",
      args: ["-lc", "printf forgebadger-gate-a && sleep 2"],
      env: {}
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    const output = await tmux.capturePane(sessionName);
    await tmux.killSession(sessionName);

    assert.match(output, /forgebadger-gate-a/);
  });

  it("removes stale unknown server secrets before creating a session", async () => {
    const tmux = createTmuxClient();
    const sessionName = `fb-test-env-scrub-${process.pid}`;
    const bootstrapName = `fb-test-env-bootstrap-${process.pid}`;
    const staleKey = "STALE_MULTIPLEXER_SECRET";
    const sessionSecretKey = "EXPLICIT_SESSION_MODEL_SECRET";
    const selectorKey = "CODEX_HOME";
    const staleSecret = `stale-global-${process.pid}`;
    const sessionSecret = `session-only-${process.pid}`;
    const selectorValue = `/tmp/codex-home-${process.pid}`;
    const originalStale = process.env[staleKey];
    const originalSessionSecret = process.env[sessionSecretKey];
    const originalSelector = process.env[selectorKey];
    delete process.env[staleKey];
    delete process.env[sessionSecretKey];
    process.env[selectorKey] = selectorValue;

    await execFileAsync("tmux", [
      "new-session", "-d", "-s", bootstrapName, "--", "sleep", "5"
    ]);
    await execFileAsync("tmux", ["set-environment", "-g", staleKey, staleSecret]);
    const probe = [
      `console.log("STALE:" + (process.env.${staleKey} ?? "missing"));`,
      `console.log("EXPLICIT:" + (process.env.${sessionSecretKey} ?? "missing"));`,
      `console.log("SELECTOR:" + (process.env.${selectorKey} ?? "missing"));`,
      "setTimeout(() => {}, 5000);"
    ].join("");

    try {
      await tmux.createSession({
        name: sessionName,
        cwd: tmpdir(),
        command: process.execPath,
        args: ["-e", probe],
        env: { [sessionSecretKey]: sessionSecret }
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      const output = await tmux.capturePane(sessionName);
      assert.match(output, /STALE:missing/);
      assert.match(output, new RegExp(`EXPLICIT:${sessionSecret}`));
      assert.match(output, new RegExp(`SELECTOR:${selectorValue}`));
      await assert.rejects(execFileAsync("tmux", ["show-environment", "-g", staleKey]));
      await assert.rejects(execFileAsync("tmux", ["show-environment", "-g", sessionSecretKey]));
      const { stdout: selectorGlobal } = await execFileAsync("tmux", [
        "show-environment", "-g", selectorKey
      ]);
      assert.equal(selectorGlobal.trim(), `${selectorKey}=${selectorValue}`);
    } finally {
      await tmux.killSession(sessionName);
      await execFileAsync("tmux", ["set-environment", "-gu", staleKey]).catch(() => undefined);
      await execFileAsync("tmux", ["set-environment", "-gu", sessionSecretKey]).catch(() => undefined);
      if (originalSelector === undefined) {
        await execFileAsync("tmux", ["set-environment", "-gu", selectorKey]).catch(() => undefined);
      } else {
        await execFileAsync("tmux", ["set-environment", "-g", selectorKey, originalSelector]).catch(() => undefined);
      }
      await tmux.killSession(bootstrapName);
      restoreEnv(staleKey, originalStale);
      restoreEnv(sessionSecretKey, originalSessionSecret);
      restoreEnv(selectorKey, originalSelector);
    }
  });

  it("enables tmux mouse scrolling and keeps a larger history", async () => {
    const tmux = createTmuxClient();
    const sessionName = `fb-test-options-${process.pid}`;

    try {
      await tmux.createSession({
        name: sessionName,
        cwd: tmpdir(),
        command: "bash",
        args: ["-lc", "sleep 5"],
        env: {}
      });

      const { stdout } = await execFileAsync("tmux", [
        "show-options",
        "-t",
        sessionName,
        "-v",
        "mouse",
        ";",
        "show-options",
        "-t",
        sessionName,
        "-v",
        "history-limit",
        ";",
        // `window-size` is a window option; the session-scope lookup only
        // works via tmux's implicit redirect and fails on psmux, so query the
        // window option explicitly to match how configureSession sets it.
        "show-window-options",
        "-t",
        sessionName,
        "-v",
        "window-size",
        ";",
        // The attach client's status line would consume one terminal row and
        // leave the pane permanently one row taller than the client viewport.
        "show-options",
        "-t",
        sessionName,
        "-v",
        "status"
      ]);

      assert.deepEqual(stdout.trim().split("\n"), ["on", "10000", "manual", "off"]);
    } finally {
      await tmux.killSession(sessionName);
    }
  });

  it("keeps the window size when a wider client attaches", async () => {
    const tmux = createTmuxClient();
    const sessionName = `fb-test-winsize-${process.pid}`;
    let widerClient: ChildProcess | undefined;

    try {
      await tmux.createSession({
        name: sessionName,
        cwd: tmpdir(),
        command: "bash",
        args: ["-lc", "sleep 5"],
        env: {}
      });

      // Simulate a wider client attaching (e.g. a manual `tmux a` from a big
      // terminal window) via control mode. With the default `window-size
      // latest` this would grow the window to 132x43; `window-size manual`
      // must keep it at the 80x24 the session was created with.
      widerClient = spawn("tmux", ["-C", "attach-session", "-t", sessionName], {
        stdio: ["pipe", "ignore", "ignore"]
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      widerClient.stdin?.write("refresh-client -C 132,43\n");
      await new Promise((resolve) => setTimeout(resolve, 500));

      const { stdout } = await execFileAsync("tmux", [
        "display-message", "-p", "-t", sessionName, "#{window_width}x#{window_height}"
      ]);
      assert.equal(stdout.trim(), "80x24");
    } finally {
      widerClient?.kill();
      await tmux.killSession(sessionName);
    }
  });

  it("sends literal input to a real tmux session", async () => {
    const tmux = createTmuxClient();
    const sessionName = `fb-test-input-${process.pid}`;

    try {
      await tmux.createSession({
        name: sessionName,
        cwd: tmpdir(),
        command: "bash",
        args: ["-lc", "read line; printf 'forgebadger-input:%s' \"$line\"; sleep 2"],
        env: {}
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      await tmux.sendInput?.(sessionName, "pwd\n");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const output = await tmux.capturePane(sessionName);

      assert.match(output, /forgebadger-input:pwd/);
    } finally {
      await tmux.killSession(sessionName);
    }
  });

  it("stages one multiline bracketed paste through control stdin and submits once", async () => {
    const tmux = createTmuxClient();
    const sessionName = `fb-test-programmatic-${process.pid}`;
    const canary = `PROGRAMMATIC_CANARY_${process.pid}_中文\nsecond line`;
    const rawConsumer = [
      "process.stdin.setRawMode(true);",
      "process.stdin.resume();",
      "let chunks=[]; let enters=0;",
      "process.stdin.on('data',(chunk)=>{",
      "  chunks.push(chunk);",
      "  if (chunk.includes(13)) {",
      "    enters += 1;",
      "    const text=Buffer.concat(chunks).toString('utf8')",
      "      .replace('\\u001b[200~','').replace('\\u001b[201~','').replace(/\\r/g,'');",
      "    console.log('TASK:'+JSON.stringify(text));",
      "    console.log('ENTER_COUNT:'+enters);",
      "    setTimeout(()=>process.exit(0),500);",
      "  }",
      "});"
    ].join("");

    try {
      await tmux.createSession({
        name: sessionName,
        cwd: tmpdir(),
        command: process.execPath,
        args: ["-e", rawConsumer],
        env: {}
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      const buffersBefore = await listTmuxBuffers();
      await tmux.stageProgrammaticInput?.(sessionName, canary);
      assert.deepEqual(await listTmuxBuffers(), buffersBefore, "programmatic input must not use tmux buffers");

      await tmux.pressEnter?.(sessionName);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const output = await tmux.capturePane(sessionName);

      assert.match(output, new RegExp(`TASK:.*PROGRAMMATIC_CANARY_${process.pid}_`));
      assert.match(output, /second line/);
      assert.match(output, /ENTER_COUNT:1/);
      assert.doesNotMatch(output, /ENTER_COUNT:2/);
    } finally {
      await tmux.killSession(sessionName);
    }
  });

  it("recovers indexed tmux sessions and kills unindexed ForgeBadger sessions", async () => {
    const tmux = createTmuxClient();
    const store = new MemoryRecoveryStore();
    const tmuxPrefix = `fb-recovery-${process.pid}-`;
    const knownSessionId = `sessionknown${process.pid}`;
    const orphanName = `${tmuxPrefix}user123-sessionorphan${process.pid}`;
    const manager = new InMemorySessionManager(tmux, store, undefined, { tmuxPrefix });

    await manager.createSession({
      userId: "user123",
      sessionId: knownSessionId,
      launchPlan: launchPlan(knownSessionId)
    });
    await tmux.createSession({
      name: orphanName,
      cwd: tmpdir(),
      command: "bash",
      args: ["-lc", "sleep 5"],
      env: {}
    });

    const restartedManager = new InMemorySessionManager(tmux, store, undefined, { tmuxPrefix });
    const result = await restartedManager.recoverForgeBadgerSessions({
      userId: "user123",
      cwd: tmpdir()
    });

    await restartedManager.stopSession(knownSessionId);

    assert.equal(result.recovered.length, 1);
    assert.equal(result.recovered[0]?.id, knownSessionId);
    assert.deepEqual(result.killedOrphans, [orphanName]);
  });
});

async function listTmuxBuffers(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("tmux", ["list-buffers", "-F", "#{buffer_name}"]);
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function launchPlan(sessionId: string): LaunchPlan {
  return {
    command: "bash",
    args: ["-lc", "sleep 5"],
    cwd: tmpdir(),
    env: { FORGEBADGER_SESSION_ID: sessionId },
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

class MemoryRecoveryStore implements SessionRecoveryStore {
  private entries: StoredSession[] = [];

  async listSessions(): Promise<StoredSession[]> {
    return this.entries;
  }

  async upsertSession(session: StoredSession): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.id !== session.id);
    this.entries.push(session);
  }

  async removeSession(id: string, userId: string): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.id !== id || entry.userId !== userId);
  }
}
