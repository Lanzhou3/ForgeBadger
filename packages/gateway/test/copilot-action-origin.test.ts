import assert from "node:assert/strict";
import { it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { PlatformActions } from "../src/services/platform-commands/actions.js";
import { createPlatformCommands } from "../src/services/platform-commands/catalog.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CopilotToolPreferenceRepository } from "../src/db/repositories/copilot-tool-preference-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { SessionWriterLeases } from "../src/services/session-writer-leases.js";

for (const origin of ["copilot", "legacy"] as const) it(`rechecks ${origin} Copilot authority after the tool is disabled, including reused previews`, async () => {
  const f = fixture();
  try {
    const { runId, newStepId } = copilotRun(f.db, f.user.id);
    const session = new SessionRepository(f.db, f.user.id).create({ projectId: f.project.id, name: "Session", aiTool: "kimi", workingDir: f.project.path });
    const runtimeSessionName = "fb-action-origin-fixture";
    const manager = new InMemorySessionManager({ async listSessions() { return [runtimeSessionName]; }, async hasSession() { return true; }, async createSession() {}, async killSession() {}, async capturePane() { return ""; } }, undefined, undefined, { db: f.db });
    await manager.attachExistingSession({ userId: f.user.id, sessionId: session.id, runtimeSessionName,
      launchPlan: { command: "kimi", args: [], cwd: f.project.path, env: {}, secretEnvNames: [], credentialMode: "host_environment" } });
    new SessionWriterLeases({ db: f.db }).acquire({ userId: f.user.id, sessionId: session.id, workspace: f.project.path });
    const key = newStepId();
    const actions = new PlatformActions({ ...f.context, sessionManager: manager, actionOrigin: { kind: "copilot", runId, stepId: key } }, createPlatformCommands());
    const request = { commandId: "session.takeover", input: { sessionId: session.id }, idempotencyKey: key };
    const intent = actions.preview(request);
    if (origin === "legacy") f.db.prepare("UPDATE platform_action_intents SET origin_kind='legacy',origin_run_id=NULL,origin_step_id=NULL WHERE id=?").run(intent.id);

    new CopilotToolPreferenceRepository(f.db, f.user.id).setEnabled("takeover_session", false);
    const resumed = new PlatformActions({ ...f.context, sessionManager: manager, actionOrigin: { kind: "owner_api" } }, createPlatformCommands());
    await assert.rejects(resumed.execute(intent.id), /Tool disabled/);
    assert.throws(() => resumed.preview(request), /Tool disabled/);
    assert.throws(() => manager.assertManualInputAllowed(f.user.id, session.id), /SESSION_WRITER_BUSY/);
    assert.equal(actions.intents.receipt(intent.id), undefined);
    await resumed.executeOwner("session.takeover", { sessionId: session.id }, randomUUID());
    assert.doesNotThrow(() => manager.assertManualInputAllowed(f.user.id, session.id));
  } finally { f.db.close(); }
});

it("reuses a confirmed owner result without rerunning revision-dependent preconditions", async () => {
  const f = fixture();
  try {
    const owner = new PlatformActions({ ...f.context, actionOrigin: { kind: "owner_api" } }, createPlatformCommands());
    const input = { projectId: f.project.id, expectedRevision: 0, nextAction: "Review" };
    const key = randomUUID();
    const first = await owner.executeOwner("pm.management.update", input, key);
    assert.deepEqual(await owner.executeOwner("pm.management.update", input, key), first);
    assert.equal((first as { revision: number }).revision, 1);
  } finally { f.db.close(); }
});

it("Copilot tool switches do not disable explicit owner actions", async () => {
  const f = fixture();
  try {
    new CopilotToolPreferenceRepository(f.db, f.user.id).setEnabled("pm_create_work_item", false);
    const { runId, newStepId } = copilotRun(f.db, f.user.id);
    const key = newStepId();
    assert.throws(() => copilotActions(f.db, f.user.id, runId, key).preview({ commandId: "pm.work_item.create", input: { projectId: f.project.id, title: "Blocked" }, idempotencyKey: key }), /Tool disabled/);

    const owner = new PlatformActions({ ...f.context, actionOrigin: { kind: "owner_api" } }, createPlatformCommands());
    await owner.executeOwner("pm.work_item.create", { projectId: f.project.id, title: "Owner action" }, randomUUID());
    assert.deepEqual(new ProjectManagerRepository(f.db, f.user.id).listWorkItems(f.project.id).map(item => item.title), ["Owner action"]);
  } finally { f.db.close(); }
});

function fixture() {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  const user = new UserRepository(db).create("copilot-action-origin@test.dev", "hash");
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: "Origin", path: "/tmp/copilot-action-origin-test", aiTool: "claude" });
  return { db, user, project, context: { db, userId: user.id } };
}

it("rechecks the tool switch after an external operation waits for the session mutex", async () => {
  const f = fixture();
  let release!: () => void;
  let execution: Promise<unknown> | undefined;
  try {
    const session = new SessionRepository(f.db, f.user.id).create({ projectId: f.project.id, name: "Waiting", aiTool: "kimi", workingDir: f.project.path });
    let launches = 0;
    const manager = new InMemorySessionManager({ async listSessions() { return []; }, async createSession() { launches++; }, async killSession() {}, async capturePane() { return ""; } });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lock = manager.runExclusive(session.id, () => gate);
    const { runId, newStepId } = copilotRun(f.db, f.user.id);
    const stepId = newStepId();
    const actions = new PlatformActions({ ...f.context, sessionManager: manager,
      adapterCommandRunner: async () => ({ exitCode: 0, stdout: "kimi 1.0.0", stderr: "" }),
      actionOrigin: { kind: "copilot", runId, stepId } }, createPlatformCommands());
    const intent = actions.preview({ commandId: "session.start", input: { sessionId: session.id }, idempotencyKey: stepId });
    execution = actions.execute(intent.id);
    for (let i = 0; i < 100 && actions.intents.get(intent.id)?.status !== "executing"; i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(actions.intents.get(intent.id)?.status, "executing");
    new CopilotToolPreferenceRepository(f.db, f.user.id).setEnabled("start_session", false);
    release();
    await lock;
    await assert.rejects(execution, /Tool disabled/);
    assert.equal(launches, 0);
    assert.equal(actions.intents.receipt(intent.id)?.outcome, "no_effect");
    assert.equal(new SessionRepository(f.db, f.user.id).getById(session.id)?.status, "idle");
  } finally { release?.(); await execution?.catch(() => undefined); f.db.close(); }
});

/** A copilot run with an active status, plus a factory for tool step ids usable as idempotency keys. */
function copilotRun(db: Database, userId: string) {
  const conversation = new CopilotConversationLog(db, userId).createConversation();
  const ledger = new CopilotRunLedger(db, userId);
  const runId = ledger.admit({ userId, conversationId: conversation.id, userText: "Create a work item" }, 10);
  return { runId, newStepId: () => ledger.addStep(runId, { kind: "tool", toolName: "pm_create_work_item" }).id };
}

function copilotActions(db: Database, userId: string, runId: string, stepId: string): PlatformActions {
  return new PlatformActions({ db, userId, actionOrigin: { kind: "copilot", runId, stepId } }, createPlatformCommands());
}

it("lets copilot-origin actions through and keeps the owner path unblocked", async () => {
  const f = fixture();
  try {
    const { runId, newStepId } = copilotRun(f.db, f.user.id);
    const key = newStepId();
    const actions = copilotActions(f.db, f.user.id, runId, key);
    const intent = actions.preview({ commandId: "pm.work_item.create", input: { projectId: f.project.id, title: "Implement add" }, idempotencyKey: key });
    assert.equal(intent.status, "approved");
    assert.equal(intent.origin_kind, "copilot");
    assert.equal(intent.origin_step_id, key);
    const receipt = await actions.execute(intent.id);
    assert.equal(receipt.outcome, "confirmed");
    assert.equal(new ProjectManagerRepository(f.db, f.user.id).listWorkItems(f.project.id).length, 1);

    const owner = new PlatformActions({ db: f.db, userId: f.user.id }, createPlatformCommands());
    const item = await owner.executeOwner("pm.work_item.create", { projectId: f.project.id, title: "Owner work" }, randomUUID());
    assert.equal((item as { title: string }).title, "Owner work");
    assert.equal(new ProjectManagerRepository(f.db, f.user.id).listWorkItems(f.project.id).length, 2);
  } finally { f.db.close(); }
});

it("rejects projectless copilot-origin commands as COPILOT_GLOBAL_ACTION_REQUIRES_WEB while the owner path stays open", async () => {
  const f = fixture();
  try {
    const { runId, newStepId } = copilotRun(f.db, f.user.id);
    const key = newStepId();
    const actions = copilotActions(f.db, f.user.id, runId, key);
    assert.throws(
      () => actions.preview({ commandId: "memory.write", input: { kind: "fact", scope: "global", text: "Global preference" }, idempotencyKey: key }),
      (error: unknown) => {
        const noEffect = error as Error & { httpStatus?: number };
        assert.match(noEffect.message, /^COPILOT_GLOBAL_ACTION_REQUIRES_WEB:/);
        assert.equal(noEffect.httpStatus, 409);
        return true;
      }
    );
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM platform_action_intents").get() as { n: number }).n, 0);

    const owner = new PlatformActions({ db: f.db, userId: f.user.id }, createPlatformCommands());
    const ownerIntent = owner.preview({ commandId: "memory.write", input: { kind: "fact", scope: "global", text: "Owner preference" }, idempotencyKey: randomUUID() });
    assert.equal(ownerIntent.status, "approved");
    const receipt = await owner.execute(ownerIntent.id);
    assert.equal(receipt.outcome, "confirmed");
  } finally { f.db.close(); }
});
