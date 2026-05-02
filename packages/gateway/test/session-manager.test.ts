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
    env: { OPENFORGE_SESSION_ID: "session_abcdef" },
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

  it("recovers existing OpenForge tmux sessions after Gateway restart", async () => {
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
      }
    }, store);

    const recovered = await manager.recoverOpenForgeSessions({
      userId: "gate-a-user",
      cwd: "/tmp"
    });

    assert.equal(recovered.recovered.length, 1);
    assert.equal(recovered.recovered[0]?.id, "session_recovered");
    assert.equal(manager.getSession("session_recovered")?.status, "detached");
  });

  it("kills OpenForge tmux sessions missing from the recovery index", async () => {
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

    const result = await manager.recoverOpenForgeSessions({
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

    const result = await manager.recoverOpenForgeSessions({
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
    const manager = new InMemorySessionManager({
      async createSession() {},
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return ["of-existing-live"];
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

  async removeSession(id: string) {
    this.entries = this.entries.filter((current) => current.id !== id);
  }
}
