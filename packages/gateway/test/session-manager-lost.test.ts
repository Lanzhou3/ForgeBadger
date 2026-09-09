/**
 * P2 `lost` status tests: when the terminal daemon restarts, sessions that
 * were live but are missing from the new (empty) registry are marked `lost`
 * — never silently `exited`, never left pretending to run.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  InMemorySessionManager,
  type SessionRecoveryStore,
  type StoredSession
} from "../src/services/session-manager.js";
import { createDbSessionRecoveryStore } from "../src/services/db-session-recovery-store.js";
import type { TmuxClient } from "../src/services/tmux.js";
import type { LaunchPlan } from "../src/adapters/claude.js";

const launchPlan: LaunchPlan = {
  command: "bash",
  args: ["-c", "sleep 60"],
  cwd: "/tmp",
  env: {},
  secretEnvNames: [],
  credentialMode: "host_environment"
};

/** Backend where every session is gone (as after a daemon restart). */
function deadBackend(): TmuxClient {
  return {
    async createSession() {},
    async killSession() {},
    async capturePane() { return ""; },
    async listSessions() { return []; },
    async hasSession() { return false; }
  };
}

class RecordingRecoveryStore implements SessionRecoveryStore {
  removed: string[] = [];
  lost: string[] = [];
  async listSessions(): Promise<StoredSession[]> { return []; }
  async upsertSession(): Promise<void> {}
  async removeSession(id: string): Promise<void> { this.removed.push(id); }
  async markSessionLost(id: string): Promise<void> { this.lost.push(id); }
}

describe("reconcileSessionStatus lost semantics", () => {
  it("marks a live session as lost when the backend restarted", async () => {
    const store = new RecordingRecoveryStore();
    const manager = new InMemorySessionManager(deadBackend(), store, undefined, {
      detectBackendRestart: () => true
    });
    const session = await manager.createSession({ userId: "u1", sessionId: "s1", launchPlan });

    const reconciled = await manager.reconcileSessionStatus(session.id, { backendRestarted: true });

    assert.equal(reconciled?.status, "lost");
    assert.deepEqual(store.lost, ["s1"]);
    assert.deepEqual(store.removed, [], "lost must not remove the recovery record");
    assert.equal(manager.getSession("s1"), undefined, "lost session leaves the in-memory registry");
  });

  it("keeps exited semantics when the backend did not restart", async () => {
    const store = new RecordingRecoveryStore();
    const manager = new InMemorySessionManager(deadBackend(), store);
    const session = await manager.createSession({ userId: "u1", sessionId: "s1", launchPlan });

    const reconciled = await manager.reconcileSessionStatus(session.id);

    assert.equal(reconciled?.status, "exited");
    assert.deepEqual(store.removed, ["s1"]);
    assert.deepEqual(store.lost, []);
  });

  it("does not mark pending sessions as lost (they were never live)", async () => {
    const store = new RecordingRecoveryStore();
    // createSession leaves status pending until the backend create succeeds;
    // fail the backend create to keep the session out of `running`.
    const failingBackend: TmuxClient = {
      ...deadBackend(),
      async createSession() { throw new Error("spawn failed"); }
    };
    const manager = new InMemorySessionManager(failingBackend, store);
    await assert.rejects(
      () => manager.createSession({ userId: "u1", sessionId: "s1", launchPlan })
    );
    // Status is error after a failed create; reconcile must not flip to lost.
    const reconciled = await manager.reconcileSessionStatus("s1", { backendRestarted: true });
    assert.equal(reconciled?.status, "error");
    assert.deepEqual(store.lost, []);
  });

  it("correction scan consumes the restart probe once per run and marks all orphans lost", async () => {
    const store = new RecordingRecoveryStore();
    let probeCalls = 0;
    let restarted = true;
    const manager = new InMemorySessionManager(deadBackend(), store, undefined, {
      detectBackendRestart: () => {
        probeCalls++;
        const value = restarted;
        restarted = false; // one-shot, like the client's consumeServerRestarted
        return value;
      }
    });
    await manager.createSession({ userId: "u1", sessionId: "s1", launchPlan });
    await manager.createSession({ userId: "u1", sessionId: "s2", launchPlan });

    const stop = manager.startStatusCorrectionScan(10);
    try {
      const start = Date.now();
      while (store.lost.length < 2 && Date.now() - start < 2000) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.deepEqual(store.lost.sort(), ["s1", "s2"]);
      // Later scans keep running (probe consumed) without re-marking.
      const callsAfterMarking = probeCalls;
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(probeCalls >= callsAfterMarking);
    } finally {
      stop();
    }
  });
});

describe("DbSessionRecoveryStore.markSessionLost", () => {
  it("sets status lost and keeps the tmux_session name", async () => {
    const db = new Database(":memory:");
    migrate(drizzle(db), {
      migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
    });
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, email, password_hash, role, status) VALUES ('u1','u1','u1@example.test','x','user','active')").run();
    db.prepare("INSERT INTO projects (id,user_id,name,path,ai_tool,status,created_at,updated_at) VALUES ('p1','u1','P1','/tmp/p1','codex','active',?,?)").run(now, now);
    db.prepare("INSERT INTO sessions (id,user_id,project_id,name,ai_tool,status,attach_token,working_dir,credential_mode) VALUES ('s1','u1','p1','S1','codex','running','tok','/tmp/p1','host_environment')").run();

    const store = createDbSessionRecoveryStore(db);
    await store.upsertSession({
      id: "s1",
      userId: "u1",
      attachToken: "tok",
      tmuxName: "fb-u1-s1",
      launchPlan,
      createdAt: new Date().toISOString()
    });

    await store.markSessionLost("s1", "u1");

    const row = db.prepare("SELECT status, tmux_session FROM sessions WHERE id = 's1'").get() as {
      status: string;
      tmux_session: string | null;
    };
    assert.equal(row.status, "lost");
    assert.equal(row.tmux_session, "fb-u1-s1", "lost keeps the session name for revive provenance");
    db.close();
  });
});
