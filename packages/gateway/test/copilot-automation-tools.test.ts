import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { CopilotAutomationRepository } from "../src/db/repositories/copilot-automation-repository.js";
import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createCopilotAutomationTools } from "../src/services/copilot/automation-tools.js";
import { createCopilotToolRegistry, executeCopilotTool } from "../src/services/copilot/tool-registry.js";

const masterKey = "cd".repeat(32);

describe("Copilot automation tools", () => {
  let db: Database.Database;
  let userId: string;
  let projectId: string;
  let runId: string;
  const registry = createCopilotToolRegistry(createCopilotAutomationTools());

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
    userId = new UserRepository(db).create("tools@example.com", "hash").id;
    projectId = new ProjectRepository(db, userId).create({ name: "OpenForge", path: "/tmp/openforge", aiTool: "codex" }).id;
    runId = new CopilotRepository(db, userId).createRun({ status: "running", source: "copilot", goal: "Set a weekly report" }).id;
  });

  it("exposes bounded CRUD, run-now, and history tools", () => {
    assert.deepEqual([...registry.tools.keys()], [
      "openforge.list_automations", "openforge.get_automation",
      "openforge.propose_automation_create", "openforge.propose_automation_update",
      "openforge.propose_automation_pause", "openforge.propose_automation_resume",
      "openforge.propose_automation_delete", "openforge.propose_automation_run_now",
      "openforge.list_automation_runs"
    ]);
    const createSchema = registry.tools.get("openforge.propose_automation_create")?.modelInputSchema;
    assert.deepEqual((createSchema?.required as string[] | undefined), ["name", "prompt", "scope", "schedule", "delivery"]);
    assert.equal(createSchema?.additionalProperties, false);
  });

  it("turns an observe-mode natural-language proposal into a pending action", async () => {
    const result = await executeCopilotTool(registry, "openforge.propose_automation_create", createInput(projectId), context("observe"));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requiresApproval, true);
    assert.equal(new CopilotAutomationRepository(db, userId).list().length, 0);
    assert.equal(new CopilotRepository(db, userId).listPendingActions(runId)[0]?.type, "openforge.propose_automation_create");
  });

  it("auto-executes only bounded project automation in operate mode", async () => {
    const result = await executeCopilotTool(registry, "openforge.propose_automation_create", createInput(projectId), context("operate"));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requiresApproval, false);
    assert.equal(new CopilotAutomationRepository(db, userId).list().length, 1);
  });

  it("requires approval for workspace scope and rejects timezone, shell fields, and authority expansion", async () => {
    const workspace = await executeCopilotTool(registry, "openforge.propose_automation_create", {
      ...createInput(projectId), scope: { type: "workspace" }
    }, context("operate"));
    assert.equal(workspace.ok && workspace.requiresApproval, true);

    const noTimezone = await executeCopilotTool(registry, "openforge.propose_automation_create", {
      ...createInput(projectId), schedule: { kind: "cron", expression: "0 9 * * 1" }
    }, context("operate"));
    assert.equal(noTimezone.ok, false);

    const shellPayload = await executeCopilotTool(registry, "openforge.propose_automation_create", {
      ...createInput(projectId), command: "rm -rf /tmp/example"
    }, context("operate"));
    assert.equal(shellPayload.ok, false);

    const expanded = await executeCopilotTool(registry, "openforge.propose_automation_create", {
      ...createInput(projectId), toolAuthority: ["project.read", "shell.execute"]
    }, context("operate"));
    assert.equal(expanded.ok, false);
  });

  function context(mode: "observe" | "operate") {
    return {
      db, userId, masterKey, runId,
      automationAuthority: { mode, toolNames: ["project.read", "session.read"] }
    };
  }
});

function createInput(projectId: string) {
  return {
    name: "每周项目报告", prompt: "汇总进展、阻塞和下一步。",
    scope: { type: "project", projectIds: [projectId] },
    schedule: { kind: "cron", expression: "0 9 * * 1", timezone: "Asia/Shanghai" },
    delivery: { channel: "feishu", accountId: "default", chatId: "oc_weekly" },
    toolAuthority: ["project.read"]
  };
}
