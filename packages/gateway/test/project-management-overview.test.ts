import assert from "node:assert/strict";
import { it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectManagementRepository } from "../src/db/repositories/project-management-repository.js";
import { createManagementCommands, projectManagementOverview } from "../src/services/project-manager/management.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { signJwt } from "../src/auth/jwt.js";
import { PlatformActions } from "../src/services/platform-commands/actions.js";
import { PlatformNoEffectError } from "../src/services/platform-commands/errors.js";
import { createProjectManagementRoutes } from "../src/routes/project-management.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { fileURLToPath } from "node:url";

function fixture() {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  const user = new UserRepository(db).create("management@test.dev", "hash");
  const other = new UserRepository(db).create("other-management@test.dev", "hash");
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: "Manual", path: "/tmp/management-test", aiTool: "claude" });
  const second = projects.create({ name: "Second", path: "/tmp/management-second", aiTool: "codex" });
  const foreign = new ProjectRepository(db, other.id).create({ name: "Foreign", path: "/tmp/foreign", aiTool: "" });
  return { db, user, project, second, foreign, context: { db, userId: user.id } };
}

it("defaults existing projects to manual, excludes foreign projects and reports unknown evidence", () => {
  const f = fixture();
  try {
    const all = projectManagementOverview(f.context);
    assert.equal(all.projects.length, 2);
    assert.equal(all.projects[0]!.management.mode, "manual");
    assert.equal(all.projects[0]!.evidenceFreshness.status, "unknown");
    assert.equal(all.projects[0]!.autonomy, "manual_only");
    assert.deepEqual(projectManagementOverview(f.context, []).projects, []);
    assert.deepEqual(projectManagementOverview(f.context, [f.project.id, f.foreign.id]).projects.map(p => p.id), [f.project.id]);
  } finally { f.db.close(); }
});

it("counts every work item without list truncation and distinguishes missing, stale and recent declared evidence", () => {
  const f = fixture();
  try {
    const pm = new ProjectManagerRepository(f.db, f.user.id);
    const now = Date.now();
    for (let i = 0; i < 205; i++) pm.createWorkItem(f.project.id, { title: `Task ${i}` });
    pm.createWorkItem(f.project.id, { title: "Recent", evidenceRefs: [{ ref: "test:recent", createdAt: new Date(now - 1000).toISOString() }] });
    pm.createWorkItem(f.project.id, { title: "Old", evidenceRefs: [{ ref: "test:old", createdAt: new Date(now - 100 * 3600000).toISOString() }] });
    pm.createWorkItem(f.project.id, { title: "Future", evidenceRefs: [{ ref: "test:future", createdAt: new Date(now + 3600000).toISOString() }] });
    const row = projectManagementOverview(f.context, [f.project.id], now).projects[0]!;
    assert.equal(row.counts.total, 208);
    assert.equal(row.evidenceFreshness.fresh, 1);
    assert.equal(row.evidenceFreshness.stale, 1);
    assert.equal(row.evidenceFreshness.unknown, 206);
    assert.equal(row.evidenceFreshness.status, "stale");
    assert.equal(row.counts.done, 0);
  } finally { f.db.close(); }
});

it("management command validates schema and resource ownership, uses CAS revision, and CLI mode grants no autonomy", () => {
  const f = fixture();
  try {
    const command = createManagementCommands()[0]!;
    const input = command.inputSchema.parse({ projectId: f.project.id, expectedRevision: 0, mode: "cli", ownerLabel: "Alice", nextAction: "Review evidence" });
    assert.deepEqual(command.resolve(f.context, input).projectIds, [f.project.id]);
    const result = command.execute(f.context, input) as { revision: number };
    assert.equal(result.revision, 1);
    assert.throws(() => command.execute(f.context, input), /revision/i);
    assert.throws(() => command.inputSchema.parse({ projectId: f.project.id, expectedRevision: 1, unsupported: true }));
    assert.throws(() => command.resolve(f.context, { ...input as object, projectId: f.foreign.id }), /not found/i);
    const repo = new ProjectManagementRepository(f.db, f.user.id);
    assert.equal(repo.get(f.project.id).ownerLabel, "Alice");
    const overview = projectManagementOverview(f.context, [f.project.id]).projects[0]!;
    assert.equal(overview.management.mode, "cli");
    assert.equal(overview.autonomy, "manual_only");
  } finally { f.db.close(); }
});

it("HTTP management uses command receipts, rejects stale revisions, and scopes the overview to the owner's projects", async () => {
  const f = fixture();
  const app = express();
  const jwtSecret = randomUUID();
  app.locals.db = f.db; app.locals.jwtSecret = jwtSecret;
  app.use(express.json());
  const commands = new Map(createManagementCommands().map(command => [command.id, command]));
  app.use("/api/v1", createProjectManagementRoutes(f.db, (userId, commandId, input) =>
    new PlatformActions({ db: f.db, userId }, commands).executeOwner(commandId, input, randomUUID())));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const headers = { Authorization: `Bearer ${signJwt({ userId: f.user.id, email: f.user.email }, jwtSecret)}`, "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(base + "/project-manager/overview")).status, 401);
    // Grant scoping is gone: the overview is always the owner's own projects,
    // and a legacy grantId query param is ignored.
    const overview = await fetch(base + "/project-manager/overview?grantId=stale-param", { headers });
    assert.equal(overview.status, 200);
    const data = await overview.json() as { data: { projects: { id: string }[] } };
    assert.deepEqual(data.data.projects.map(project => project.id).sort(), [f.project.id, f.second.id].sort());
    const patch = (id: string, body: unknown) => fetch(base + `/projects/${id}/project-manager/management`, { method: "PATCH", headers, body: JSON.stringify(body) });
    assert.equal((await patch(f.project.id, { expectedRevision: 0, nextAction: "Review" })).status, 200);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM platform_action_receipts WHERE user_id=?").get(f.user.id) as { n: number }).n, 1);
    assert.equal((await patch(f.project.id, { expectedRevision: 0, nextAction: "Stale" })).status, 409);
    assert.equal((await patch(f.foreign.id, { expectedRevision: 0, nextAction: "Forbidden" })).status, 404);
    // grantId is no longer a request field: the strict schema rejects it.
    assert.equal((await patch(f.project.id, { expectedRevision: 1, grantId: "legacy-field", mode: "cli" })).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.db.close();
  }
});

it("gates copilot-origin management actions on the per-project autonomy switch while the owner path is unaffected", async () => {
  const f = fixture();
  try {
    const commands = new Map(createManagementCommands().map(command => [command.id, command]));
    const log = new CopilotConversationLog(f.db, f.user.id);
    const conversation = log.createConversation();
    const ledger = new CopilotRunLedger(f.db, f.user.id);
    const runId = ledger.admit({ userId: f.user.id, conversationId: conversation.id, userText: "Update the plan" }, 10);
    const step = ledger.addStep(runId, { kind: "tool", toolName: "pm_update_management", effect: "write" });
    const copilot = new PlatformActions({ db: f.db, userId: f.user.id, actionOrigin: { kind: "copilot", runId, stepId: step.id } }, commands);
    const projects = new ProjectRepository(f.db, f.user.id);
    const copilotIntentCount = () => (f.db.prepare("SELECT count(*) AS n FROM platform_action_intents WHERE user_id=? AND origin_kind='copilot'").get(f.user.id) as { n: number }).n;

    // The switch defaults to OFF: the copilot preview is rejected with the switch code,
    // the project name and Web guidance, and nothing is persisted.
    assert.equal(projects.getCopilotAutonomy(f.project.id), false);
    assert.throws(
      () => copilot.preview({ commandId: "pm.management.update", input: { projectId: f.project.id, expectedRevision: 0, nextAction: "From Copilot" }, idempotencyKey: step.id }),
      (error: unknown) => error instanceof PlatformNoEffectError
        && error.message.startsWith("COPILOT_PROJECT_AUTONOMY_OFF:")
        && error.message.includes(f.project.name)
        && error.message.includes("未开启 Copilot 自治")
        && error.message.includes("Web 控制台项目设置中开启后重试"),
    );
    assert.equal(copilotIntentCount(), 0);

    // The owner path is never gated by the switch.
    const owner = await new PlatformActions(f.context, commands).executeOwner("pm.management.update", { projectId: f.project.id, expectedRevision: 0, nextAction: "Owner first" }, "owner-1") as { nextAction: string };
    assert.equal(owner.nextAction, "Owner first");

    // Switch ON: the preview is approved, bound to the run step, and execution confirms a receipt.
    projects.setCopilotAutonomy(f.project.id, true);
    const intent = copilot.preview({ commandId: "pm.management.update", input: { projectId: f.project.id, expectedRevision: 1, nextAction: "From Copilot" }, idempotencyKey: step.id });
    assert.equal(intent.status, "approved");
    assert.equal(intent.origin_kind, "copilot");
    assert.equal(intent.origin_run_id, runId);
    assert.equal(intent.origin_step_id, step.id);
    const receipt = await copilot.execute(intent.id);
    assert.equal(receipt.outcome, "confirmed");

    // The switch is hot: flipping it back OFF rejects a new copilot intent
    // immediately, while the confirmed receipt survives.
    projects.setCopilotAutonomy(f.project.id, false);
    const nextStep = ledger.addStep(runId, { kind: "tool", toolName: "pm_update_management", effect: "write" });
    assert.throws(
      () => copilot.preview({ commandId: "pm.management.update", input: { projectId: f.project.id, expectedRevision: 2, nextAction: "Again" }, idempotencyKey: nextStep.id }),
      (error: unknown) => error instanceof PlatformNoEffectError && error.message.startsWith("COPILOT_PROJECT_AUTONOMY_OFF:"),
    );
    assert.equal(copilotIntentCount(), 1);
    assert.equal(copilot.intents.receipt(intent.id)?.outcome, "confirmed");
  } finally { f.db.close(); }
});
