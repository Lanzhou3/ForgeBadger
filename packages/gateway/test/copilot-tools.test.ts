import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { z } from "zod";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ApiKeyRepository } from "../src/db/repositories/api-key-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { ActivityRepository } from "../src/db/repositories/activity-repository.js";
import { CopilotMemoryRepository } from "../src/db/repositories/copilot-memory-repository.js";
import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
import { ModelRepository } from "../src/db/repositories/model-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { AgentRepository } from "../src/db/repositories/agent-repository.js";
import { NotificationRepository } from "../src/db/repositories/notification-repository.js";
import { PluginRepository } from "../src/db/repositories/plugin-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { SkillRepository } from "../src/db/repositories/skill-repository.js";
import { TemplateRepository } from "../src/db/repositories/template-repository.js";
import { UsageRepository } from "../src/db/repositories/usage-repository.js";
import { createCopilotToolRegistry, executeCopilotTool, toModelToolDefinitions } from "../src/services/copilot/tool-registry.js";
import { createCopilotReadTools } from "../src/services/copilot/read-tools.js";

const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("copilot tools", () => {
  let db: Database.Database;
  let userId: string;
  let otherUserId: string;
  let registry: ReturnType<typeof createCopilotToolRegistry>;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    userId = users.create("copilot-tools@example.com", "hash").id;
    otherUserId = users.create("other-copilot-tools@example.com", "hash").id;
    registry = createCopilotToolRegistry(createCopilotReadTools());
  });

  it("rejects unknown tools", async () => {
    const result = await executeCopilotTool(registry, "openforge.unknown", {}, context(userId));

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_tool_not_allowed");
  });

  it("rejects invalid tool input", async () => {
    const result = await executeCopilotTool(
      registry,
      "openforge.get_recent_activity",
      { limit: 10_000 },
      context(userId)
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_tool_validation_failed");
  });

  it("fails closed when a tool implementation throws unexpectedly", async () => {
    const unsafeRegistry = createCopilotToolRegistry([{
      name: "openforge.throwing_test_tool",
      description: "Throw from a test tool.",
      risk: "read",
      requiresApproval: false,
      inputSchema: z.object({}),
      async execute() {
        throw new Error("tool exploded token=secret-value");
      }
    }]);

    const result = await executeCopilotTool(unsafeRegistry, "openforge.throwing_test_tool", {}, context(userId));

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_tool_execution_failed");
    assert.equal(result.error.message, "Copilot tool execution failed");
    assert.doesNotMatch(JSON.stringify(result), /secret-value/);
  });

  it("executes read tools without approval", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });

    const result = await executeCopilotTool(registry, "openforge.list_projects", {}, context(userId));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requiresApproval, false);
    assert.equal((result.output as { projects: Array<{ id: string }> }).projects[0]?.id, project.id);
  });

  it("reads project-manager state through tenant-scoped read tools without approval", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge PM",
      path: "/tmp/openforge-pm-tools",
      aiTool: "claude"
    });
    const repo = new ProjectManagerRepository(db, userId);
    const goal = repo.upsertGoal(project.id, {
      summary: "Close the project-manager ledger",
      acceptanceCriteria: ["tools are read-only"]
    });
    const item = repo.createWorkItem(project.id, {
      title: "Implement Copilot tools",
      evidenceRefs: [{ kind: "test", label: "unit", status: "passed", ref: "test/copilot-tools.test.ts" }]
    });

    const tools = [
      "openforge.get_project_goal",
      "openforge.list_project_work_items",
      "openforge.get_project_work_item",
      "openforge.get_project_development_ledger"
    ];
    for (const name of tools) {
      const definition = registry.tools.get(name);
      assert.equal(definition?.risk, "read");
      assert.equal(definition?.requiresApproval, false);
    }

    const goalResult = await executeCopilotTool(registry, "openforge.get_project_goal", { projectId: project.id }, context(userId));
    const listResult = await executeCopilotTool(registry, "openforge.list_project_work_items", { projectId: project.id }, context(userId));
    const itemResult = await executeCopilotTool(registry, "openforge.get_project_work_item", {
      projectId: project.id,
      workItemId: item.id
    }, context(userId));
    const ledgerResult = await executeCopilotTool(registry, "openforge.get_project_development_ledger", {
      projectId: project.id,
      limit: 10
    }, context(userId));

    assert.equal(goalResult.ok, true);
    assert.equal(listResult.ok, true);
    assert.equal(itemResult.ok, true);
    assert.equal(ledgerResult.ok, true);
    if (!goalResult.ok || !listResult.ok || !itemResult.ok || !ledgerResult.ok) return;
    assert.equal(goalResult.requiresApproval, false);
    assert.equal((goalResult.output as { goal: { id: string } }).goal.id, goal.id);
    assert.equal((listResult.output as { workItems: Array<{ id: string }> }).workItems[0]?.id, item.id);
    assert.equal((itemResult.output as { workItem: { evidenceRefCount: number } }).workItem.evidenceRefCount, 1);
    assert.equal((ledgerResult.output as { events: Array<{ eventType: string }> }).events.length, 2);
  });

  it("returns empty project-manager tool output for cross-tenant or invalid ids", async () => {
    const foreignProject = new ProjectRepository(db, otherUserId).create({
      name: "Foreign PM",
      path: "/tmp/foreign-pm-tools",
      aiTool: "claude"
    });
    const foreignItem = new ProjectManagerRepository(db, otherUserId).createWorkItem(foreignProject.id, {
      title: "Foreign task"
    });

    const goal = await executeCopilotTool(registry, "openforge.get_project_goal", { projectId: foreignProject.id }, context(userId));
    const list = await executeCopilotTool(registry, "openforge.list_project_work_items", { projectId: foreignProject.id }, context(userId));
    const item = await executeCopilotTool(registry, "openforge.get_project_work_item", {
      projectId: foreignProject.id,
      workItemId: foreignItem.id
    }, context(userId));
    const ledger = await executeCopilotTool(registry, "openforge.get_project_development_ledger", {
      projectId: "missing-project",
      limit: 5
    }, context(userId));
    const invalid = await executeCopilotTool(registry, "openforge.get_project_development_ledger", {
      projectId: foreignProject.id,
      limit: 500
    }, context(userId));

    assert.equal(goal.ok, true);
    assert.equal(list.ok, true);
    assert.equal(item.ok, true);
    assert.equal(ledger.ok, true);
    assert.equal(invalid.ok, false);
    if (!goal.ok || !list.ok || !item.ok || !ledger.ok) return;
    assert.equal((goal.output as { goal: unknown }).goal, null);
    assert.deepEqual((list.output as { workItems: unknown[] }).workItems, []);
    assert.equal((item.output as { workItem: unknown }).workItem, null);
    assert.deepEqual((ledger.output as { events: unknown[] }).events, []);
  });

  it("filters project-manager ledger tool output by event type before limiting", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "Filtered PM",
      path: "/tmp/filtered-pm-tools",
      aiTool: "claude"
    });
    const repo = new ProjectManagerRepository(db, userId);
    const item = repo.createWorkItem(project.id, { title: "Filter ledger" });
    repo.updateWorkItemStatus(project.id, item.id, { status: "in_progress" });
    repo.attachEvidence(project.id, item.id, {
      evidenceRefs: [{ kind: "test", label: "copilot", status: "passed", ref: "test/copilot-tools.test.ts" }]
    });

    const result = await executeCopilotTool(registry, "openforge.get_project_development_ledger", {
      projectId: project.id,
      eventType: "evidence_attached",
      limit: 1
    }, context(userId));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const events = (result.output as { events: Array<{ eventType: string }> }).events;
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "evidence_attached");
  });

  it("redacts raw multiline evidence references from project-manager read tools", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "Raw Evidence PM",
      path: "/tmp/raw-evidence-pm-tools",
      aiTool: "claude"
    });
    const rawRef = [
      "$ codex exec unsafe-command",
      `${["std", "out"].join("")}: transcript`,
      `${["std", "err"].join("")}: failure`
    ].join("\n");
    const item = new ProjectManagerRepository(db, userId).createWorkItem(project.id, {
      title: "Protect evidence refs",
      evidenceRefs: [{ kind: "test", label: "raw evidence", status: "passed", ref: rawRef }]
    });

    const result = await executeCopilotTool(registry, "openforge.get_project_work_item", {
      projectId: project.id,
      workItemId: item.id
    }, context(userId));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.output);
    assert.doesNotMatch(serialized, /unsafe-command|transcript|failure/u);
    assert.match(serialized, /\[REDACTED\]/u);
  });

  it("exposes exactly three Project Manager prepare tools", () => {
    const pmPrepareTools = [...registry.tools.values()]
      .filter((tool) => tool.name.startsWith("openforge.propose_project_manager_"));

    assert.deepEqual(pmPrepareTools.map((tool) => tool.name), [
      "openforge.propose_project_manager_create_work_item",
      "openforge.propose_project_manager_update_work_item_status",
      "openforge.propose_project_manager_attach_evidence"
    ]);
    for (const tool of pmPrepareTools) {
      assert.equal(tool.risk, "prepare");
      assert.equal(tool.requiresApproval, true);
    }
  });

  it("creates Project Manager proposals as pending actions without mutating PM state", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "PM Proposals",
      path: "/tmp/pm-proposals",
      aiTool: "claude"
    });
    const pm = new ProjectManagerRepository(db, userId);
    const workItem = pm.createWorkItem(project.id, {
      title: "Existing task",
      status: "in_progress",
      evidenceRefs: [{ kind: "test", label: "existing", status: "accepted", ref: "test/existing" }]
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare PM writes"
    });

    const createResult = await executeCopilotTool(
      registry,
      "openforge.propose_project_manager_create_work_item",
      {
        projectId: project.id,
        title: "Create through approval",
        description: "Only a proposal",
        priority: 7,
        acceptanceCriteria: ["Approved action creates it"],
        evidenceRefs: [{ kind: "copilot", label: "safe summary", status: "verified", ref: "run-summary" }]
      },
      context(userId, run.id)
    );
    const statusResult = await executeCopilotTool(
      registry,
      "openforge.propose_project_manager_update_work_item_status",
      { projectId: project.id, workItemId: workItem.id, status: "done" },
      context(userId, run.id)
    );
    const evidenceResult = await executeCopilotTool(
      registry,
      "openforge.propose_project_manager_attach_evidence",
      {
        projectId: project.id,
        workItemId: workItem.id,
        evidenceRef: { kind: "test", label: "focused route test", status: "verified", ref: "test/copilot-routes.test.ts" }
      },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.deepEqual([createResult.ok, statusResult.ok, evidenceResult.ok], [true, true, true]);
    assert.equal(createResult.ok && createResult.requiresApproval, true);
    assert.equal(statusResult.ok && statusResult.requiresApproval, true);
    assert.equal(evidenceResult.ok && evidenceResult.requiresApproval, true);
    assert.deepEqual(actions.map((action) => action.type), [
      "openforge.propose_project_manager_create_work_item",
      "openforge.propose_project_manager_update_work_item_status",
      "openforge.propose_project_manager_attach_evidence"
    ]);
    assert.deepEqual(actions.map((action) => action.input.actionType), [
      "create_work_item",
      "update_work_item_status",
      "attach_evidence"
    ]);
    assert.equal(actions[0]?.input.projectId, project.id);
    assert.equal(actions[0]?.input.copilotRunId, run.id);
    assert.equal(actions[0]?.input.pendingActionId, undefined);
    assert.equal(actions[1]?.input.workItemId, workItem.id);
    assert.equal(actions[1]?.input.copilotRunId, run.id);
    assert.equal(actions[1]?.input.pendingActionId, undefined);
    assert.equal(actions[2]?.input.workItemId, workItem.id);
    assert.equal(actions[2]?.input.copilotRunId, run.id);
    assert.equal(actions[2]?.input.pendingActionId, undefined);
    assert.equal(pm.listWorkItems(project.id).length, 1);
    assert.equal(pm.getWorkItem(project.id, workItem.id)?.status, "in_progress");
    assert.equal(pm.getWorkItem(project.id, workItem.id)?.evidenceRefs.length, 1);
  });

  it("rejects Project Manager proposals for unavailable projects or work items", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "Visible PM",
      path: "/tmp/visible-pm",
      aiTool: "claude"
    });
    const foreignProject = new ProjectRepository(db, otherUserId).create({
      name: "Foreign PM",
      path: "/tmp/foreign-pm",
      aiTool: "claude"
    });
    const foreignItem = new ProjectManagerRepository(db, otherUserId).createWorkItem(foreignProject.id, {
      title: "Foreign task"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Reject invalid PM proposals"
    });

    const foreignCreate = await executeCopilotTool(
      registry,
      "openforge.propose_project_manager_create_work_item",
      { projectId: foreignProject.id, title: "Should fail" },
      context(userId, run.id)
    );
    const foreignStatus = await executeCopilotTool(
      registry,
      "openforge.propose_project_manager_update_work_item_status",
      { projectId: foreignProject.id, workItemId: foreignItem.id, status: "done" },
      context(userId, run.id)
    );
    const missingItem = await executeCopilotTool(
      registry,
      "openforge.propose_project_manager_attach_evidence",
      {
        projectId: project.id,
        workItemId: "missing-item",
        evidenceRef: { kind: "test", label: "missing", status: "verified", ref: "missing" }
      },
      context(userId, run.id)
    );
    const modelSuppliedPendingAction = await executeCopilotTool(
      registry,
      "openforge.propose_project_manager_update_work_item_status",
      { projectId: project.id, workItemId: "missing-item", status: "done", pendingActionId: "model-supplied" },
      context(userId, run.id)
    );

    assert.deepEqual([
      foreignCreate.ok,
      foreignStatus.ok,
      missingItem.ok,
      modelSuppliedPendingAction.ok
    ], [false, false, false, false]);
    assert.deepEqual(
      new CopilotRepository(db, userId).listPendingActions(run.id),
      []
    );
  });

  it("redacts project-manager tool output and diagnostics summaries", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "Redacted PM",
      path: "/tmp/redacted-pm-tools",
      aiTool: "claude"
    });
    const otherProject = new ProjectRepository(db, otherUserId).create({
      name: "Other Redacted PM",
      path: "/tmp/other-redacted-pm-tools",
      aiTool: "claude"
    });
    const repo = new ProjectManagerRepository(db, userId);
    const toolSecret = ["sk", "pm-tool-secret"].join("-");
    const toolRef = ["Authorization:", "Bearer pm.tool.jwt"].join(" ");
    const stdErrKey = ["std", "err"].join("");
    const toolStdErrSecret = ["sk", ["pm-tool-std", "err"].join("")].join("-");
    const toolSignature = ["X-Lark", "Signature: pm-tool-signature"].join("-");
    const item = repo.createWorkItem(project.id, {
      title: "Protect output",
      details: {
        rawTerminalOutput: "OPENFORGE_ATTACH_TOKEN=pm-tool-attach-secret",
        providerCredential: toolSecret
      }
    });
    repo.attachEvidence(project.id, item.id, {
      evidenceRefs: [{ kind: "test", label: "redaction", status: "passed", ref: toolRef }],
      details: { [stdErrKey]: toolStdErrSecret, signature: toolSignature }
    });
    new ProjectManagerRepository(db, otherUserId).createWorkItem(otherProject.id, { title: "Foreign hidden" });

    const itemResult = await executeCopilotTool(registry, "openforge.get_project_work_item", {
      projectId: project.id,
      workItemId: item.id
    }, context(userId));
    const ledgerResult = await executeCopilotTool(registry, "openforge.get_project_development_ledger", {
      projectId: project.id
    }, context(userId));
    const diagnostics = await executeCopilotTool(registry, "openforge.get_diagnostics_summary", {}, context(userId));

    assert.equal(itemResult.ok, true);
    assert.equal(ledgerResult.ok, true);
    assert.equal(diagnostics.ok, true);
    if (!itemResult.ok || !ledgerResult.ok || !diagnostics.ok) return;
    const serialized = JSON.stringify({
      item: itemResult.output,
      ledger: ledgerResult.output,
      diagnostics: diagnostics.output
    });
    assert.equal(serialized.includes("details"), false);
    assert.equal(serialized.includes("Foreign hidden"), false);
    assert.equal((diagnostics.output as { diagnostics: { projectManager: { ledgerEventCount: number } } }).diagnostics.projectManager.ledgerEventCount, 2);
    assert.doesNotMatch(serialized, new RegExp(["pm-tool-attach-secret", ["sk", "pm-tool-secret"].join("-"), "pm\\.tool\\.jwt"].join("|"), "u"));
    assert.doesNotMatch(serialized, new RegExp([["sk", "pm-tool-std", "err"].join("-"), "pm-tool-signature"].join("|"), "u"));
  });

  it("reads agents, skills, and templates as Copilot platform inventory", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const agent = new AgentRepository(db, userId).create({
      projectId: project.id,
      name: "Reviewer",
      description: "Reviews code",
      tools: "read,search"
    });
    const skill = new SkillRepository(db, userId).create({
      name: "debugging",
      description: "Debug issues",
      content: "Use systematic debugging.",
      isEnabled: false
    });
    const template = new TemplateRepository(db, userId).create({
      name: "Claude Starter",
      description: "Project config template",
      files: [{
        filePath: ".claude/settings.json",
        content: "{}",
        fileType: "json"
      }]
    });

    const agentsResult = await executeCopilotTool(registry, "openforge.list_agents", {}, context(userId));
    const skillsResult = await executeCopilotTool(registry, "openforge.list_skills", {}, context(userId));
    const templatesResult = await executeCopilotTool(registry, "openforge.list_templates", {}, context(userId));
    const skillDetailResult = await executeCopilotTool(
      registry,
      "openforge.get_skill_detail",
      { skillId: skill.id },
      context(userId)
    );

    assert.equal(agentsResult.ok, true);
    assert.equal(skillsResult.ok, true);
    assert.equal(templatesResult.ok, true);
    assert.equal(skillDetailResult.ok, true);
    if (!agentsResult.ok || !skillsResult.ok || !templatesResult.ok || !skillDetailResult.ok) return;
    assert.deepEqual((agentsResult.output as { agents: Array<{ id: string; projectName: string | null }> }).agents, [{
      id: agent.id,
      name: "Reviewer",
      description: "Reviews code",
      projectId: project.id,
      projectName: "OpenForge",
      modelId: null,
      tools: "read,search",
      allowedDirs: null,
      status: "active"
    }]);
    assert.deepEqual((skillsResult.output as { skills: Array<{ id: string; name: string; isEnabled: boolean }> }).skills, [{
      id: skill.id,
      name: "debugging",
      description: "Debug issues",
      source: "local",
      version: "1.0.0",
      visibility: "private",
      isEnabled: false
    }]);
    assert.equal((skillDetailResult.output as { skill: { contentPreview: string } }).skill.contentPreview, "Use systematic debugging.");
    assert.equal(
      (templatesResult.output as { templates: Array<{ id: string; name: string; fileCount: number }> }).templates
        .find((item) => item.id === template.id)?.fileCount,
      1
    );
  });

  it("reads plugins, notifications, and usage as Copilot platform state", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, userId).create({
      projectId: project.id,
      name: "Main session",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      attachToken: "attach-token"
    });
    new PluginRepository(db, userId).setEnabled("claude-safe-edits", true);
    new NotificationRepository(db, userId).create({
      type: "session",
      titleKey: "notifications.session.completed",
      message: "Session completed token=secret-value",
      href: `/sessions/${session.id}`,
      sessionId: session.id,
      payload: { token: "secret-value" }
    });
    const model = new ModelRepository(db, userId).create({
      name: "Claude Sonnet",
      provider: "Anthropic",
      modelId: "claude-sonnet"
    });
    new UsageRepository(db, userId).setModelRate(model.id, 3);
    new SessionRepository(db, userId).update(session.id, { modelId: model.id });

    const pluginsResult = await executeCopilotTool(registry, "openforge.list_plugins", {}, context(userId));
    const notificationsResult = await executeCopilotTool(
      registry,
      "openforge.get_notifications_summary",
      {},
      context(userId)
    );
    const usageResult = await executeCopilotTool(registry, "openforge.get_usage_summary", {}, context(userId));

    assert.equal(pluginsResult.ok, true);
    assert.equal(notificationsResult.ok, true);
    assert.equal(usageResult.ok, true);
    if (!pluginsResult.ok || !notificationsResult.ok || !usageResult.ok) return;
    assert.equal(
      (pluginsResult.output as { plugins: Array<{ id: string; status: string }> }).plugins
        .find((plugin) => plugin.id === "claude-safe-edits")?.status,
      "enabled"
    );
    assert.equal((notificationsResult.output as { unreadCount: number }).unreadCount, 1);
    assert.equal(
      (notificationsResult.output as { notifications: Array<{ message: string; payload: unknown }> })
        .notifications[0]?.message,
      "Session completed token=[REDACTED]"
    );
    assert.doesNotMatch(JSON.stringify(notificationsResult.output), /secret-value/);
    assert.equal((usageResult.output as { summary: { totalSessions: number } }).summary.totalSessions, 1);
    assert.deepEqual(
      (usageResult.output as { rates: Array<{ modelId: string; hourlyRateUsd: number }> }).rates,
      [{ modelId: model.id, hourlyRateUsd: 3 }]
    );
  });

  it("reads model provider catalog products for Copilot configuration guidance", async () => {
    const result = await executeCopilotTool(
      registry,
      "openforge.get_model_provider_catalog",
      { limit: 20 },
      context(userId)
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const catalog = (result.output as { providers: Array<Record<string, unknown>> }).providers;
    const minimaxGlobal = catalog.find((provider) => provider.id === "minimax-global");
    const minimaxCn = catalog.find((provider) => provider.id === "minimax-cn");

    assert.equal(minimaxGlobal?.region, "global");
    assert.equal(minimaxCn?.region, "cn");
    assert.equal(minimaxCn?.productType, "payg_api");
    assert.deepEqual(minimaxCn?.supportedAdapters, ["claude", "opencode"]);
    assert.deepEqual(minimaxCn?.protocols, ["anthropic", "openai"]);
    assert.equal((minimaxCn?.defaultModels as unknown[]).length > 0, true);
    assert.equal(JSON.stringify(result.output).includes("sk-"), false);
  });

  it("separates project record status from running session state", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });

    const result = await executeCopilotTool(registry, "openforge.list_projects", {}, context(userId));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const [summary] = (result.output as {
      projects: Array<{
        id: string;
        projectStatus?: string;
        sessionStatus?: string;
        status?: string;
        totalSessionCount?: number;
        runningSessionCount?: number;
        staleRunningSessionCount?: number;
        hasRunningSession?: boolean;
      }>;
    }).projects;
    assert.equal(summary?.id, project.id);
    assert.equal(summary?.projectStatus, "active");
    assert.equal(summary?.sessionStatus, "no_running_sessions");
    assert.equal(summary?.status, undefined);
    assert.equal(summary?.totalSessionCount, 0);
    assert.equal(summary?.runningSessionCount, 0);
    assert.equal(summary?.staleRunningSessionCount, 0);
    assert.equal(summary?.hasRunningSession, false);
  });

  it("does not count stale database-running sessions as live when Gateway has no runtime session", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "aether-glass",
      path: "/tmp/aether-glass",
      aiTool: "claude"
    });
    const sessions = new SessionRepository(db, userId);
    const createdSession = sessions.create({
      projectId: project.id,
      name: "Old Claude session",
      aiTool: "claude",
      workingDir: "/tmp/aether-glass",
      tmuxSession: "of-old-session"
    });
    const session = sessions.updateStatus(createdSession.id, "running") ?? createdSession;

    const projectResult = await executeCopilotTool(
      registry,
      "openforge.list_projects",
      {},
      runtimeContext(userId, [])
    );
    const sessionResult = await executeCopilotTool(
      registry,
      "openforge.list_sessions",
      {},
      runtimeContext(userId, [])
    );

    assert.equal(projectResult.ok, true);
    assert.equal(sessionResult.ok, true);
    if (!projectResult.ok || !sessionResult.ok) return;
    const [summary] = (projectResult.output as {
      projects: Array<{
        id: string;
        sessionStatus: string;
        runningSessionCount: number;
        staleRunningSessionCount: number;
        hasRunningSession: boolean;
      }>;
    }).projects;
    const [sessionSummary] = (sessionResult.output as {
      sessions: Array<{
        id: string;
        projectName: string;
        runtimeStatus: string;
        isLive: boolean;
        isStaleRunningRecord: boolean;
      }>;
    }).sessions;
    assert.equal(summary?.id, project.id);
    assert.equal(summary?.sessionStatus, "no_live_sessions_stale_records");
    assert.equal(summary?.runningSessionCount, 0);
    assert.equal(summary?.staleRunningSessionCount, 1);
    assert.equal(summary?.hasRunningSession, false);
    assert.equal(sessionSummary?.id, session.id);
    assert.equal(sessionSummary?.projectName, "aether-glass");
    assert.equal(sessionSummary?.runtimeStatus, "stale");
    assert.equal(sessionSummary?.isLive, false);
    assert.equal(sessionSummary?.isStaleRunningRecord, true);
  });

  it("counts running sessions as live when Gateway has the matching runtime session", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessions = new SessionRepository(db, userId);
    const createdSession = sessions.create({
      projectId: project.id,
      name: "Main session",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-main"
    });
    const session = sessions.updateStatus(createdSession.id, "running") ?? createdSession;

    const result = await executeCopilotTool(
      registry,
      "openforge.list_projects",
      {},
      runtimeContext(userId, [{ id: session.id, status: "running", tmuxName: "of-main" }])
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const [summary] = (result.output as {
      projects: Array<{
        sessionStatus: string;
        runningSessionCount: number;
        staleRunningSessionCount: number;
        hasRunningSession: boolean;
      }>;
    }).projects;
    assert.equal(summary?.sessionStatus, "has_running_sessions");
    assert.equal(summary?.runningSessionCount, 1);
    assert.equal(summary?.staleRunningSessionCount, 0);
    assert.equal(summary?.hasRunningSession, true);
  });

  it("gets tenant-scoped project detail", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude",
      description: "Control plane",
      techStack: "Next.js, Express"
    });
    const foreign = new ProjectRepository(db, otherUserId).create({
      name: "Foreign",
      path: "/tmp/foreign",
      aiTool: "codex"
    });

    const owned = await executeCopilotTool(
      registry,
      "openforge.get_project_detail",
      { projectId: project.id },
      context(userId)
    );
    const crossTenant = await executeCopilotTool(
      registry,
      "openforge.get_project_detail",
      { projectId: foreign.id },
      context(userId)
    );

    assert.equal(owned.ok, true);
    assert.equal(crossTenant.ok, true);
    if (!owned.ok || !crossTenant.ok) return;
    assert.equal((owned.output as { project: { id: string; description: string } }).project.id, project.id);
    assert.equal((owned.output as { project: { id: string; description: string } }).project.description, "Control plane");
    assert.equal((crossTenant.output as { project: unknown }).project, null);
  });

  it("gets tenant-scoped session detail without attach tokens", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const apiKey = new ApiKeyRepository(db, userId, masterKey).create({
      provider: "anthropic",
      plaintextKey: "secret-api-key-value"
    });
    const session = new SessionRepository(db, userId).create({
      projectId: project.id,
      name: "Main session",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      attachToken: "secret-attach-token",
      tmuxSession: "of-session",
      credentialMode: "stored_encrypted_key",
      apiKeyId: apiKey.id
    });
    const foreignProject = new ProjectRepository(db, otherUserId).create({
      name: "Foreign",
      path: "/tmp/foreign",
      aiTool: "codex"
    });
    const foreignApiKey = new ApiKeyRepository(db, otherUserId, masterKey).create({
      provider: "openai",
      plaintextKey: "foreign-api-key-value"
    });
    const foreignSession = new SessionRepository(db, otherUserId).create({
      projectId: foreignProject.id,
      name: "Foreign session",
      aiTool: "codex",
      workingDir: "/tmp/foreign",
      attachToken: "foreign-attach-token",
      apiKeyId: foreignApiKey.id
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.get_session_detail",
      { sessionId: session.id },
      context(userId)
    );
    const crossTenant = await executeCopilotTool(
      registry,
      "openforge.get_session_detail",
      { sessionId: foreignSession.id },
      context(userId)
    );

    assert.equal(result.ok, true);
    assert.equal(crossTenant.ok, true);
    if (!result.ok || !crossTenant.ok) return;
    const output = result.output as { session: { id: string; attachToken?: string; apiKeyId?: string; tmuxSession?: string } };
    assert.equal(output.session.id, session.id);
    assert.equal(output.session.tmuxSession, "of-session");
    assert.equal("attachToken" in output.session, false);
    assert.equal("apiKeyId" in output.session, false);
    assert.equal((crossTenant.output as { session: unknown }).session, null);
    assert.doesNotMatch(JSON.stringify(output), new RegExp(`secret-attach-token|${apiKey.id}`));
  });

  it("gets bounded terminal snapshots for owned running sessions without leaking secrets", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessions = new SessionRepository(db, userId);
    const createdSession = sessions.create({
      projectId: project.id,
      name: "Main session",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-main"
    });
    const session = sessions.updateStatus(createdSession.id, "running") ?? createdSession;
    const foreignProject = new ProjectRepository(db, otherUserId).create({
      name: "Foreign",
      path: "/tmp/foreign",
      aiTool: "codex"
    });
    const foreignSessions = new SessionRepository(db, otherUserId);
    const createdForeignSession = foreignSessions.create({
      projectId: foreignProject.id,
      name: "Foreign session",
      aiTool: "codex",
      workingDir: "/tmp/foreign",
      tmuxSession: "of-foreign"
    });
    const foreignSession = foreignSessions.updateStatus(createdForeignSession.id, "running") ?? createdForeignSession;
    const terminalHistory = [
      "Claude Code ready",
      "Using token=secret-terminal-value",
      "Last line answers the user's question"
    ].join("\n");

    const result = await executeCopilotTool(
      registry,
      "openforge.get_session_terminal_snapshot",
      { sessionId: session.id, maxBytes: 128 },
      {
        ...context(userId),
        sessionManager: {
          async captureHistory(sessionId: string) {
            assert.equal(sessionId, session.id);
            return terminalHistory;
          }
        }
      }
    );
    const crossTenant = await executeCopilotTool(
      registry,
      "openforge.get_session_terminal_snapshot",
      { sessionId: foreignSession.id },
      context(userId)
    );

    assert.equal(result.ok, true);
    assert.equal(crossTenant.ok, true);
    if (!result.ok || !crossTenant.ok) return;
    const output = result.output as {
      session: { id: string; attachToken?: string };
      terminal: { available: boolean; truncated: boolean; text: string };
    };
    assert.equal(output.session.id, session.id);
    assert.equal(output.terminal.available, true);
    assert.equal(output.terminal.truncated, false);
    assert.match(output.terminal.text, /Last line answers/);
    assert.match(output.terminal.text, /\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(output), /secret-terminal-value|attachToken/);
    assert.equal((crossTenant.output as { session: unknown; terminal: { available: boolean } }).session, null);
    assert.equal((crossTenant.output as { terminal: { available: boolean } }).terminal.available, false);
  });

  it("gets a tenant-scoped model provider summary without leaking credentials", async () => {
    const providers = new ModelProviderRepository(db, userId, masterKey);
    const provider = providers.createProviderProfile({
      name: "MiniMax China",
      providerKey: "minimax-cn",
      baseUrl: "https://api.minimax.chat/v1",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude", "opencode"],
      defaultHeaders: { Authorization: "Bearer secret-header-value" }
    });
    const model = providers.createModelProfile({
      providerProfileId: provider.id,
      name: "MiniMax M2",
      modelId: "MiniMax-M2",
      isDefault: true
    });
    providers.createCredential({
      providerProfileId: provider.id,
      label: "Mainland key",
      plaintextSecret: "sk-minimax-secret"
    });
    new ModelProviderRepository(db, otherUserId, masterKey).createProviderProfile({
      name: "Foreign Provider",
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["opencode"]
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.get_model_provider_summary",
      {},
      context(userId)
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const output = result.output as {
      copilotSelection: {
        configured: boolean;
        providerProfileId?: string;
        providerName?: string;
        modelProfileId?: string;
        modelId?: string;
        clientKind?: string;
        credentialConfigured?: boolean;
      };
      providers: Array<{
        id: string;
        name: string;
        modelCount: number;
        activeModelCount: number;
        credentialCount: number;
        activeCredentialCount: number;
        readyForCopilot: boolean;
        defaultModelId: string | null;
      }>;
    };
    const json = JSON.stringify(output);
    assert.equal(output.copilotSelection.configured, true);
    assert.equal(output.copilotSelection.providerProfileId, provider.id);
    assert.equal(output.copilotSelection.providerName, "MiniMax China");
    assert.equal(output.copilotSelection.modelProfileId, model.id);
    assert.equal(output.copilotSelection.modelId, "MiniMax-M2");
    assert.equal(output.copilotSelection.clientKind, "openai-chat-completions");
    assert.equal(output.copilotSelection.credentialConfigured, true);
    assert.equal(output.providers.length, 1);
    assert.equal(output.providers[0]?.id, provider.id);
    assert.equal(output.providers[0]?.modelCount, 1);
    assert.equal(output.providers[0]?.activeModelCount, 1);
    assert.equal(output.providers[0]?.credentialCount, 1);
    assert.equal(output.providers[0]?.activeCredentialCount, 1);
    assert.equal(output.providers[0]?.readyForCopilot, true);
    assert.equal(output.providers[0]?.defaultModelId, model.id);
    assert.doesNotMatch(json, /sk-minimax-secret|secret-header-value|Foreign Provider/);
  });

  it("gets a bounded diagnostics summary", async () => {
    new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const providers = new ModelProviderRepository(db, userId, masterKey);
    const provider = providers.createProviderProfile({
      name: "OpenAI",
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["opencode"],
      defaultHeaders: { "x-secret-header": "secret-header-value" }
    });
    providers.createModelProfile({
      providerProfileId: provider.id,
      name: "GPT 5.1",
      modelId: "gpt-5.1",
      isDefault: true
    });
    providers.createCredential({
      providerProfileId: provider.id,
      label: "Prod key",
      plaintextSecret: "sk-provider-secret"
    });
    new ModelProviderRepository(db, otherUserId, masterKey).createProviderProfile({
      name: "Foreign Provider",
      providerKey: "anthropic",
      baseUrl: "https://api.anthropic.com",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["opencode"]
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.get_diagnostics_summary",
      {},
      context(userId)
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const output = result.output as {
      diagnostics: {
        counts: { projects: number };
        environment?: unknown;
        modelProviders: {
          counts: {
            providers: number;
            activeProviders: number;
            models: number;
            activeModels: number;
            credentials: number;
            activeCredentials: number;
            defaultModels: number;
          };
          apiFormats: Record<string, number>;
          providers: Array<{
            name: string;
            apiFormat: string;
            readyForUse: boolean;
            credentialCount: number;
            activeCredentialCount: number;
            modelCount: number;
            activeModelCount: number;
            hasDefaultModel: boolean;
          }>;
        };
        copilot: {
          providerReadiness: {
            providerConfigured: boolean;
            supportedProviderFormats: string[];
            counts: {
              activeProviders: number;
              activeModels: number;
              activeCredentials: number;
              readyProviders: number;
            };
          };
        };
      };
    };
    const json = JSON.stringify(output);
    assert.equal(output.diagnostics.counts.projects, 1);
    assert.equal(output.diagnostics.modelProviders.counts.providers, 1);
    assert.equal(output.diagnostics.modelProviders.counts.activeProviders, 1);
    assert.equal(output.diagnostics.modelProviders.counts.models, 1);
    assert.equal(output.diagnostics.modelProviders.counts.activeModels, 1);
    assert.equal(output.diagnostics.modelProviders.counts.credentials, 1);
    assert.equal(output.diagnostics.modelProviders.counts.activeCredentials, 1);
    assert.equal(output.diagnostics.modelProviders.counts.defaultModels, 1);
    assert.equal(output.diagnostics.modelProviders.apiFormats.openai, 1);
    assert.equal(output.diagnostics.modelProviders.providers[0]?.name, "OpenAI");
    assert.equal(output.diagnostics.modelProviders.providers[0]?.readyForUse, true);
    assert.equal(output.diagnostics.modelProviders.providers[0]?.credentialCount, 1);
    assert.equal(output.diagnostics.modelProviders.providers[0]?.activeCredentialCount, 1);
    assert.equal(output.diagnostics.modelProviders.providers[0]?.modelCount, 1);
    assert.equal(output.diagnostics.modelProviders.providers[0]?.activeModelCount, 1);
    assert.equal(output.diagnostics.modelProviders.providers[0]?.hasDefaultModel, true);
    assert.equal(output.diagnostics.copilot.providerReadiness.providerConfigured, true);
    assert.deepEqual(output.diagnostics.copilot.providerReadiness.supportedProviderFormats, [
      "openai",
      "openai-compatible",
      "anthropic"
    ]);
    assert.equal(output.diagnostics.copilot.providerReadiness.counts.activeProviders, 1);
    assert.equal(output.diagnostics.copilot.providerReadiness.counts.activeModels, 1);
    assert.equal(output.diagnostics.copilot.providerReadiness.counts.activeCredentials, 1);
    assert.equal(output.diagnostics.copilot.providerReadiness.counts.readyProviders, 1);
    assert.equal("environment" in output.diagnostics, false);
    assert.doesNotMatch(json, /sk-provider-secret|secret-header-value|Foreign Provider/);
  });

  it("redacts tool outputs before returning them", async () => {
    new ActivityRepository(db, userId).create({
      type: "copilot_test",
      message: "Bearer abc.def sk-test123456789",
      metadata: { OPENFORGE_ATTACH_TOKEN: "secret-token" }
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.get_recent_activity",
      { limit: 1 },
      context(userId)
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const json = JSON.stringify(result.output);
    assert.match(json, /Bearer \[REDACTED\]/);
    assert.match(json, /sk-\[REDACTED\]/);
    assert.doesNotMatch(json, /secret-token/);
  });

  it("blocks oversized tool outputs before returning them", async () => {
    const unsafeRegistry = createCopilotToolRegistry([{
      name: "openforge.large_test_output",
      description: "Return an oversized test payload.",
      risk: "read",
      requiresApproval: false,
      inputSchema: z.object({}),
      async execute() {
        return { text: "x".repeat(70 * 1024) };
      }
    }]);

    const result = await executeCopilotTool(unsafeRegistry, "openforge.large_test_output", {}, context(userId));

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_redaction_blocked_output");
  });

  it("blocks tool outputs that still contain private-key material after redaction", async () => {
    const unsafeRegistry = createCopilotToolRegistry([{
      name: "openforge.private_key_test_output",
      description: "Return suspected private-key material.",
      risk: "read",
      requiresApproval: false,
      inputSchema: z.object({}),
      async execute() {
        return {
          text: [
            "-----BEGIN OPENSSH PRIVATE KEY-----",
            "not-a-real-key",
            "-----END OPENSSH PRIVATE KEY-----"
          ].join("\n")
        };
      }
    }]);

    const result = await executeCopilotTool(unsafeRegistry, "openforge.private_key_test_output", {}, context(userId));

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_redaction_blocked_output");
  });

  it("exposes model-facing JSON schemas for tool parameters", () => {
    const definitions = toModelToolDefinitions(registry);
    const listProjects = definitions.find((tool) => tool.name === "openforge.list_projects");
    const projectDetail = definitions.find((tool) => tool.name === "openforge.get_project_detail");
    const listAgents = definitions.find((tool) => tool.name === "openforge.list_agents");
    const listSkills = definitions.find((tool) => tool.name === "openforge.list_skills");
    const skillDetail = definitions.find((tool) => tool.name === "openforge.get_skill_detail");
    const listTemplates = definitions.find((tool) => tool.name === "openforge.list_templates");
    const listPlugins = definitions.find((tool) => tool.name === "openforge.list_plugins");
    const notificationsSummary = definitions.find((tool) => tool.name === "openforge.get_notifications_summary");
    const usageSummary = definitions.find((tool) => tool.name === "openforge.get_usage_summary");
    const modelProviderCatalog = definitions.find((tool) => tool.name === "openforge.get_model_provider_catalog");
    const sessionDetail = definitions.find((tool) => tool.name === "openforge.get_session_detail");
    const terminalSnapshot = definitions.find((tool) => tool.name === "openforge.get_session_terminal_snapshot");
    const modelProviderSummary = definitions.find((tool) => tool.name === "openforge.get_model_provider_summary");
    const proposeSessionCreate = definitions.find((tool) => tool.name === "openforge.propose_session_create");
    const proposeSessionStart = definitions.find((tool) => tool.name === "openforge.propose_session_start");
    const proposeSessionStop = definitions.find((tool) => tool.name === "openforge.propose_session_stop");
    const proposeSessionDelete = definitions.find((tool) => tool.name === "openforge.propose_session_delete");
    const proposeAgentCreate = definitions.find((tool) => tool.name === "openforge.propose_agent_create");
    const proposeAgentUpdate = definitions.find((tool) => tool.name === "openforge.propose_agent_update");
    const proposeAgentDelete = definitions.find((tool) => tool.name === "openforge.propose_agent_delete");
    const proposeTemplateCreate = definitions.find((tool) => tool.name === "openforge.propose_template_create");
    const proposeTemplateUpdate = definitions.find((tool) => tool.name === "openforge.propose_template_update");
    const proposeTemplateDelete = definitions.find((tool) => tool.name === "openforge.propose_template_delete");
    const proposeSkillToggle = definitions.find((tool) => tool.name === "openforge.propose_skill_toggle");
    const proposePluginToggle = definitions.find((tool) => tool.name === "openforge.propose_plugin_toggle");
    const proposeProjectSkillToggle = definitions.find((tool) => tool.name === "openforge.propose_project_skill_toggle");
    const proposeProjectImport = definitions.find((tool) => tool.name === "openforge.propose_project_import");
    const proposeProjectDelete = definitions.find((tool) => tool.name === "openforge.propose_project_delete");
    const proposeCopilotModelSelection = definitions.find((tool) => tool.name === "openforge.propose_copilot_model_selection");
    const proposeModelProviderSync = definitions.find((tool) => tool.name === "openforge.propose_model_provider_sync");
    const proposeModelProviderApply = definitions.find((tool) => tool.name === "openforge.propose_model_provider_apply");
    const proposeAdapterRefresh = definitions.find((tool) => tool.name === "openforge.propose_adapter_refresh");
    const memorySearch = definitions.find((tool) => tool.name === "openforge.memory_search");
    const proposeMemoryDelete = definitions.find((tool) => tool.name === "openforge.propose_memory_delete");

    assert.deepEqual(listProjects?.inputSchema, {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    });
    assert.deepEqual(projectDetail?.inputSchema, {
      type: "object",
      properties: {
        projectId: { type: "string", minLength: 1 }
      },
      required: ["projectId"],
      additionalProperties: false
    });
    assert.deepEqual(listAgents?.inputSchema, {
      type: "object",
      properties: {
        projectId: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    });
    assert.deepEqual(listSkills?.inputSchema, {
      type: "object",
      properties: {
        projectId: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    });
    assert.deepEqual(skillDetail?.inputSchema, {
      type: "object",
      properties: {
        skillId: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 }
      },
      required: ["skillId"],
      additionalProperties: false
    });
    assert.deepEqual(listTemplates?.inputSchema, {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    });
    assert.deepEqual(listPlugins?.inputSchema, {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    });
    assert.deepEqual(notificationsSummary?.inputSchema, {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    });
    assert.deepEqual(usageSummary?.inputSchema, {
      type: "object",
      properties: {},
      additionalProperties: false
    });
    assert.deepEqual(modelProviderCatalog?.inputSchema, {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    });
    assert.deepEqual(sessionDetail?.inputSchema, {
      type: "object",
      properties: {
        sessionId: { type: "string", minLength: 1 }
      },
      required: ["sessionId"],
      additionalProperties: false
    });
    assert.deepEqual(terminalSnapshot?.inputSchema, {
      type: "object",
      properties: {
        sessionId: { type: "string", minLength: 1 },
        maxBytes: { type: "integer", minimum: 1, maximum: 16_000 }
      },
      required: ["sessionId"],
      additionalProperties: false
    });
    assert.deepEqual(modelProviderSummary?.inputSchema, {
      type: "object",
      properties: {},
      additionalProperties: false
    });
    assert.deepEqual(proposeSessionCreate?.inputSchema, {
      type: "object",
      properties: {
        projectId: {
          type: ["string", "null"],
          minLength: 1,
          description: "Target project id. Use null only when the user has exactly one visible project."
        },
        aiTool: { type: "string", enum: ["claude", "opencode", "codex"] },
        name: { type: "string", minLength: 1 }
      },
      required: ["aiTool"],
      additionalProperties: false
    });
    assert.deepEqual(proposeSessionStart?.inputSchema, {
      type: "object",
      properties: {
        sessionId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["sessionId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeSessionStop?.inputSchema, {
      type: "object",
      properties: {
        sessionId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["sessionId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeSessionDelete?.inputSchema, {
      type: "object",
      properties: {
        sessionId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["sessionId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeAgentCreate?.inputSchema, {
      type: "object",
      properties: {
        projectId: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        description: { type: "string", minLength: 1 },
        modelId: { type: "string", minLength: 1 },
        tools: { type: "string", minLength: 1 },
        allowedDirs: { type: "string", minLength: 1 },
        customPrompt: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["name"],
      additionalProperties: false
    });
    assert.deepEqual(proposeAgentUpdate?.inputSchema, {
      type: "object",
      properties: {
        agentId: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        description: { type: "string", minLength: 1 },
        modelId: { type: "string", minLength: 1 },
        tools: { type: "string", minLength: 1 },
        allowedDirs: { type: "string", minLength: 1 },
        customPrompt: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["active", "disabled"] },
        reason: { type: "string", minLength: 1 }
      },
      required: ["agentId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeAgentDelete?.inputSchema, {
      type: "object",
      properties: {
        agentId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["agentId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeTemplateCreate?.inputSchema, {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        description: { type: "string", minLength: 1 },
        version: { type: "string", minLength: 1 },
        visibility: { type: "string", enum: ["private", "shared", "admin"] },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filePath: { type: "string", minLength: 1 },
              content: { type: "string", maxLength: 16000 },
              fileType: { type: "string", minLength: 1 }
            },
            required: ["filePath", "content"],
            additionalProperties: false
          },
          maxItems: 20
        },
        reason: { type: "string", minLength: 1 }
      },
      required: ["name"],
      additionalProperties: false
    });
    assert.deepEqual(proposeTemplateUpdate?.inputSchema, {
      type: "object",
      properties: {
        templateId: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        description: { type: "string", minLength: 1 },
        version: { type: "string", minLength: 1 },
        visibility: { type: "string", enum: ["private", "shared", "admin"] },
        status: { type: "string", enum: ["active", "disabled"] },
        reason: { type: "string", minLength: 1 }
      },
      required: ["templateId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeTemplateDelete?.inputSchema, {
      type: "object",
      properties: {
        templateId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["templateId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeSkillToggle?.inputSchema, {
      type: "object",
      properties: {
        skillId: { type: "string", minLength: 1 },
        enabled: { type: "boolean" },
        reason: { type: "string", minLength: 1 }
      },
      required: ["skillId", "enabled"],
      additionalProperties: false
    });
    assert.deepEqual(proposePluginToggle?.inputSchema, {
      type: "object",
      properties: {
        pluginId: { type: "string", minLength: 1 },
        enabled: { type: "boolean" },
        reason: { type: "string", minLength: 1 }
      },
      required: ["pluginId", "enabled"],
      additionalProperties: false
    });
    assert.deepEqual(proposeProjectSkillToggle?.inputSchema, {
      type: "object",
      properties: {
        projectId: { type: "string", minLength: 1 },
        skillId: { type: "string", minLength: 1 },
        enabled: { type: "boolean" },
        reason: { type: "string", minLength: 1 }
      },
      required: ["projectId", "skillId", "enabled"],
      additionalProperties: false
    });
    assert.deepEqual(proposeProjectImport?.inputSchema, {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 },
        description: { type: "string", minLength: 1 },
        techStack: { type: "string", minLength: 1 },
        aiTool: { type: "string", enum: ["claude", "opencode", "codex"] },
        templateId: { type: "string", minLength: 1 }
      },
      required: ["name", "path"],
      additionalProperties: false
    });
    assert.deepEqual(proposeProjectDelete?.inputSchema, {
      type: "object",
      properties: {
        projectId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["projectId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeCopilotModelSelection?.inputSchema, {
      type: "object",
      properties: {
        providerProfileId: { type: "string", minLength: 1 },
        modelProfileId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["providerProfileId", "modelProfileId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeModelProviderSync?.inputSchema, {
      type: "object",
      properties: {
        providerProfileId: { type: "string", minLength: 1 },
        credentialId: { type: "string", minLength: 1 },
        timeoutMs: { type: "integer", minimum: 100, maximum: 30000 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["providerProfileId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeModelProviderApply?.inputSchema, {
      type: "object",
      properties: {
        adapter: { type: "string", enum: ["claude", "opencode", "openforge-copilot"] },
        providerProfileId: { type: "string", minLength: 1 },
        modelProfileId: { type: "string", minLength: 1 },
        credentialId: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      required: ["adapter", "providerProfileId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeAdapterRefresh?.inputSchema, {
      type: "object",
      properties: {
        reason: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    });
    assert.deepEqual(memorySearch?.inputSchema, {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 512 },
        scope: { type: "string", enum: ["global", "project", "session"] },
        projectId: { type: ["string", "null"], minLength: 1 },
        includeNotes: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 20 }
      },
      required: ["query"],
      additionalProperties: false
    });
    assert.deepEqual(proposeMemoryDelete?.inputSchema, {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        type: { type: "string", enum: ["entry", "note"] },
        reason: { type: "string", minLength: 1, maxLength: 1024 }
      },
      required: ["id"],
      additionalProperties: false
    });
  });

  it("keeps read tools tenant-scoped", async () => {
    new ProjectRepository(db, userId).create({
      name: "Owned",
      path: "/tmp/owned",
      aiTool: "claude"
    });
    new ProjectRepository(db, otherUserId).create({
      name: "Foreign",
      path: "/tmp/foreign",
      aiTool: "codex"
    });

    const result = await executeCopilotTool(registry, "openforge.list_projects", {}, context(userId));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const names = (result.output as { projects: Array<{ name: string }> }).projects.map((project) => project.name);
    assert.deepEqual(names, ["Owned"]);
  });

  it("creates session-create proposals as pending actions without creating sessions", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare session"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_session_create",
      { projectId: project.id, aiTool: "claude", name: "Draft session" },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_session_create");
    assert.equal(new SessionRepository(db, userId).list().length, 0);
  });

  it("resolves missing session-create project ids when exactly one project is available", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Create a Claude Code session"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_session_create",
      { projectId: "null", aiTool: "claude", name: "Claude Code" },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.type, "openforge.propose_session_create");
    assert.equal(actions[0]?.input.projectId, project.id);
    assert.equal(actions[0]?.input.aiTool, "claude");
    assert.equal(new SessionRepository(db, userId).list().length, 0);
  });

  it("rejects missing session-create project ids when multiple projects are available", async () => {
    new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    new ProjectRepository(db, userId).create({
      name: "Aether Glass",
      path: "/tmp/aether-glass",
      aiTool: "codex"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Create a Claude Code session"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_session_create",
      { projectId: null, aiTool: "claude", name: "Claude Code" },
      context(userId, run.id)
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_tool_validation_failed");
    assert.match(result.error.message, /requires a project/i);
    assert.equal(new CopilotRepository(db, userId).listPendingActions(run.id).length, 0);
    assert.equal(new SessionRepository(db, userId).list().length, 0);
  });

  it("requires same-run session detail and terminal snapshot before proposing session input", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const createdSession = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-main"
    });
    const session = sessionRepo.updateStatus(createdSession.id, "running") ?? createdSession;
    const copilot = new CopilotRepository(db, userId);
    const run = copilot.createRun({
      status: "running",
      source: "copilot",
      goal: "Send input to a running session"
    });

    const withoutEvidence = await executeCopilotTool(
      registry,
      "openforge.propose_session_input",
      { sessionId: session.id, input: "pwd\\n", submit: true },
      context(userId, run.id)
    );

    copilot.addEvent(run.id, {
      type: "tool_result",
      message: "openforge.get_session_detail",
      payload: { output: { session: { id: session.id, status: "running", isLive: true } } }
    });
    copilot.addEvent(run.id, {
      type: "tool_result",
      message: "openforge.get_session_terminal_snapshot",
      payload: {
        output: {
          session: { id: session.id },
          terminal: { available: true, truncated: false, text: "Claude Code ready" }
        }
      }
    });
    const withEvidence = await executeCopilotTool(
      registry,
      "openforge.propose_session_input",
      { sessionId: session.id, input: "pwd\\n", submit: true },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(withoutEvidence.ok, false);
    assert.equal(withoutEvidence.error.code, "copilot_tool_validation_failed");
    assert.match(withoutEvidence.error.message, /terminal snapshot/i);
    assert.equal(withEvidence.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.type, "openforge.propose_session_input");
    assert.deepEqual(actions[0]?.input, { sessionId: session.id, input: "pwd\\n", submit: true });
  });

  it("creates session-stop proposals as pending actions without stopping sessions", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const createdSession = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-main"
    });
    const session = sessionRepo.updateStatus(createdSession.id, "running") ?? createdSession;
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare session stop"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_session_stop",
      { sessionId: session.id, reason: "User asked to stop it." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_session_stop");
    assert.equal(new SessionRepository(db, userId).getById(session.id)?.status, "running");
  });

  it("creates session-start proposals as pending actions without starting sessions", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const session = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare session start"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_session_start",
      { sessionId: session.id, reason: "User asked to resume it." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_session_start");
    assert.equal(new SessionRepository(db, userId).getById(session.id)?.status, "idle");
  });

  it("creates session-delete proposals as pending actions without deleting sessions", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, userId).create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare session delete"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_session_delete",
      { sessionId: session.id, reason: "User asked to remove it." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_session_delete");
    assert.equal(new SessionRepository(db, userId).getById(session.id)?.id, session.id);
  });

  it("creates skill-toggle proposals as pending actions without changing skill state", async () => {
    const skill = new SkillRepository(db, userId).create({
      name: "debugging",
      content: "Use systematic debugging.",
      isEnabled: false
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare skill toggle"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_skill_toggle",
      { skillId: skill.id, enabled: true, reason: "User asked to enable it." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_skill_toggle");
    assert.equal(new SkillRepository(db, userId).getById(skill.id)?.isEnabled, false);
  });

  it("creates plugin-toggle proposals as pending actions without changing plugin state", async () => {
    const repo = new PluginRepository(db, userId);
    const pluginBefore = repo.getByPluginId("claude-safe-edits");
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare plugin toggle"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_plugin_toggle",
      { pluginId: "claude-safe-edits", enabled: true, reason: "Enable safer Claude edits." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_plugin_toggle");
    assert.equal(repo.getByPluginId("claude-safe-edits")?.status, pluginBefore?.status);
  });

  it("creates project skill-toggle proposals as pending actions without changing project skill state", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const skill = new SkillRepository(db, userId).create({
      name: "debugging",
      content: "Use systematic debugging.",
      isEnabled: false
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare project skill toggle"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_project_skill_toggle",
      { projectId: project.id, skillId: skill.id, enabled: true, reason: "Enable for this project." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_project_skill_toggle");
  });

  it("creates agent management proposals as pending actions without changing agents", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge-agent-tools",
      aiTool: "claude"
    });
    const agent = new AgentRepository(db, userId).create({
      projectId: project.id,
      name: "Reviewer",
      description: "Reviews code",
      tools: "read"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare agent changes"
    });

    const createResult = await executeCopilotTool(
      registry,
      "openforge.propose_agent_create",
      { projectId: project.id, name: "Debugger", tools: "read,search", reason: "User asked for a debugger." },
      context(userId, run.id)
    );
    const updateResult = await executeCopilotTool(
      registry,
      "openforge.propose_agent_update",
      { agentId: agent.id, name: "Code Reviewer", status: "disabled", reason: "Pause it for now." },
      context(userId, run.id)
    );
    const deleteResult = await executeCopilotTool(
      registry,
      "openforge.propose_agent_delete",
      { agentId: agent.id, reason: "Remove unused agent." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    const persistedAgent = new AgentRepository(db, userId).getById(agent.id);
    assert.equal(createResult.ok, true);
    assert.equal(updateResult.ok, true);
    assert.equal(deleteResult.ok, true);
    assert.deepEqual(actions.map((action) => action.type), [
      "openforge.propose_agent_create",
      "openforge.propose_agent_update",
      "openforge.propose_agent_delete"
    ]);
    assert.equal(persistedAgent?.name, "Reviewer");
    assert.equal(new AgentRepository(db, userId).list().length, 1);
  });

  it("creates template management proposals as pending actions without changing templates", async () => {
    const template = new TemplateRepository(db, userId).create({
      name: "Claude Starter",
      description: "Starter template",
      files: [{ filePath: "CLAUDE.md", content: "# Guide", fileType: "markdown" }]
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare template changes"
    });

    const createResult = await executeCopilotTool(
      registry,
      "openforge.propose_template_create",
      { name: "OpenCode Starter", files: [{ filePath: "AGENTS.md", content: "# Agents" }] },
      context(userId, run.id)
    );
    const updateResult = await executeCopilotTool(
      registry,
      "openforge.propose_template_update",
      { templateId: template.id, name: "Claude Starter v2", status: "disabled" },
      context(userId, run.id)
    );
    const deleteResult = await executeCopilotTool(
      registry,
      "openforge.propose_template_delete",
      { templateId: template.id, reason: "Remove unused template." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    const persistedTemplate = new TemplateRepository(db, userId).getById(template.id);
    assert.equal(createResult.ok, true);
    assert.equal(updateResult.ok, true);
    assert.equal(deleteResult.ok, true);
    assert.deepEqual(actions.map((action) => action.type), [
      "openforge.propose_template_create",
      "openforge.propose_template_update",
      "openforge.propose_template_delete"
    ]);
    assert.equal(persistedTemplate?.name, "Claude Starter");
    assert.equal(new TemplateRepository(db, userId).list().length, 1);
  });

  it("creates Copilot model-selection proposals without changing the default model", async () => {
    const providers = new ModelProviderRepository(db, userId, masterKey);
    const existingProvider = providers.createProviderProfile({
      name: "OpenAI",
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["opencode"]
    });
    const existingModel = providers.createModelProfile({
      providerProfileId: existingProvider.id,
      name: "GPT",
      modelId: "gpt-5.1",
      isDefault: true
    });
    providers.createCredential({
      providerProfileId: existingProvider.id,
      plaintextSecret: "sk-openai"
    });
    const targetProvider = providers.createProviderProfile({
      name: "Anthropic",
      providerKey: "anthropic",
      baseUrl: "https://api.anthropic.com",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["claude", "opencode"]
    });
    const targetModel = providers.createModelProfile({
      providerProfileId: targetProvider.id,
      name: "Claude",
      modelId: "claude-sonnet-4-5"
    });
    providers.createCredential({
      providerProfileId: targetProvider.id,
      plaintextSecret: "sk-ant"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare Copilot model switch"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_copilot_model_selection",
      {
        providerProfileId: targetProvider.id,
        modelProfileId: targetModel.id,
        reason: "Use Anthropic for Copilot."
      },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_copilot_model_selection");
    assert.equal(providers.getModelProfile(existingModel.id)?.isDefault, true);
    assert.equal(providers.getModelProfile(targetModel.id)?.isDefault, false);
  });

  it("creates model-provider apply proposals without writing config files", async () => {
    const providers = new ModelProviderRepository(db, userId, masterKey);
    const provider = providers.createProviderProfile({
      name: "MiniMax China",
      providerKey: "minimax-cn",
      baseUrl: "https://api.minimax.chat/v1",
      anthropicBaseUrl: "https://api.minimax.chat/anthropic",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude", "opencode"]
    });
    const model = providers.createModelProfile({
      providerProfileId: provider.id,
      name: "MiniMax M2",
      modelId: "MiniMax-M2"
    });
    const credential = providers.createCredential({
      providerProfileId: provider.id,
      plaintextSecret: "sk-minimax"
    });
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare Claude provider apply"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_model_provider_apply",
      {
        adapter: "claude",
        providerProfileId: provider.id,
        modelProfileId: model.id,
        credentialId: credential.id,
        projectId: project.id,
        reason: "Use MiniMax for Claude Code."
      },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_model_provider_apply");
    assert.equal(actions[0]?.input.adapter, "claude");
    assert.equal(actions[0]?.input.providerProfileId, provider.id);
    assert.equal(actions[0]?.input.modelProfileId, model.id);
    assert.equal(actions[0]?.input.credentialId, credential.id);
    assert.equal(actions[0]?.input.projectId, project.id);
  });

  it("creates model-provider sync proposals without syncing models", async () => {
    const providers = new ModelProviderRepository(db, userId, masterKey);
    const provider = providers.createProviderProfile({
      name: "MiniMax China",
      providerKey: "minimax-cn",
      baseUrl: "https://api.minimax.chat/v1",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude", "opencode"]
    });
    const credential = providers.createCredential({
      providerProfileId: provider.id,
      plaintextSecret: "sk-minimax"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare provider model sync"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_model_provider_sync",
      {
        providerProfileId: provider.id,
        credentialId: credential.id,
        reason: "Sync available MiniMax models."
      },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_model_provider_sync");
    assert.equal(providers.listModelProfiles(provider.id).length, 0);
  });

  it("creates project-create proposals as pending actions without creating projects", async () => {
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare project"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_project_create",
      { name: "New Project", path: "/tmp/openforge-new-project", aiTool: "claude" },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_project_create");
    assert.equal(new ProjectRepository(db, userId).list().length, 0);
  });

  it("creates project-import proposals as pending actions without importing projects", async () => {
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare project import"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_project_import",
      {
        name: "Existing Project",
        path: "/tmp/existing-project",
        aiTool: "claude",
        description: "Import through Copilot"
      },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_project_import");
    assert.equal(actions[0]?.input.path, "/tmp/existing-project");
    assert.equal(new ProjectRepository(db, userId).list().length, 0);
  });

  it("creates project-delete proposals as pending actions without deleting projects", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare project delete"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_project_delete",
      { projectId: project.id, reason: "User asked to remove it." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_project_delete");
    assert.equal(new ProjectRepository(db, userId).getById(project.id)?.id, project.id);
  });

  it("creates project-config-sync proposals as pending actions without writing config files", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare config sync"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_project_config_sync",
      { projectId: project.id, credentialMode: "host_environment" },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_project_config_sync");
    assert.equal(actions[0]?.input.projectId, project.id);
  });

  it("rejects session-create proposals for projects outside the current tenant", async () => {
    const foreignProject = new ProjectRepository(db, otherUserId).create({
      name: "Foreign",
      path: "/tmp/foreign",
      aiTool: "codex"
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare session"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_session_create",
      { projectId: foreignProject.id, aiTool: "claude", name: "Invalid draft" },
      context(userId, run.id)
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_tool_validation_failed");
    assert.equal(new CopilotRepository(db, userId).listPendingActions(run.id).length, 0);
    assert.equal(new SessionRepository(db, userId).list().length, 0);
  });

  it("rejects session-create proposals for unsupported adapters", async () => {
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare session"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_session_create",
      { projectId: "project-1", aiTool: "shell", name: "Invalid draft" },
      context(userId, run.id)
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_tool_validation_failed");
    assert.equal(new CopilotRepository(db, userId).listPendingActions(run.id).length, 0);
    assert.equal(new SessionRepository(db, userId).list().length, 0);
  });

  it("creates diagnostics-export proposals as pending actions without returning diagnostics", async () => {
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare diagnostics"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_diagnostics_export",
      { reason: "Gateway launch failed" },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.type, "openforge.propose_diagnostics_export");
    assert.deepEqual((result as { ok: true; output: { actionId: string } }).output.actionId, actions[0]?.id);
  });

  it("creates adapter-refresh proposals as pending actions without refreshing adapters", async () => {
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Refresh adapters"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_adapter_refresh",
      { reason: "Recheck CLI availability after install." },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "pending");
    assert.equal(actions[0]?.type, "openforge.propose_adapter_refresh");
    assert.deepEqual(actions[0]?.input, { reason: "Recheck CLI availability after install." });
  });

  it("creates Feishu collaboration proposals as pending actions without executing Feishu CLI", async () => {
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare Feishu collaboration"
    });
    const adapterCommands: string[] = [];
    const toolInputs = [
      {
        name: "openforge.propose_feishu_message_send",
        input: { chatId: "oc_openforge", text: "Build is green.", reason: "Notify the project chat." }
      },
      {
        name: "openforge.propose_feishu_doc_create",
        input: { title: "Sprint Plan", content: "# Plan\nShip Task 4.", folderId: "fld_openforge" }
      },
      {
        name: "openforge.propose_feishu_doc_update",
        input: { documentId: "doc_openforge", content: "# Updated Plan" }
      },
      {
        name: "openforge.propose_feishu_task_create",
        input: {
          summary: "Verify Copilot",
          description: "Run route tests",
          assigneeFeishuUserId: "ou_user",
          dueDate: "2026-05-20",
          tasklistId: "tasklist_openforge"
        }
      },
      {
        name: "openforge.propose_feishu_task_update",
        input: { taskId: "task_openforge", status: "done", summary: "Verify Copilot" }
      }
    ];

    const results = [];
    for (const tool of toolInputs) {
      results.push(await executeCopilotTool(registry, tool.name, tool.input, {
        ...context(userId, run.id),
        adapterCommandRunner: async (command) => {
          adapterCommands.push(command);
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        }
      }));
    }

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.deepEqual(results.map((result) => result.ok), [true, true, true, true, true]);
    assert.deepEqual(actions.map((action) => action.type), toolInputs.map((tool) => tool.name));
    assert.deepEqual(actions.map((action) => action.status), ["pending", "pending", "pending", "pending", "pending"]);
    assert.deepEqual(actions.map((action) => action.input), toolInputs.map((tool) => tool.input));
    assert.deepEqual(adapterCommands, []);
  });

  it("searches Copilot memory through bounded tenant-scoped tools", async () => {
    const memory = new CopilotMemoryRepository(db, userId);
    const entry = memory.createEntry({
      kind: "decision",
      scope: "global",
      text: "Copilot memory recall must stay explicit and bounded."
    });
    memory.createNote({
      text: "Working note: memory recall can include notes when requested."
    });
    new CopilotMemoryRepository(db, otherUserId).createEntry({
      kind: "decision",
      scope: "global",
      text: "Foreign memory recall should not appear."
    });

    const entriesOnly = await executeCopilotTool(
      registry,
      "openforge.memory_search",
      { query: "memory recall", includeNotes: false, limit: 10 },
      context(userId)
    );
    const withNotes = await executeCopilotTool(
      registry,
      "openforge.memory_search",
      { query: "memory recall", includeNotes: true, limit: 10 },
      context(userId)
    );

    assert.equal(entriesOnly.ok, true);
    assert.equal(withNotes.ok, true);
    if (!entriesOnly.ok || !withNotes.ok) return;
    assert.deepEqual((entriesOnly.output as { results: Array<{ id: string }> }).results.map((item) => item.id), [entry.id]);
    assert.equal((withNotes.output as { results: unknown[] }).results.length, 2);
  });

  it("gets a single Copilot memory item through tenant-scoped tools", async () => {
    const entry = new CopilotMemoryRepository(db, userId).createEntry({
      kind: "fact",
      scope: "global",
      text: "Gateway owns Copilot provider calls."
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.memory_get",
      { id: entry.id, type: "entry" },
      context(userId)
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal((result.output as { item: { id: string } | null }).item?.id, entry.id);
    assert.equal((result.output as { item: { redactedText: string } }).item.redactedText, entry.redactedText);
  });

  it("creates memory-write proposals without durable writes", async () => {
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare memory"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_memory_write",
      {
        kind: "decision",
        scope: "global",
        text: "Remember that provider SSOT is the model baseline."
      },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.type, "openforge.propose_memory_write");
    assert.equal(new CopilotMemoryRepository(db, userId).listEntries({}).length, 0);
  });

  it("creates memory-delete proposals without durable deletes", async () => {
    const memory = new CopilotMemoryRepository(db, userId);
    const entry = memory.createEntry({
      kind: "decision",
      scope: "global",
      text: "Remove stale provider routing memory."
    });
    const run = new CopilotRepository(db, userId).createRun({
      status: "running",
      source: "copilot",
      goal: "Prepare memory cleanup"
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.propose_memory_delete",
      {
        id: entry.id,
        type: "entry",
        reason: "This memory is stale."
      },
      context(userId, run.id)
    );

    const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
    assert.equal(result.ok, true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.type, "openforge.propose_memory_delete");
    assert.deepEqual(actions[0]?.input, {
      id: entry.id,
      type: "entry",
      reason: "This memory is stale."
    });
    assert.equal(new CopilotMemoryRepository(db, userId).getEntry(entry.id)?.id, entry.id);
  });

  function context(id: string, runId?: string) {
    return { db, userId: id, masterKey, ...(runId ? { runId } : {}) };
  }

  function runtimeContext(
    id: string,
    sessions: Array<{ id: string; status: string; tmuxName: string }>
  ) {
    return {
      ...context(id),
      sessionManager: {
        async captureHistory() {
          return "";
        },
        listSessions() {
          return sessions;
        }
      }
    };
  }
});
