import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LaunchPlan } from "../src/adapters/claude.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import type { TmuxClient } from "../src/services/tmux.js";

function launchPlan(): LaunchPlan {
  return {
    command: "bash",
    args: [],
    cwd: "/tmp",
    env: { FORGEBADGER_SESSION_ID: "session_abcdef" },
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

describe("InMemorySessionManager", () => {
  it("creates a Gateway-owned tmux session and marks it running", async () => {
    const calls: string[] = [];
    const manager = new InMemorySessionManager(fakeTmux(calls));

    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_abcdef",
      launchPlan: launchPlan()
    });

    assert.equal(session.tmuxName, "of-user_123-session_abcdef");
    assert.equal(session.status, "running");
    assert.deepEqual(calls, ["create:of-user_123-session_abcdef"]);
  });

  it("clears NO_COLOR so CLI colors render in the Web terminal", async () => {
    let capturedEnv: Record<string, string> | undefined;
    const manager = new InMemorySessionManager({
      ...fakeTmux([]),
      async createSession(options) {
        capturedEnv = options.env;
      }
    });

    await manager.createSession({
      userId: "user_123456",
      sessionId: "session_abcdef",
      launchPlan: launchPlan()
    });

    // The Web terminal renders ANSI colors, so a host-leaked NO_COLOR=1
    // (inherited from the tmux server global environment) must be overridden
    // to an empty value — CLI TUI (e.g. Claude Code) then renders in color.
    assert.equal(capturedEnv?.NO_COLOR, "");
    assert.equal(capturedEnv?.["FORGEBADGER_ATTACH_TOKEN"]?.length, 36);
  });

  it("marks a session exited when stopped", async () => {
    const calls: string[] = [];
    const manager = new InMemorySessionManager(fakeTmux(calls));
    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_abcdef",
      launchPlan: launchPlan()
    });

    const stopped = await manager.stopSession(session.id);

    assert.equal(stopped.status, "exited");
    assert.equal(manager.getSession(session.id), undefined);
    assert.deepEqual(calls, [
      "create:of-user_123-session_abcdef",
      "kill:of-user_123-session_abcdef"
    ]);
  });

  it("preserves caller user id when stopping a stale tmux-backed session", async () => {
    const calls: string[] = [];
    const manager = new InMemorySessionManager(fakeTmux(calls));

    const stopped = await manager.stopSession(
      "session_stale",
      "of-user_123-session_stale",
      "user_123456"
    );

    assert.equal(stopped.status, "exited");
    assert.equal(stopped.userId, "user_123456");
    assert.deepEqual(calls, ["kill:of-user_123-session_stale"]);
  });

  it("returns captured history from tmux", async () => {
    const manager = new InMemorySessionManager(fakeTmux([]));
    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_abcdef",
      launchPlan: launchPlan()
    });

    const history = await manager.captureHistory(session.id);

    assert.equal(history, "hello from tmux");
  });

  it("resizes the backing tmux window for an active session", async () => {
    const calls: string[] = [];
    const manager = new InMemorySessionManager({
      ...fakeTmux(calls),
      async resizeWindow(name, cols, rows) {
        calls.push(`resize:${name}:${cols}x${rows}`);
      }
    });
    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_abcdef",
      launchPlan: launchPlan()
    });

    await manager.resizeSession(session.id, 180, 50);

    assert.deepEqual(calls, [
      "create:of-user_123-session_abcdef",
      "resize:of-user_123-session_abcdef:180x50"
    ]);
  });

  it("sends raw input to the backing tmux session for an active session", async () => {
    const calls: string[] = [];
    const manager = new InMemorySessionManager({
      ...fakeTmux(calls),
      async sendInput(name, data) {
        calls.push(`send:${name}:${JSON.stringify(data)}`);
      }
    });
    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_abcdef",
      launchPlan: launchPlan()
    });

    await manager.sendInput(session.id, "pwd\n");

    assert.deepEqual(calls, [
      "create:of-user_123-session_abcdef",
      "send:of-user_123-session_abcdef:\"pwd\\n\""
    ]);
  });

  it("stages one programmatic task, settles, and presses Enter exactly once", async () => {
    const calls: string[] = [];
    let pane = "› Ask Codex to do anything\n\nmodel · cwd";
    const plan = { ...launchPlan(), command: "codex" };
    const manager = new InMemorySessionManager({
      ...fakeTmux(calls),
      async inspectPane() {
        calls.push("inspect");
        return { content: pane, dead: false, inMode: false };
      },
      async stageProgrammaticInput(_name, data) {
        calls.push(`stage:${data}`);
        pane = `› ${data}\n\nmodel · cwd`;
      },
      async pressEnter() {
        calls.push("enter");
      }
    }, undefined, undefined, {
      programmaticSubmitSettleMs: { codex: 0 },
      sleep: async () => calls.push("settle")
    });
    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_programmatic",
      launchPlan: plan
    });

    const receipt = await manager.submitProgrammaticTask(session.id, {
      adapter: "codex",
      message: "第一行\n第二行"
    });

    assert.equal(receipt.adapter, "codex");
    assert.deepEqual(calls.filter((call) => call === "enter"), ["enter"]);
    assert.deepEqual(calls.slice(1), ["inspect", "stage:第一行\n第二行", "settle", "inspect", "enter"]);
  });

  it("submits a Codex large-paste placeholder after matching its character count", async () => {
    const calls: string[] = [];
    const message = "请".repeat(2032);
    let pane = "› Ask Codex to do anything\n\nmodel · cwd";
    const manager = new InMemorySessionManager({
      ...fakeTmux(calls),
      async inspectPane() {
        calls.push("inspect");
        return { content: pane, dead: false, inMode: false };
      },
      async stageProgrammaticInput() {
        calls.push("stage");
        pane = "› [Pasted Content 2032 chars]\n\nmodel · cwd";
      },
      async pressEnter() {
        calls.push("enter");
      }
    }, undefined, undefined, {
      programmaticSubmitSettleMs: { codex: 0 },
      sleep: async () => calls.push("settle")
    });
    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_large_paste",
      launchPlan: { ...launchPlan(), command: "codex" }
    });

    await manager.submitProgrammaticTask(session.id, { adapter: "codex", message });

    assert.deepEqual(calls.slice(1), ["inspect", "stage", "settle", "inspect", "enter"]);
  });

  it("rejects an adapter mismatch before writing to tmux", async () => {
    const writes: string[] = [];
    const manager = new InMemorySessionManager({
      ...fakeTmux([]),
      async inspectPane() {
        writes.push("inspect");
        return { content: "", dead: false, inMode: false };
      },
      async stageProgrammaticInput() {
        writes.push("stage");
      },
      async pressEnter() {
        writes.push("enter");
      }
    });
    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_mismatch",
      launchPlan: { ...launchPlan(), command: "codex" }
    });

    await assert.rejects(
      () => manager.submitProgrammaticTask(session.id, { adapter: "claude", message: "hello" }),
      /PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH/
    );
    assert.deepEqual(writes, []);
  });

  it("rejects unsafe terminal control characters before reading or writing tmux", async () => {
    const terminalCalls: string[] = [];
    const manager = new InMemorySessionManager({
      ...fakeTmux([]),
      async inspectPane() {
        terminalCalls.push("inspect");
        return { content: "", dead: false, inMode: false };
      },
      async stageProgrammaticInput() {
        terminalCalls.push("stage");
      },
      async pressEnter() {
        terminalCalls.push("enter");
      }
    });

    await assert.rejects(
      () => manager.submitProgrammaticTask("unknown", {
        adapter: "codex",
        message: "hello\u001b[201~\rInjected command"
      }),
      /PROGRAMMATIC_SUBMIT_UNSAFE_INPUT/
    );
    assert.deepEqual(terminalCalls, []);
  });

  it("marks a partially failed stage as indeterminate without resending", async () => {
    const terminalCalls: string[] = [];
    const manager = new InMemorySessionManager({
      ...fakeTmux([]),
      async inspectPane() {
        terminalCalls.push("inspect");
        return { content: "› Ask Codex to do anything\n\nmodel · cwd", dead: false, inMode: false };
      },
      async stageProgrammaticInput(_name, data) {
        terminalCalls.push(`stage:${data}`);
        throw new Error("control stream closed after a partial write");
      },
      async pressEnter() {
        terminalCalls.push("enter");
      }
    });
    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_partial_stage",
      launchPlan: { ...launchPlan(), command: "codex" }
    });

    await assert.rejects(
      () => manager.submitProgrammaticTask(session.id, { adapter: "codex", message: "hello" }),
      /PROGRAMMATIC_SUBMIT_INDETERMINATE/
    );
    assert.deepEqual(terminalCalls, ["inspect", "stage:hello"]);
  });

  it("marks an Enter failure as indeterminate without restaging or resubmitting", async () => {
    const terminalCalls: string[] = [];
    let pane = "› Ask Codex to do anything\n\nmodel · cwd";
    const manager = new InMemorySessionManager({
      ...fakeTmux([]),
      async inspectPane() {
        terminalCalls.push("inspect");
        return { content: pane, dead: false, inMode: false };
      },
      async stageProgrammaticInput(_name, data) {
        terminalCalls.push(`stage:${data}`);
        pane = `› ${data}\n\nmodel · cwd`;
      },
      async pressEnter() {
        terminalCalls.push("enter");
        throw new Error("control stream closed after Enter may have been written");
      }
    }, undefined, undefined, {
      programmaticSubmitSettleMs: { codex: 0 },
      sleep: async () => terminalCalls.push("settle")
    });
    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_enter_failure",
      launchPlan: { ...launchPlan(), command: "codex" }
    });

    await assert.rejects(
      () => manager.submitProgrammaticTask(session.id, { adapter: "codex", message: "hello" }),
      /PROGRAMMATIC_SUBMIT_INDETERMINATE/
    );
    assert.deepEqual(terminalCalls, ["inspect", "stage:hello", "settle", "inspect", "enter"]);
  });

  it("marks launch failures as errors", async () => {
    const manager = new InMemorySessionManager({
      async createSession() {
        throw new Error("tmux failed");
      },
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return [];
      }
    });

    await assert.rejects(
      () =>
        manager.createSession({
          userId: "user_123456",
          sessionId: "session_abcdef",
          launchPlan: launchPlan()
        }),
      /tmux failed/
    );

    assert.equal(manager.getSession("session_abcdef")?.status, "error");
  });

  it("recovers existing ForgeBadger tmux sessions after Gateway restart", async () => {
    const configured: string[] = [];
    const store = new MemoryRecoveryStore([
      {
        id: "session_recovered",
        userId: "gate-a-user",
        tmuxName: "of-gate-a-u-session_recovered",
        launchPlan: launchPlan(),
        createdAt: "2026-04-27T00:00:00.000Z"
      }
    ]);
    const manager = new InMemorySessionManager({
      async createSession() {},
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return ["of-gate-a-u-session_recovered"];
      },
      async configureSession(name) {
        configured.push(name);
      }
    }, store);

    const recovered = await manager.recoverForgeBadgerSessions({
      userId: "gate-a-user",
      cwd: "/tmp"
    });

    assert.equal(recovered.recovered.length, 1);
    assert.equal(recovered.recovered[0]?.id, "session_recovered");
    assert.equal(manager.getSession("session_recovered")?.status, "detached");
    assert.deepEqual(configured, ["of-gate-a-u-session_recovered"]);
  });

  it("kills ForgeBadger tmux sessions missing from the recovery index", async () => {
    const calls: string[] = [];
    const manager = new InMemorySessionManager({
      async createSession() {},
      async killSession(name) {
        calls.push(`kill:${name}`);
      },
      async capturePane() {
        return "";
      },
      async listSessions() {
        return ["of-gate-a-u-session_known", "of-gate-a-u-session_orphan", "external"];
      }
    }, new MemoryRecoveryStore([
      {
        id: "session_known",
        userId: "gate-a-user",
        tmuxName: "of-gate-a-u-session_known",
        launchPlan: launchPlan(),
        createdAt: "2026-04-27T00:00:00.000Z"
      }
    ]));

    const result = await manager.recoverForgeBadgerSessions({
      userId: "gate-a-user",
      cwd: "/tmp"
    });

    assert.deepEqual(result.killedOrphans, ["of-gate-a-u-session_orphan"]);
    assert.deepEqual(calls, ["kill:of-gate-a-u-session_orphan"]);
  });

  it("only recovers and kills sessions matching the configured tmux prefix", async () => {
    const calls: string[] = [];
    const manager = new InMemorySessionManager({
      async createSession() {},
      async killSession(name) {
        calls.push(`kill:${name}`);
      },
      async capturePane() {
        return "";
      },
      async listSessions() {
        return ["of-user123-session", "smoke-user123-known", "smoke-user123-orphan"];
      }
    }, new MemoryRecoveryStore([
      {
        id: "session_known",
        userId: "gate-a-user",
        tmuxName: "smoke-user123-known",
        launchPlan: launchPlan(),
        createdAt: "2026-04-27T00:00:00.000Z"
      }
    ]), undefined, { tmuxPrefix: "smoke-" });

    const result = await manager.recoverForgeBadgerSessions({
      userId: "gate-a-user",
      cwd: "/tmp"
    });

    assert.equal(result.recovered[0]?.tmuxName, "smoke-user123-known");
    assert.deepEqual(result.killedOrphans, ["smoke-user123-orphan"]);
    assert.deepEqual(calls, ["kill:smoke-user123-orphan"]);
  });

  it("writes successfully created sessions to the recovery index", async () => {
    const store = new MemoryRecoveryStore([]);
    const manager = new InMemorySessionManager(fakeTmux([]), store);

    const session = await manager.createSession({
      userId: "user_123456",
      sessionId: "session_abcdef",
      launchPlan: launchPlan()
    });

    assert.equal(store.entries[0]?.id, session.id);
    assert.equal(store.entries[0]?.tmuxName, session.tmuxName);
  });

  it("preserves an existing attach token when reattaching a live tmux session", async () => {
    const store = new MemoryRecoveryStore([]);
    const configured: string[] = [];
    const manager = new InMemorySessionManager({
      async createSession() {},
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return ["of-existing-live"];
      },
      async configureSession(name) {
        configured.push(name);
      }
    }, store);

    const session = await manager.attachExistingSession({
      userId: "user_123456",
      sessionId: "session_abcdef",
      launchPlan: launchPlan(),
      tmuxName: "of-existing-live",
      attachToken: "existing-live-token"
    });

    assert.equal(session.attachToken, "existing-live-token");
    assert.equal(store.entries[0]?.attachToken, "existing-live-token");
    assert.deepEqual(configured, ["of-existing-live"]);
  });

  it("serializes per-session lifecycle operations via runExclusive", async () => {
    const order: string[] = [];
    const manager = new InMemorySessionManager(fakeTmux([]), new MemoryRecoveryStore([]));

    await Promise.all([
      manager.runExclusive("s1", async () => {
        order.push("a:start");
        await new Promise((r) => setTimeout(r, 20));
        order.push("a:end");
      }),
      manager.runExclusive("s1", async () => {
        order.push("b:start");
        order.push("b:end");
      }),
      manager.runExclusive("s2", async () => {
        order.push("c:start");
        order.push("c:end");
      })
    ]);

    // Same-session calls serialize: a fully completes before b starts.
    const aEnd = order.indexOf("a:end");
    const bStart = order.indexOf("b:start");
    assert.ok(aEnd >= 0 && bStart >= 0, "expected both a:end and b:start events");
    assert.ok(aEnd < bStart, `s1 calls must serialize; got order=${order.join(",")}`);
    // Different session is independent and may run interleaved.
    assert.ok(order.includes("c:start") && order.includes("c:end"));
  });

  it("clears the per-session lock entry once the chain settles", async () => {
    const manager = new InMemorySessionManager(fakeTmux([]), new MemoryRecoveryStore([]));
    await manager.runExclusive("s1", async () => undefined);
    // Internal map should not retain a stale promise after success.
    assert.equal(
      (manager as unknown as { sessionLocks: Map<string, Promise<unknown>> }).sessionLocks.has("s1"),
      false
    );
  });

  it("stopSession removes the in-memory entry even when the recovery store throws", async () => {
    class ThrowingRecoveryStore extends MemoryRecoveryStore {
      async removeSession(): Promise<void> {
        throw new Error("db unavailable");
      }
    }
    const manager = new InMemorySessionManager(fakeTmux([]), new ThrowingRecoveryStore([]));
    await manager.createSession({
      userId: "u1",
      sessionId: "s-err",
      launchPlan: launchPlan()
    });

    await assert.rejects(
      manager.stopSession("s-err"),
      /db unavailable/
    );
    // The in-memory entry MUST be cleared even when DB cleanup fails.
    assert.equal(manager.getSession("s-err"), undefined);
  });

  it("reconcileSessionStatus marks exited when the tmux session has disappeared and syncs DB", async () => {
    const store = new MemoryRecoveryStore([{
      id: "s-dead",
      userId: "u1",
      attachToken: "tok",
      tmuxName: "of-u1-s-dead",
      launchPlan: launchPlan(),
      createdAt: new Date().toISOString()
    }]);
    const manager = new InMemorySessionManager(
      {
        async createSession() {},
        async killSession() {},
        async capturePane() { return ""; },
        async listSessions() { return []; },
        async hasSession() { return false; },
        async showEnvironment() { return {}; }
      },
      store
    );
    await manager.createSession({
      userId: "u1",
      sessionId: "s-dead",
      launchPlan: launchPlan()
    });

    const exited = await manager.reconcileSessionStatus("s-dead");
    assert.equal(exited?.status, "exited");
    // Memory entry cleaned up.
    assert.equal(manager.getSession("s-dead"), undefined);
    // Recovery store updated (entry removed).
    assert.equal(store.entries.find((entry) => entry.id === "s-dead"), undefined);
  });

  it("reconcileSessionStatus marks detached (not exited) when tmux is still alive", async () => {
    const emitted: Array<{ newStatus?: string }> = [];
    const manager = new InMemorySessionManager(
      {
        async createSession() {},
        async killSession() {},
        async capturePane() { return ""; },
        async listSessions() { return ["of-u1-s-det"]; },
        async hasSession() { return true; },
        async showEnvironment() { return {}; }
      },
      new MemoryRecoveryStore([]),
      {
        emitEvent(event) {
          emitted.push(event as unknown as { newStatus?: string });
        },
        on() { return () => undefined; },
        off() {}
      } as unknown as Parameters<typeof InMemorySessionManager>[2]
    );
    await manager.createSession({
      userId: "u1",
      sessionId: "s-det",
      launchPlan: launchPlan()
    });

    const reconciled = await manager.reconcileSessionStatus("s-det");
    assert.equal(reconciled?.status, "detached");
    assert.ok(
      emitted.some((event) => event.newStatus === "detached"),
      "expected a single session_status_changed event with newStatus=detached"
    );
  });
});

function fakeTmux(calls: string[]): TmuxClient {
  return {
    async createSession(options) {
      calls.push(`create:${options.name}`);
    },
    async killSession(name) {
      calls.push(`kill:${name}`);
    },
    async capturePane() {
      return "hello from tmux";
    },
    async listSessions() {
      return [];
    },
    async hasSession() {
      return true;
    },
    async showEnvironment() {
      return {};
    }
  };
}

class MemoryRecoveryStore {
  constructor(public entries: Array<{
    id: string;
    userId: string;
    attachToken?: string;
    tmuxName: string;
    launchPlan: LaunchPlan;
    createdAt: string;
  }>) {}

  async listSessions() {
    return this.entries;
  }

  async upsertSession(entry: {
    id: string;
    userId: string;
    attachToken?: string;
    tmuxName: string;
    launchPlan: LaunchPlan;
    createdAt: string;
  }) {
    this.entries = this.entries.filter((current) => current.id !== entry.id);
    this.entries.push(entry);
  }

  async removeSession(id: string, userId: string) {
    this.entries = this.entries.filter((current) => current.id !== id || current.userId !== userId);
  }
}
