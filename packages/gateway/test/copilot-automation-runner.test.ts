import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { CopilotAutomationRepository } from "../src/db/repositories/copilot-automation-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import { CopilotAutomationRunner } from "../src/services/copilot/automation-runner.js";

const masterKey = "ab".repeat(32);

describe("CopilotAutomationRunner", () => {
  let db: Database.Database;
  let user: User;
  let repo: CopilotAutomationRepository;
  let projectId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(drizzle(db), {
      migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
    });
    user = new UserRepository(db).create("runner@example.com", "hash");
    repo = new CopilotAutomationRepository(db, user.id, masterKey);
    projectId = new ProjectRepository(db, user.id).create({
      name: "OpenForge", path: "/tmp/openforge", aiTool: "codex"
    }).id;
  });

  it("snapshots scope, persists generated content once, and retries delivery without regeneration", async () => {
    const automation = createAutomation(repo, projectId);
    const run = repo.createOrGetRun(automation.id, "2026-08-12T05:00:00.000Z", "scheduled");
    let generations = 0;
    let deliveries = 0;
    const runner = new CopilotAutomationRunner(repo, {
      now: () => new Date("2026-08-12T05:00:00.000Z"),
      listProjects: () => [{ projectId, name: "OpenForge" }, { projectId: "other", name: "Other" }],
      generate: async (input) => {
        generations += 1;
        assert.deepEqual(input.projects.map((project) => project.projectId), [projectId]);
        assert.deepEqual(input.toolAuthority, ["project.read"]);
        assert.ok(input.deadlineAt > input.startedAt);
        return { content: "Weekly report: all green", usageTokens: 500 };
      },
      enqueueDelivery: async (plan) => {
        deliveries += 1;
        assert.equal(plan.idempotencyKey, `automation:${run.executionId}`);
        if (deliveries === 1) throw new Error("temporary delivery failure");
        return { id: "outbox-1" };
      },
      retryDelayMs: 0
    });

    await assert.rejects(runner.run(run.id), /temporary delivery failure/);
    assert.equal(repo.getRun(run.id)?.status, "pending");
    assert.equal(repo.decryptGeneratedContent(run.id), "Weekly report: all green");
    const raw = db.prepare("SELECT generated_content_encrypted FROM copilot_automation_runs WHERE id = ?")
      .get(run.id) as { generated_content_encrypted: string };
    assert.doesNotMatch(raw.generated_content_encrypted, /Weekly report/);

    await runner.run(run.id);
    assert.equal(generations, 1);
    assert.equal(deliveries, 2);
    assert.equal(repo.getRun(run.id)?.status, "delivery_pending");
    assert.equal(repo.getRun(run.id)?.outboxId, "outbox-1");
    assert.deepEqual(repo.listProjectSnapshots(run.id), [{ projectId, name: "OpenForge" }]);
  });

  it("fails closed when generation exceeds the usage budget", async () => {
    const automation = createAutomation(repo, projectId);
    const run = repo.createOrGetRun(automation.id, "2026-08-12T05:00:00.000Z", "scheduled");
    const runner = new CopilotAutomationRunner(repo, {
      now: () => new Date("2026-08-12T05:00:00.000Z"),
      listProjects: () => [{ projectId, name: "OpenForge" }],
      generate: async () => ({ content: "too expensive", usageTokens: 2_001 }),
      enqueueDelivery: async () => ({ id: "never" }),
      maxUsageTokens: 2_000,
      maxAttempts: 1
    });

    await assert.rejects(runner.run(run.id), /AUTOMATION_USAGE_BUDGET_EXCEEDED/);
    assert.equal(repo.getRun(run.id)?.status, "failed");
    assert.equal(repo.getRun(run.id)?.lastErrorCode, "AUTOMATION_USAGE_BUDGET_EXCEEDED");
  });
});

function createAutomation(repo: CopilotAutomationRepository, projectId: string) {
  return repo.create({
    name: "Project weekly report", status: "active", scopeType: "project",
    scopePolicy: { projectIds: [projectId] }, prompt: "Summarize progress.",
    scheduleKind: "cron", scheduleExpression: "0 9 * * 1", timezone: "Asia/Shanghai",
    deliveryPlan: { channel: "feishu", accountId: "default", chatId: "oc_weekly" },
    authoritySnapshot: { mode: "operate", tools: ["project.read"], maxUsageTokens: 2_000, deadlineMs: 30_000 },
    nextRunAt: new Date(0)
  });
}
