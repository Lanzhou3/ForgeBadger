/**
 * Real-tmux verification for dispatch delivery confirmation (post-M3): the
 * E2E-M3 acceptance run proved that `tmux send-keys` succeeds while a modal
 * dialog (Claude Code's trust prompt) swallows the input. This test drives the
 * real internal bridge route against real tmux sessions:
 * - a plain shell echoes the dispatched message -> 200 + delivery "confirmed";
 * - vim (a modal program) mangles the input as normal-mode commands -> the
 *   pane never shows the message -> 502 + delivery_unconfirmed.
 *
 * Skipped unless RUN_TMUX_TESTS=1 (real tmux required).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp, type GatewayApp } from "../../src/server.js";
import { InMemorySessionManager } from "../../src/services/session-manager.js";
import { createTmuxClient } from "../../src/services/tmux.js";
import { InMemoryApiKeyStore } from "../../src/secrets/api-key-store.js";
import { UserRepository } from "../../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../../src/db/repositories/project-repository.js";
import { SessionRepository } from "../../src/db/repositories/session-repository.js";

const runTmuxTests = process.env.RUN_TMUX_TESTS === "1";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const bridgeToken = "dispatch-delivery-it-token-0123456789abcdef";

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;
// Short read-back budget: vim must fail fast; the shell confirms on poll one.
process.env.OPENFORGE_DISPATCH_CONFIRM_TIMEOUT_MS = "3000";
process.env.OPENFORGE_DISPATCH_CONFIRM_INTERVAL_MS = "200";

describe("dispatch delivery confirmation (real tmux)", { skip: !runTmuxTests }, () => {
  let app: GatewayApp;
  let baseUrl: string;
  let userId: string;
  let shellSessionId: string;
  let vimSessionId: string;
  const tmuxNames: string[] = [];

  async function createTargetSession(
    db: Database.Database,
    sessionManager: InMemorySessionManager,
    projectId: string,
    name: string,
    command: string
  ): Promise<string> {
    const sessionId = new SessionRepository(db, userId).create({
      projectId,
      name,
      aiTool: "claude",
      workingDir: "/tmp"
    }).id;
    const session = await sessionManager.createSession({
      userId,
      sessionId,
      launchPlan: { command, args: [], cwd: "/tmp", env: {}, secretEnvNames: [], credentialMode: "host_environment" }
    });
    tmuxNames.push(session.tmuxName);
    return sessionId;
  }

  async function dispatch(sessionId: string, message: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${sessionId}/dispatch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bridgeToken}`,
        "x-openforge-user-id": userId,
        "content-type": "application/json"
      },
      body: JSON.stringify({ message })
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  before(async () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(drizzle(db), {
      migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations")
    });
    const sessionManager = new InMemorySessionManager(createTmuxClient(), undefined, undefined, {
      tmuxPrefix: `ofdlv${process.pid}-`
    });
    app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      copilotBridgeToken: bridgeToken
    });
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = `http://127.0.0.1:${address.port}`;

    userId = new UserRepository(db).create("dispatch-delivery@example.com", "hash").id;
    const projectId = new ProjectRepository(db, userId).create({
      name: "Dispatch delivery verification",
      path: "/tmp",
      aiTool: "claude"
    }).id;
    shellSessionId = await createTargetSession(db, sessionManager, projectId, "shell target", "bash");
    vimSessionId = await createTargetSession(db, sessionManager, projectId, "vim target", "vim");
    // Let both processes draw their first screen.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

  after(async () => {
    const tmux = createTmuxClient();
    for (const name of tmuxNames) await tmux.killSession(name);
    await app.close();
  });

  it("confirms delivery to a plain shell session", async () => {
    const marker = `echo SHELL_OK_${process.pid}`;
    const { status, body } = await dispatch(shellSessionId, marker);
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.data, { dispatched: true, sessionId: shellSessionId, delivery: "confirmed" });
  });

  it("rejects with delivery_unconfirmed when vim swallows the input", async () => {
    const marker = `echo VIM_MODAL_${process.pid}`;
    const { status, body } = await dispatch(vimSessionId, marker);
    assert.equal(status, 502, JSON.stringify(body));
    const details = body.details as { code?: string; reason?: string } | undefined;
    assert.equal(details?.code, "BRIDGE_DELIVERY_UNCONFIRMED");
    assert.equal(details?.reason, "delivery_unconfirmed");
  });
});
