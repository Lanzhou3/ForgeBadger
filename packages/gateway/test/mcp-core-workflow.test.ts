import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { McpTokenRepository } from "../src/db/repositories/mcp-token-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { SkillRepository } from "../src/db/repositories/skill-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { createServer } from "../src/server.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { attachNotificationPersistence } from "../src/services/notification-events.js";
import { attachDispatchSupervisor } from "../src/services/agent/dispatch-supervisor.js";
import { RuntimeAuthorizationInvalidator } from "../src/services/runtime-authorization-invalidation.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { snapshotMcpProjects } from "../src/services/mcp/token-authority.js";
import { previewMcpConfig } from "../src/services/mcp/project-workflow.js";
import { withTaskPacketSessionLink } from "../src/services/project-manager/task-packets.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "0123456789abcdef0123456789abcdef";
process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = "abcdef0123456789abcdef0123456789";

type RpcResult = Record<string, unknown>;

async function rpc(port: number, token: string, name: string, args: Record<string, unknown> = {}): Promise<RpcResult> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  });
  const body = await response.text();
  const messages = body.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)) as { result: RpcResult });
  assert.equal(response.status, 200, body);
  const result = messages[0]?.result;
  assert.ok(result, body);
  return result;
}

function output(result: RpcResult): Record<string, unknown> {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  const content = result.content as Array<{ text: string }>;
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

describe("MCP private project development workflow", () => {
  let db: Database;
  let server: Server;
  let port: number;
  let userId: string;
  let root: string;
  let cliToken: string;
  let oldToken: string;
  let tokenId: string;
  let enterCount = 0;
  let pane = "› Ask Codex to do anything\nmodel · cwd";
  let onStage: (() => void) | undefined;
  let failStage = false;
  let stopSupervisor: () => void;
  let eventBus: ForgeBadgerEventBus;

  before(async () => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-mcp-flow-")));
    db = new Database(":memory:");
    migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
    userId = new UserRepository(db).create("mcp-flow@example.com", "hash").id;
    const tokens = new McpTokenRepository(db);
    const issued = tokens.create({ userId, name: "cli", scopes: ["read", "operate", "cli_dispatch"], allowedRoot: root, expiresAt: new Date(Date.now() + 3_600_000) });
    cliToken = issued.token;
    tokenId = issued.record.id;
    oldToken = tokens.create({ userId, name: "old", scopes: ["read", "operate"] }).token;
    eventBus = new ForgeBadgerEventBus();
    attachNotificationPersistence({ db, eventBus });
    const supervisor = attachDispatchSupervisor({ db, eventBus });
    stopSupervisor = () => supervisor.stop();
    const manager = new InMemorySessionManager({
      async createSession() {}, async killSession() {}, async sendInput() {}, async listSessions() { return []; },
      async hasSession() { return true; }, async capturePane() { return pane; },
      async inspectPane() { return { content: pane, dead: false }; },
      async stageProgrammaticInput(_name, data) { pane = `› ${data}\nmodel · cwd`; onStage?.(); if (failStage) throw new Error("stage interrupted"); },
      async pressEnter() { enterCount++; pane = "› Ask Codex to do anything\nmodel · cwd"; }
    }, undefined, undefined, { db, sleep: async () => {} });
    const app = createServer({ db, jwtSecret, masterKey, sessionManager: manager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }), eventBus, appVersion: "test",
      runtimeAuthorizationInvalidator: new RuntimeAuthorizationInvalidator(), mcpEnabled: true,
      adapterCommandRunner: async command => ({ exitCode: 0, stdout: `${command} 1.0.0`, stderr: "" }) });
    server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
    port = (server.address() as { port: number }).port;
  });

  after(async () => {
    stopSupervisor();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("preserves old token limits and rejects out-of-root writes", async () => {
    const old = await rpc(port, oldToken, "pm_execute_task_packet", { projectId: "x", workItemId: "y" });
    assert.equal(old.isError, true);
    assert.equal((await rpc(port, oldToken, "list_templates")).isError, true);
    const outside = await rpc(port, cliToken, "create_project", {
      operationId: "outside", name: "outside", path: path.join(tmpdir(), `fb-outside-${randomUUID()}`)
    });
    assert.equal(outside.isError, true);
    assert.match((outside.content as Array<{ text: string }>)[0]!.text, /outside its allowed directory/);
  });

  it("previews a built-in template without changing the database", async () => {
    const projectPath = path.join(root, "preview-only");
    mkdirSync(projectPath);
    const project = new ProjectRepository(db, userId).create({ name: "preview-only", path: projectPath, aiTool: "codex" });
    const before = (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
    const preview = await previewMcpConfig(db, userId, project.id, "builtin-codex");
    const after = (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
    assert.equal(preview.applicable, true);
    assert.equal(after, before);
  });

  it("creates and configures a project, dispatches once, and closes only for review", async () => {
    const templateList = output(await rpc(port, cliToken, "list_templates"));
    const templates = templateList.templates as Array<{ id: string }>;
    assert.ok(templates.some(template => template.id === "builtin-codex"));
    const projectPath = path.join(root, "app");
    const created = output(await rpc(port, cliToken, "create_project", {
      operationId: "create-app", name: "app", path: projectPath, templateId: "builtin-codex"
    }));
    const projectId = created.id as string;
    assert.ok(projectId);
    const repeat = output(await rpc(port, cliToken, "create_project", {
      operationId: "create-app", name: "app", path: projectPath, templateId: "builtin-codex"
    }));
    assert.equal(repeat.id, projectId);
    const preview = output(await rpc(port, cliToken, "preview_project_config", { projectId, templateId: "builtin-codex" }));
    assert.equal(preview.applicable, true);
    const applied = output(await rpc(port, cliToken, "apply_project_config", {
      operationId: "apply-app", projectId, templateId: "builtin-codex", expectedDigest: preview.digest
    }));
    assert.equal(applied.outcome, "applied");
    const item = output(await rpc(port, cliToken, "pm_create_work_item", {
      operationId: "work-app", projectId, title: "Implement feature", acceptanceCriteria: ["tests pass"]
    }));
    const workItemId = item.id as string;
    assert.ok(workItemId);
    const dispatch = output(await rpc(port, cliToken, "pm_execute_task_packet", {
      operationId: "dispatch-app", projectId, workItemId, aiTool: "codex"
    }));
    assert.equal(dispatch.executionStatus, "dispatched");
    assert.equal(enterCount, 1);
    const retry = output(await rpc(port, cliToken, "pm_execute_task_packet", {
      operationId: "dispatch-app", projectId, workItemId, aiTool: "codex"
    }));
    assert.equal(retry.attemptId, dispatch.attemptId);
    assert.equal(enterCount, 1);
    const receipt = output(await rpc(port, cliToken, "get_mcp_operation", { operationId: "dispatch-app" }));
    assert.equal(receipt.status, "completed");
    const session = dispatch.session as { id: string };
    eventBus.emitEvent({ type: "session_notification", userId, projectId, sessionId: session.id,
      hookEventName: "Stop", notificationType: "task_completed", message: "Finished" });
    const progress = output(await rpc(port, cliToken, "pm_get_task_progress", { projectId, workItemId }));
    assert.equal(progress.found, true);
    const notifications = progress.notifications as Array<{ id: string }>;
    assert.ok(notifications[0]?.id);
    const closed = output(await rpc(port, cliToken, "pm_close_task", {
      operationId: "close-app", projectId, workItemId, attemptId: dispatch.attemptId,
      notificationId: notifications[0]!.id, summary: "Implementation finished; review pending."
    }));
    assert.equal(closed.status, "ready_for_review");
    assert.equal(new ProjectManagerRepository(db, userId).getWorkItem(projectId, workItemId)?.status, "ready_for_review");
    pane = "OPENAI_API_KEY=sk-test-secret-from-terminal";
    const terminal = output(await rpc(port, cliToken, "get_session_output", { sessionId: session.id }));
    assert.doesNotMatch(JSON.stringify(terminal), /sk-test-secret-from-terminal/);
    pane = '{"api_key":"plain-demo-key","password":"plain-demo-password","access_token":"plain-demo-token","secret_key":"plain-demo-json-secret"}';
    const jsonTerminal = output(await rpc(port, cliToken, "get_session_output", { sessionId: session.id }));
    assert.doesNotMatch(JSON.stringify(jsonTerminal), /plain-demo-/);
    pane = `${pane}\n${"x".repeat(50_000)}`;
    const cappedTerminal = output(await rpc(port, cliToken, "get_session_output", { sessionId: session.id }));
    assert.equal(cappedTerminal.truncated, true);
    assert.doesNotMatch(JSON.stringify(cappedTerminal), /plain-demo-/);
    pane = "AWS_SECRET_ACCESS_KEY=plain-demo-aws GITHUB_TOKEN=plain-demo-github";
    const envTerminal = output(await rpc(port, cliToken, "get_session_output", { sessionId: session.id }));
    assert.doesNotMatch(JSON.stringify(envTerminal), /plain-demo-/);
  });

  it("dispatches with a permanent multi-project token and rechecks revocation before Enter", async () => {
    pane = "› Ask Codex to do anything\nmodel · cwd";
    const selected = new ProjectRepository(db, userId).list().filter(project => ["app", "preview-only"].includes(project.name));
    const grant = new McpTokenRepository(db).create({ userId, name: "permanent", scopes: ["read", "operate", "cli_dispatch"],
      allowedProjects: snapshotMcpProjects(db, userId, selected.map(project => project.id)) });
    assert.equal(grant.record.expiresAt, null);
    const projectId = selected.find(project => project.name === "app")!.id;
    const before = enterCount;
    const item = output(await rpc(port, grant.token, "pm_create_work_item", { operationId: "permanent-work", projectId, title: "Permanent access" }));
    const dispatched = output(await rpc(port, grant.token, "pm_execute_task_packet", { operationId: "permanent-dispatch", projectId, workItemId: item.id, aiTool: "codex" }));
    assert.equal(dispatched.executionStatus, "dispatched");
    assert.equal(enterCount, before + 1);
    const next = output(await rpc(port, grant.token, "pm_create_work_item", { operationId: "permanent-revoke-work", projectId, title: "Revoke at checkpoint" }));
    onStage = () => { new McpTokenRepository(db).revokeByIdAndUser(grant.record.id, userId); };
    try {
      const rejected = await rpc(port, grant.token, "pm_execute_task_packet", { operationId: "permanent-revoke", projectId, workItemId: next.id, aiTool: "codex" });
      assert.equal(rejected.isError, true);
      assert.equal(enterCount, before + 1);
    } finally { onStage = undefined; }
  });

  it("rejects expired CLI tokens", async () => {
    const expired = new McpTokenRepository(db).create({ userId, name: "expired", scopes: ["read", "operate", "cli_dispatch"],
      allowedRoot: root, expiresAt: new Date(Date.now() - 1000) });
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${expired.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    assert.equal(response.status, 401);
  });

  it("imports an existing directory but preserves conflicting owner files", async () => {
    const importedPath = path.join(root, "existing");
    mkdirSync(importedPath);
    writeFileSync(path.join(importedPath, "AGENTS.md"), "owner instructions\n");
    const project = output(await rpc(port, cliToken, "import_project", {
      operationId: "import-existing", name: "existing", path: importedPath, templateId: "builtin-codex"
    }));
    const preview = output(await rpc(port, cliToken, "preview_project_config", {
      projectId: project.id, templateId: "builtin-codex"
    }));
    assert.equal(preview.applicable, false);
    const apply = await rpc(port, cliToken, "apply_project_config", {
      operationId: "apply-conflict", projectId: project.id, templateId: "builtin-codex", expectedDigest: preview.digest
    });
    assert.equal(apply.isError, true);
    const retry = await rpc(port, cliToken, "apply_project_config", {
      operationId: "apply-conflict", projectId: project.id, templateId: "builtin-codex", expectedDigest: preview.digest
    });
    assert.equal(retry.isError, true);
    const receipt = output(await rpc(port, cliToken, "get_mcp_operation", { operationId: "apply-conflict" }));
    assert.equal((receipt.receipt as { outcome: string }).outcome, "no_effect");
    assert.equal(readFileSync(path.join(importedPath, "AGENTS.md"), "utf8"), "owner instructions\n");
  });

  it("reports uncertain dispatch receipts as errors on the same-ID retry", async () => {
    pane = "› Ask Codex to do anything\nmodel · cwd";
    const projects = output(await rpc(port, cliToken, "list_projects"));
    const projectId = (projects.projects as Array<{ id: string; name: string }>).find(row => row.name === "app")!.id;
    const item = output(await rpc(port, cliToken, "pm_create_work_item", {
      operationId: "uncertain-work", projectId, title: "Uncertain staging"
    }));
    const args = { operationId: "uncertain-dispatch", projectId, workItemId: item.id, aiTool: "codex" };
    const beforeEnter = enterCount;
    failStage = true;
    const first = await rpc(port, cliToken, "pm_execute_task_packet", args);
    failStage = false;
    const retry = await rpc(port, cliToken, "pm_execute_task_packet", args);
    assert.equal(first.isError, true);
    assert.equal(retry.isError, true);
    assert.equal(enterCount, beforeEnter);
    const receipt = output(await rpc(port, cliToken, "get_mcp_operation", { operationId: "uncertain-dispatch" }));
    assert.equal((receipt.receipt as { outcome: string }).outcome, "unknown");
  });

  it("refuses to export a stale enabled local Skill without mutating its snapshot", async () => {
    const projects = output(await rpc(port, cliToken, "list_projects"));
    const projectId = (projects.projects as Array<{ id: string; name: string }>).find(row => row.name === "app")!.id;
    const skill = new SkillRepository(db, userId).create({
      name: "stale-mcp-skill", source: "local", content: "old snapshot", isEnabled: true,
      resourceManifest: JSON.stringify({ sourcePath: path.join(root, "missing", "SKILL.md") })
    });
    const preview = await rpc(port, cliToken, "preview_project_config", { projectId, templateId: "builtin-codex" });
    assert.equal(preview.isError, true);
    assert.match((preview.content as Array<{ text: string }>)[0]!.text, /changed or was rejected/);
    // The MCP preview does not rewrite the stale Skill record.
    assert.equal(new SkillRepository(db, userId).getById(skill.id)?.content, "old snapshot");
  });

  it("rejects paths overlapping another tenant's project", async () => {
    const other = new UserRepository(db).create("mcp-other@example.com", "hash");
    const foreignPath = path.join(root, "foreign");
    mkdirSync(foreignPath);
    new ProjectRepository(db, other.id).create({ name: "foreign", path: foreignPath, aiTool: "codex" });
    const imported = await rpc(port, cliToken, "import_project", {
      operationId: "import-foreign", name: "alias", path: foreignPath
    });
    const nested = await rpc(port, cliToken, "create_project", {
      operationId: "create-foreign-child", name: "child", path: path.join(foreignPath, "child")
    });
    assert.equal(imported.isError, true);
    assert.equal(nested.isError, true);
    assert.match((nested.content as Array<{ text: string }>)[0]!.text, /foreign-owned project/);
  });

  it("accepts an in-root project whose first segment begins with two dots", async () => {
    const projectPath = path.join(root, "..valid-project");
    const created = output(await rpc(port, cliToken, "create_project", {
      operationId: "dot-prefix-project", name: "dot-prefix", path: projectPath
    }));
    assert.ok(created.id);
    assert.equal(output(await rpc(port, cliToken, "get_project", { projectId: created.id })).found, true);
  });

  it("ignores a foreign project's stale denied symlink without weakening overlap checks", { skip: process.platform === "win32" }, async () => {
    const other = new UserRepository(db).create("mcp-stale-foreign@example.com", "hash");
    const foreignPath = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-mcp-stale-foreign-")));
    const foreign = new ProjectRepository(db, other.id).create({ name: "stale", path: foreignPath, aiTool: "codex" });
    rmSync(foreignPath, { recursive: true });
    symlinkSync("/etc", foreignPath);
    try {
      const projects = output(await rpc(port, cliToken, "list_projects"));
      const app = (projects.projects as Array<{ id: string; name: string }>).find(row => row.name === "app");
      assert.ok(app);
      assert.equal(output(await rpc(port, cliToken, "get_project", { projectId: app.id })).found, true);
    } finally {
      db.prepare("DELETE FROM projects WHERE id = ?").run(foreign.id);
      rmSync(foreignPath, { force: true });
    }
  });

  it("limits project and terminal reads to the token root", async () => {
    const outsideRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-mcp-read-outside-")));
    try {
      const outside = new ProjectRepository(db, userId).create({ name: "outside", path: outsideRoot, aiTool: "codex" });
      for (let index = 0; index < 55; index++) {
        new ProjectRepository(db, userId).create({ name: `outside-${index}`, path: path.join(outsideRoot, `p-${index}`), aiTool: "codex" });
      }
      const session = new SessionRepository(db, userId).create({ projectId: outside.id, name: "outside", aiTool: "codex", workingDir: outsideRoot });
      const insidePath = path.join(root, "session-boundary");
      mkdirSync(insidePath);
      const inside = new ProjectRepository(db, userId).create({ name: "session-boundary", path: insidePath, aiTool: "codex" });
      const mismatched = new SessionRepository(db, userId).create({
        projectId: inside.id, name: "outside-working-dir", aiTool: "codex", workingDir: outsideRoot
      });
      const tasks = new ProjectManagerRepository(db, userId);
      const workItem = tasks.createWorkItem(inside.id, { title: "mismatched task" });
      tasks.updateWorkItem(inside.id, workItem.id, {
        details: withTaskPacketSessionLink(workItem.details, mismatched, inside)
      });
      const listed = output(await rpc(port, cliToken, "list_projects"));
      assert.equal((listed.projects as Array<{ id: string }>).some(project => project.id === outside.id), false);
      assert.equal((listed.projects as Array<{ name: string }>).some(project => project.name === "app"), true);
      const sessions = output(await rpc(port, cliToken, "list_sessions"));
      assert.equal((sessions.sessions as Array<{ id: string }>).some(row => row.id === mismatched.id), false);
      const projectRead = await rpc(port, cliToken, "get_project", { projectId: outside.id });
      const terminalRead = await rpc(port, cliToken, "get_session_output", { sessionId: session.id });
      const mismatchedRead = await rpc(port, cliToken, "get_session", { sessionId: mismatched.id });
      const mismatchedTerminal = await rpc(port, cliToken, "get_session_output", { sessionId: mismatched.id });
      const mismatchedStart = await rpc(port, cliToken, "start_session", { operationId: "outside-working-dir-start", sessionId: mismatched.id });
      const taskRead = await rpc(port, cliToken, "pm_get_task_packet", { projectId: inside.id, workItemId: workItem.id });
      const progressRead = await rpc(port, cliToken, "pm_get_task_progress", { projectId: inside.id, workItemId: workItem.id });
      const taskList = await rpc(port, cliToken, "pm_list_task_packets", { projectId: inside.id });
      assert.equal(projectRead.isError, true);
      assert.equal(terminalRead.isError, true);
      assert.equal(mismatchedRead.isError, true);
      assert.equal(mismatchedTerminal.isError, true);
      assert.equal(mismatchedStart.isError, true);
      assert.equal(taskRead.isError, true);
      assert.equal(progressRead.isError, true);
      assert.equal(taskList.isError, true);
    } finally { rmSync(outsideRoot, { recursive: true, force: true }); }
  });

  it("dispatches free-form messages to a running unlinked session with a CLI token", async () => {
    pane = "› Ask Codex to do anything\nmodel · cwd";
    const projectPath = path.join(root, `direct-dispatch-${randomUUID()}`);
    mkdirSync(projectPath);
    const project = new ProjectRepository(db, userId).create({ name: "direct-dispatch", path: projectPath, aiTool: "codex" });
    const session = new SessionRepository(db, userId).create({ projectId: project.id, name: "direct", aiTool: "codex", workingDir: projectPath });
    const started = output(await rpc(port, cliToken, "start_session", { operationId: "direct-start", sessionId: session.id }));
    assert.equal(started.status, "running");
    // A missing session fails before any intent exists; the same operationId stays reusable.
    const missing = await rpc(port, cliToken, "dispatch_task_to_session", {
      operationId: "direct-missing", sessionId: `missing-${randomUUID()}`, message: "hello"
    });
    assert.equal(missing.isError, true);
    assert.match((missing.content as Array<{ text: string }>)[0]!.text, /Session not found/);
    const message = "Please summarize the project layout in one short paragraph.";
    const beforeEnter = enterCount;
    const dispatched = output(await rpc(port, cliToken, "dispatch_task_to_session", {
      operationId: "direct-dispatch", sessionId: session.id, message
    }));
    assert.equal(dispatched.dispatched, true);
    assert.equal(dispatched.delivery, "consumed");
    assert.equal(enterCount, beforeEnter + 1);
    // The same operationId replays the durable receipt without a second Enter.
    const replay = output(await rpc(port, cliToken, "dispatch_task_to_session", {
      operationId: "direct-dispatch", sessionId: session.id, message
    }));
    assert.equal(replay.dispatched, true);
    assert.equal(enterCount, beforeEnter + 1);
    const receipt = output(await rpc(port, cliToken, "get_mcp_operation", { operationId: "direct-dispatch" }));
    assert.equal(receipt.status, "completed");
    // Task-packet-linked sessions refuse direct dispatch.
    const item = output(await rpc(port, cliToken, "pm_create_work_item", {
      operationId: "direct-linked-work", projectId: project.id, title: "Linked guard"
    }));
    const packet = output(await rpc(port, cliToken, "pm_execute_task_packet", {
      operationId: "direct-linked-dispatch", projectId: project.id, workItemId: item.id, aiTool: "codex"
    }));
    assert.equal(packet.executionStatus, "dispatched");
    const packetSessionId = (packet.session as { id: string }).id;
    assert.notEqual(packetSessionId, session.id);
    const rejected = await rpc(port, cliToken, "dispatch_task_to_session", {
      operationId: "direct-linked-refuse", sessionId: packetSessionId, message: "bypass the packet"
    });
    assert.equal(rejected.isError, true);
    assert.match((rejected.content as Array<{ text: string }>)[0]!.text, /TASK_SESSION_REQUIRES_PACKET_EXECUTION/);
  });

  it("stops before Enter when the token is revoked during staging", async () => {
    pane = "› Ask Codex to do anything\nmodel · cwd";
    const project = output(await rpc(port, cliToken, "list_projects"));
    const projectId = (project.projects as Array<{ id: string }>).find(row => row.name === "app")!.id;
    const item = output(await rpc(port, cliToken, "pm_create_work_item", {
      operationId: "revoked-work", projectId, title: "Revocation checkpoint"
    }));
    const beforeEnter = enterCount;
    onStage = () => { new McpTokenRepository(db).revokeByIdAndUser(tokenId, userId); };
    const dispatch = await rpc(port, cliToken, "pm_execute_task_packet", {
      operationId: "revoked-dispatch", projectId, workItemId: item.id, aiTool: "codex"
    });
    onStage = undefined;
    assert.equal(dispatch.isError, true);
    assert.equal(enterCount, beforeEnter);
  });

  it("rejects a revoked token before a new effect", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${cliToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    assert.equal(response.status, 401);
  });
});
