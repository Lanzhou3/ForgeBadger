/**
 * Real-tmux verification for dispatch delivery confirmation (post-M3): the
 * This test drives the real internal bridge route and real tmux process while
 * using a deterministic Claude-shaped fake TUI. One target consumes the
 * staged composer after Enter; the other leaves it unchanged.
 *
 * Skipped unless RUN_TMUX_TESTS=1 (real tmux required).
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;
// Short read-back budget: the unchanged composer must fail fast.
process.env.FORGEBADGER_DISPATCH_CONFIRM_TIMEOUT_MS = "3000";
process.env.FORGEBADGER_DISPATCH_CONFIRM_INTERVAL_MS = "200";

describe("dispatch delivery confirmation (real tmux)", { skip: !runTmuxTests }, () => {
  let app: GatewayApp;
  let baseUrl: string;
  let userId: string;
  let consumedSessionId: string;
  let stuckSessionId: string;
  let fakeCliRoot: string;
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
      launchPlan: { command, args: [], cwd: fakeCliRoot, env: {}, secretEnvNames: [], credentialMode: "host_environment" }
    });
    tmuxNames.push(session.tmuxName);
    return sessionId;
  }

  async function dispatch(sessionId: string, message: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${sessionId}/dispatch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bridgeToken}`,
        "x-forgebadger-user-id": userId,
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
    fakeCliRoot = mkdtempSync(path.join(tmpdir(), "forgebadger-dispatch-cli-"));
    const consumingCommand = writeFakeClaude(fakeCliRoot, "consume", true);
    const stuckCommand = writeFakeClaude(fakeCliRoot, "stuck", false);
    const projectId = new ProjectRepository(db, userId).create({
      name: "Dispatch delivery verification",
      path: "/tmp",
      aiTool: "claude"
    }).id;
    consumedSessionId = await createTargetSession(db, sessionManager, projectId, "consuming target", consumingCommand);
    stuckSessionId = await createTargetSession(db, sessionManager, projectId, "stuck target", stuckCommand);
    // Let both processes draw their first screen.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

  after(async () => {
    const tmux = createTmuxClient();
    for (const name of tmuxNames) await tmux.killSession(name);
    await app.close();
    rmSync(fakeCliRoot, { recursive: true, force: true });
  });

  it("confirms only after the current CLI composer consumes the staged task", async () => {
    const marker = `TASK_OK_${process.pid}`;
    const { status, body } = await dispatch(consumedSessionId, marker);
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.data, { dispatched: true, sessionId: consumedSessionId, delivery: "consumed" });
  });

  it("returns an indeterminate non-retryable result when the composer remains", async () => {
    const marker = `TASK_STUCK_${process.pid}`;
    const { status, body } = await dispatch(stuckSessionId, marker);
    assert.equal(status, 502, JSON.stringify(body));
    const details = body.details as { code?: string; reason?: string; retryable?: boolean } | undefined;
    assert.equal(details?.code, "BRIDGE_DELIVERY_UNCONFIRMED");
    assert.equal(details?.reason, "submission_indeterminate");
    assert.equal(details?.retryable, false);
  });
});

function writeFakeClaude(root: string, name: string, consumes: boolean): string {
  const directory = path.join(root, name);
  const command = path.join(directory, "claude");
  mkdirSync(directory, { recursive: true });
  const render = "(body)=>process.stdout.write('\\u001b[2J\\u001b[H'+body)";
  const script = [
    "#!/usr/bin/env node",
    "process.stdin.setRawMode(true); process.stdin.resume();",
    `const render=${render};`,
    "const ready='────────────────\\n❯  \\n────────────────\\nauto mode on';",
    "render(ready); let bytes=[]; let payload='';",
    "process.stdin.on('data',(chunk)=>{",
    "  let submitted=false;",
    "  for (const byte of chunk) {",
    "    if (byte === 13) {",
    consumes
      ? "      render(payload+'\\n────────────────\\n❯  \\n────────────────\\nauto mode on');"
      : "      render('────────────────\\n❯ '+payload+'\\n────────────────\\nauto mode on');",
    "      submitted=true;",
    "      continue;",
    "    }",
    "    bytes.push(byte);",
    "  }",
    "  if (submitted) return;",
    "  const text=Buffer.from(bytes).toString('utf8');",
    "  if (text.includes('\\u001b[201~')) {",
    "    payload=text.replace('\\u001b[200~','').replace('\\u001b[201~','');",
    "    render('────────────────\\n❯ '+payload+'\\n────────────────\\nauto mode on');",
    "  }",
    "});"
  ].join("\n");
  writeFileSync(command, script, { mode: 0o700 });
  chmodSync(command, 0o700);
  return command;
}
