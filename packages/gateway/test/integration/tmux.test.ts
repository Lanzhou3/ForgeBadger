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
    const sessionName = `of-test-${process.pid}`;

    await tmux.createSession({
      name: sessionName,
      cwd: tmpdir(),
      command: "bash",
      args: ["-lc", "printf openforge-gate-a && sleep 2"],
      env: {}
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    const output = await tmux.capturePane(sessionName);
    await tmux.killSession(sessionName);

    assert.match(output, /openforge-gate-a/);
  });

  it("enables tmux mouse scrolling and keeps a larger history", async () => {
    const tmux = createTmuxClient();
    const sessionName = `of-test-options-${process.pid}`;

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
        "show-options",
        "-t",
        sessionName,
        "-v",
        "window-size"
      ]);

      assert.deepEqual(stdout.trim().split("\n"), ["on", "10000", "manual"]);
    } finally {
      await tmux.killSession(sessionName);
    }
  });

  it("keeps the window size when a wider client attaches", async () => {
    const tmux = createTmuxClient();
    const sessionName = `of-test-winsize-${process.pid}`;
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
    const sessionName = `of-test-input-${process.pid}`;

    try {
      await tmux.createSession({
        name: sessionName,
        cwd: tmpdir(),
        command: "bash",
        args: ["-lc", "read line; printf 'openforge-input:%s' \"$line\"; sleep 2"],
        env: {}
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      await tmux.sendInput?.(sessionName, "pwd\n");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const output = await tmux.capturePane(sessionName);

      assert.match(output, /openforge-input:pwd/);
    } finally {
      await tmux.killSession(sessionName);
    }
  });

  it("stages one multiline bracketed paste through control stdin and submits once", async () => {
    const tmux = createTmuxClient();
    const sessionName = `of-test-programmatic-${process.pid}`;
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

  it("recovers indexed tmux sessions and kills unindexed OpenForge sessions", async () => {
    const tmux = createTmuxClient();
    const store = new MemoryRecoveryStore();
    const tmuxPrefix = `of-recovery-${process.pid}-`;
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
    const result = await restartedManager.recoverOpenForgeSessions({
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

function launchPlan(sessionId: string): LaunchPlan {
  return {
    command: "bash",
    args: ["-lc", "sleep 5"],
    cwd: tmpdir(),
    env: { OPENFORGE_SESSION_ID: sessionId },
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
