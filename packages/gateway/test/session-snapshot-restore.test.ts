import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { SessionSnapshotRepository } from "../src/db/repositories/session-snapshot-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import type { TmuxCreateOptions } from "../src/services/tmux.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;

interface AuthContext {
  token: string;
  userId: string;
}

interface RestoreBody {
  code: number;
  message?: string;
  data?: {
    session: {
      id: string;
      status: string;
      tmuxSession?: string | null;
      attachToken?: string;
    };
    mode: "attach_tmux" | "recreate_session";
  };
}

let baseUrl: string;

describe("session snapshot restore", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let db: Database;
  let tmuxSessions: string[];
  let createdTmuxOptions: TmuxCreateOptions[];

  before(async () => {
    db = createTestDb();
    tmuxSessions = [];
    createdTmuxOptions = [];
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager({
        async createSession(options) {
          createdTmuxOptions.push(options);
          tmuxSessions.push(options.name);
        },
        async killSession() {},
        async capturePane() {
          return "";
        },
        async listSessions() {
          return tmuxSessions;
        }
      }),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      adapterCommandRunner: async () => ({ exitCode: 0, stdout: "test", stderr: "" })
    });
    await new Promise<void>((resolve) => {
      server = app.server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string") {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    db.close();
  });

  it("reattaches to an existing tmux session from a snapshot", async () => {
    const auth = await register("snapshot-attach@example.com");
    const liveAttachToken = "existing-live-hook-token";
    const { sessionId, snapshotId } = createStoppedSessionSnapshot(auth, "of-live-restore", {
      attachToken: liveAttachToken
    });
    tmuxSessions = ["of-live-restore"];

    const restoreRes = await fetch(`${baseUrl}/api/v1/snapshots/${snapshotId}/restore`, {
      method: "POST",
      headers: jsonHeaders(auth.token)
    });
    const body = (await restoreRes.json()) as RestoreBody;

    assert.equal(restoreRes.status, 200, JSON.stringify(body));
    assert.equal(body.data?.mode, "attach_tmux");
    assert.equal(body.data?.session.id, sessionId);
    assert.equal(body.data?.session.status, "running");
    assert.equal(body.data?.session.tmuxSession, "of-live-restore");
    assert.equal(body.data?.session.attachToken, liveAttachToken);
    const persisted = new SessionRepository(db, auth.userId).getById(sessionId);
    assert.equal(persisted?.attachToken, liveAttachToken);
    assert.equal(createdTmuxOptions.length, 0);
  });

  it("recreates a session from snapshot metadata when tmux is unavailable", async () => {
    const auth = await register("snapshot-recreate@example.com");
    const { sessionId, snapshotId } = createStoppedSessionSnapshot(auth, "of-missing-restore");
    tmuxSessions = [];
    createdTmuxOptions = [];

    const restoreRes = await fetch(`${baseUrl}/api/v1/snapshots/${snapshotId}/restore`, {
      method: "POST",
      headers: jsonHeaders(auth.token)
    });
    const body = (await restoreRes.json()) as RestoreBody;

    assert.equal(restoreRes.status, 200, JSON.stringify(body));
    assert.equal(body.data?.mode, "recreate_session");
    assert.equal(body.data?.session.id, sessionId);
    assert.equal(body.data?.session.status, "running");
    assert.equal(createdTmuxOptions.length, 1);
    assert.match(createdTmuxOptions[0]!.name, /^of-/);
  });

  it("does not restore another user's snapshot", async () => {
    const owner = await register("snapshot-owner@example.com");
    const other = await register("snapshot-other@example.com");
    const { snapshotId } = createStoppedSessionSnapshot(owner, "of-private-restore");

    const restoreRes = await fetch(`${baseUrl}/api/v1/snapshots/${snapshotId}/restore`, {
      method: "POST",
      headers: jsonHeaders(other.token)
    });
    const body = (await restoreRes.json()) as RestoreBody;

    assert.equal(restoreRes.status, 404);
    assert.equal(body.code, 1);
  });

  function createStoppedSessionSnapshot(
    auth: AuthContext,
    tmuxSession: string,
    options: { attachToken?: string } = {}
  ): {
    sessionId: string;
    snapshotId: string;
  } {
    const project = new ProjectRepository(db, auth.userId).create({
      name: "Snapshot Project",
      path: "/tmp/openforge-snapshot-restore",
      aiTool: "claude"
    });
    mkdirSync(project.path, { recursive: true });
    const sessionRepo = new SessionRepository(db, auth.userId);
    const providerRepo = new ModelProviderRepository(db, auth.userId, masterKey);
    const provider = providerRepo.createProviderProfile({
      providerKey: "anthropic",
      name: "Anthropic",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["claude"]
    });
    const model = providerRepo.createModelProfile({
      providerProfileId: provider.id,
      name: "Snapshot Model",
      modelId: "claude-test"
    });
    const session = sessionRepo.create({
      projectId: project.id,
      name: "Snapshot Session",
      aiTool: "claude",
      workingDir: project.path,
      modelId: model.id
    });
    sessionRepo.update(session.id, {
      status: "stopped",
      tmuxSession: null,
      attachToken: options.attachToken ?? ""
    });
    const snapshot = new SessionSnapshotRepository(db, auth.userId).create({
      sessionId: session.id,
      projectId: project.id,
      tmuxSession,
      modelId: model.id,
      metadata: { reason: "test" }
    });
    return { sessionId: session.id, snapshotId: snapshot.id };
  }
});

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

async function register(email: string): Promise<AuthContext> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" })
  });
  const body = (await res.json()) as { data: { token: string; user: { id: string } } };
  return { token: body.data.token, userId: body.data.user.id };
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}
