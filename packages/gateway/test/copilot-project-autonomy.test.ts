import assert from "node:assert/strict";
import { it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { projectManagementOverview } from "../src/services/project-manager/management.js";
import { PlatformActions } from "../src/services/platform-commands/actions.js";
import { PlatformNoEffectError } from "../src/services/platform-commands/errors.js";
import { createPlatformCommands } from "../src/services/platform-commands/catalog.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { signJwt } from "../src/auth/jwt.js";
import { createProjectManagementRoutes } from "../src/routes/project-management.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { fileURLToPath } from "node:url";
import { CopilotToolPreferenceRepository } from "../src/db/repositories/copilot-tool-preference-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { SessionWriterLeases } from "../src/services/session-writer-leases.js";

for (const origin of ["copilot", "legacy"] as const) it(`rechecks ${origin} Copilot authority after autonomy is revoked, including reused previews`, async () => {
  const f = fixture();
  try {
    const projects = new ProjectRepository(f.db, f.user.id);
    projects.setCopilotAutonomy(f.project.id, true);
    const { runId, newStepId } = copilotRun(f.db, f.user.id);
    const session = new SessionRepository(f.db, f.user.id).create({ projectId: f.project.id, name: "Session", aiTool: "kimi", workingDir: f.project.path });
    const runtimeSessionName = "fb-autonomy-fixture";
    const manager = new InMemorySessionManager({ async listSessions() { return [runtimeSessionName]; }, async hasSession() { return true; }, async createSession() {}, async killSession() {}, async capturePane() { return ""; } }, undefined, undefined, { db: f.db });
    await manager.attachExistingSession({ userId: f.user.id, sessionId: session.id, runtimeSessionName,
      launchPlan: { command: "kimi", args: [], cwd: f.project.path, env: {}, secretEnvNames: [], credentialMode: "host_environment" } });
    new SessionWriterLeases({ db: f.db }).acquire({ userId: f.user.id, sessionId: session.id, workspace: f.project.path });
    const key = newStepId();
    const actions = new PlatformActions({ ...f.context, sessionManager: manager, actionOrigin: { kind: "copilot", runId, stepId: key } }, createPlatformCommands());
    const request = { commandId: "session.takeover", input: { sessionId: session.id }, idempotencyKey: key };
    const intent = actions.preview(request);
    if (origin === "legacy") f.db.prepare("UPDATE platform_action_intents SET origin_kind='legacy',origin_run_id=NULL,origin_step_id=NULL WHERE id=?").run(intent.id);

    projects.setCopilotAutonomy(f.project.id, false);
    const resumed = new PlatformActions({ ...f.context, sessionManager: manager, actionOrigin: { kind: "owner_api" } }, createPlatformCommands());
    await assert.rejects(resumed.execute(intent.id), /COPILOT_PROJECT_AUTONOMY_OFF/);
    assert.throws(() => resumed.preview(request), /COPILOT_PROJECT_AUTONOMY_OFF/);
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
    new ProjectRepository(f.db, f.user.id).setCopilotAutonomy(f.project.id, true);
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
  const user = new UserRepository(db).create("copilot-autonomy@test.dev", "hash");
  const other = new UserRepository(db).create("other-copilot-autonomy@test.dev", "hash");
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: "Autonomy", path: "/tmp/copilot-autonomy-test", aiTool: "claude" });
  const foreign = new ProjectRepository(db, other.id).create({ name: "Foreign", path: "/tmp/copilot-autonomy-foreign", aiTool: "" });
  return { db, user, other, project, foreign, context: { db, userId: user.id } };
}

for (const revocation of ["autonomy", "tool"] as const) {
  it(`rechecks ${revocation} after an external operation waits for the session mutex`, async () => {
    const f = fixture();
    let release!: () => void;
    let execution: Promise<unknown> | undefined;
    try {
      const projects = new ProjectRepository(f.db, f.user.id);
      projects.setCopilotAutonomy(f.project.id, true);
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
      if (revocation === "autonomy") projects.setCopilotAutonomy(f.project.id, false);
      else new CopilotToolPreferenceRepository(f.db, f.user.id).setEnabled("start_session", false);
      release();
      await lock;
      await assert.rejects(execution, revocation === "autonomy" ? /COPILOT_PROJECT_AUTONOMY_OFF/ : /Tool disabled/);
      assert.equal(launches, 0);
      assert.equal(actions.intents.receipt(intent.id)?.outcome, "no_effect");
      assert.equal(new SessionRepository(f.db, f.user.id).getById(session.id)?.status, "idle");
    } finally { release?.(); await execution?.catch(() => undefined); f.db.close(); }
  });
}

it("defaults new projects to copilot autonomy off and persists owner-scoped updates", () => {
  const f = fixture();
  try {
    const repo = new ProjectRepository(f.db, f.user.id);
    assert.equal(repo.getCopilotAutonomy(f.project.id), false);
    assert.equal(repo.setCopilotAutonomy(f.project.id, true)!.copilotAutonomy, true);
    assert.equal(repo.getCopilotAutonomy(f.project.id), true);
    assert.equal((f.db.prepare("SELECT copilot_autonomy AS value FROM projects WHERE id = ?").get(f.project.id) as { value: number }).value, 1);
    assert.equal(repo.setCopilotAutonomy(f.project.id, false)!.copilotAutonomy, false);
    assert.equal(repo.getCopilotAutonomy("missing-project"), undefined);
    assert.equal(repo.setCopilotAutonomy("missing-project", true), undefined);
  } finally { f.db.close(); }
});

it("keeps copilot autonomy scoped to the project owner", () => {
  const f = fixture();
  try {
    const repo = new ProjectRepository(f.db, f.user.id);
    assert.equal(repo.setCopilotAutonomy(f.project.id, true)!.copilotAutonomy, true);
    const otherRepo = new ProjectRepository(f.db, f.other.id);
    assert.equal(otherRepo.getCopilotAutonomy(f.project.id), undefined);
    assert.equal(otherRepo.setCopilotAutonomy(f.project.id, false), undefined);
    assert.equal(repo.getCopilotAutonomy(f.project.id), true);
  } finally { f.db.close(); }
});

it("PATCH /projects/:id/copilot-autonomy validates the body, scopes to the owner, and reports the new value", async () => {
  const f = fixture();
  const app = express();
  const jwtSecret = randomUUID();
  app.locals.db = f.db; app.locals.jwtSecret = jwtSecret;
  app.use(express.json());
  app.use("/api/v1", createProjectManagementRoutes(f.db, () => { throw new Error("executeOwner must not be used for copilot autonomy"); }));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const headers = { Authorization: `Bearer ${signJwt({ userId: f.user.id, email: f.user.email }, jwtSecret)}`, "Content-Type": "application/json" };
  const patch = (id: string, body: unknown) => fetch(`${base}/projects/${id}/copilot-autonomy`, { method: "PATCH", headers, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/projects/${f.project.id}/copilot-autonomy`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) })).status, 401);
    assert.equal((await patch(f.project.id, {})).status, 400);
    assert.equal((await patch(f.project.id, { enabled: "yes" })).status, 400);
    assert.equal((await patch(f.project.id, { enabled: true, extra: 1 })).status, 400);
    assert.equal((await patch("missing-project", { enabled: true })).status, 404);
    assert.equal((await patch(f.foreign.id, { enabled: true })).status, 404);
    const ok = await patch(f.project.id, { enabled: true });
    assert.equal(ok.status, 200);
    const data = await ok.json() as { code: number; data: { projectId: string; copilotAutonomy: boolean } };
    assert.equal(data.code, 0);
    assert.equal(data.data.projectId, f.project.id);
    assert.equal(data.data.copilotAutonomy, true);
    const off = await patch(f.project.id, { enabled: false });
    assert.equal(off.status, 200);
    assert.equal((await off.json() as { data: { copilotAutonomy: boolean } }).data.copilotAutonomy, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.db.close();
  }
});

it("includes copilotAutonomy in the project management overview", () => {
  const f = fixture();
  try {
    assert.equal(projectManagementOverview(f.context).projects[0]!.copilotAutonomy, false);
    new ProjectRepository(f.db, f.user.id).setCopilotAutonomy(f.project.id, true);
    assert.equal(projectManagementOverview(f.context, [f.project.id]).projects[0]!.copilotAutonomy, true);
  } finally { f.db.close(); }
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

it("rejects copilot-origin platform actions while project autonomy is off, without creating an intent", () => {
  const f = fixture();
  try {
    const { runId, newStepId } = copilotRun(f.db, f.user.id);
    const key = newStepId();
    const actions = copilotActions(f.db, f.user.id, runId, key);
    assert.throws(
      () => actions.preview({ commandId: "pm.work_item.create", input: { projectId: f.project.id, title: "Implement add" }, idempotencyKey: key }),
      (error: unknown) => {
        assert.ok(error instanceof PlatformNoEffectError);
        assert.equal(error.httpStatus, 409);
        assert.equal(error.message, "COPILOT_PROJECT_AUTONOMY_OFF: 项目「Autonomy」未开启 Copilot 自治，请在 Web 控制台项目设置中开启后重试");
        return true;
      }
    );
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM platform_action_intents").get() as { n: number }).n, 0);
  } finally { f.db.close(); }
});

it("lets copilot-origin actions through when autonomy is on and keeps the owner path unblocked", async () => {
  const f = fixture();
  try {
    const repo = new ProjectRepository(f.db, f.user.id);
    repo.setCopilotAutonomy(f.project.id, true);
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

    // The Web owner path is never blocked by the project switch.
    repo.setCopilotAutonomy(f.project.id, false);
    const owner = new PlatformActions({ db: f.db, userId: f.user.id }, createPlatformCommands());
    const item = await owner.executeOwner("pm.work_item.create", { projectId: f.project.id, title: "Owner work" }, randomUUID());
    assert.equal((item as { title: string }).title, "Owner work");
    assert.equal(new ProjectManagerRepository(f.db, f.user.id).listWorkItems(f.project.id).length, 2);
  } finally { f.db.close(); }
});

it("applies an autonomy toggle immediately: new copilot intents are rejected once the switch turns off", async () => {
  const f = fixture();
  try {
    const repo = new ProjectRepository(f.db, f.user.id);
    repo.setCopilotAutonomy(f.project.id, true);
    const { runId, newStepId } = copilotRun(f.db, f.user.id);
    const key = newStepId();
    const actions = copilotActions(f.db, f.user.id, runId, key);
    const intent = actions.preview({ commandId: "pm.work_item.create", input: { projectId: f.project.id, title: "While on" }, idempotencyKey: key });
    assert.equal(intent.status, "approved");
    const receipt = await actions.execute(intent.id);
    assert.equal(receipt.outcome, "confirmed");

    repo.setCopilotAutonomy(f.project.id, false);
    const nextKey = newStepId();
    assert.throws(
      () => copilotActions(f.db, f.user.id, runId, nextKey).preview({ commandId: "pm.work_item.create", input: { projectId: f.project.id, title: "After off" }, idempotencyKey: nextKey }),
      (error: unknown) => {
        assert.ok(error instanceof PlatformNoEffectError);
        assert.match(error.message, /^COPILOT_PROJECT_AUTONOMY_OFF: 项目「Autonomy」未开启 Copilot 自治/);
        return true;
      }
    );
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM platform_action_intents WHERE idempotency_key = ?").get(nextKey) as { n: number }).n, 0);
    assert.equal(new ProjectManagerRepository(f.db, f.user.id).listWorkItems(f.project.id).length, 1);
  } finally { f.db.close(); }
});

it("rejects projectless copilot-origin commands as COPILOT_GLOBAL_ACTION_REQUIRES_WEB while the owner path stays open", async () => {
  const f = fixture();
  try {
    new ProjectRepository(f.db, f.user.id).setCopilotAutonomy(f.project.id, true);
    const { runId, newStepId } = copilotRun(f.db, f.user.id);
    const key = newStepId();
    const actions = copilotActions(f.db, f.user.id, runId, key);
    assert.throws(
      () => actions.preview({ commandId: "memory.write", input: { kind: "fact", scope: "global", text: "Global preference" }, idempotencyKey: key }),
      (error: unknown) => {
        assert.ok(error instanceof PlatformNoEffectError);
        assert.equal(error.httpStatus, 409);
        assert.equal(error.message, "COPILOT_GLOBAL_ACTION_REQUIRES_WEB: 请在 Web 控制台手动执行");
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
