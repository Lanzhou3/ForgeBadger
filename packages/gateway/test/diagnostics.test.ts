import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { ApiKeyRepository } from "../src/db/repositories/api-key-repository.js";
import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import { CopilotMemoryRepository } from "../src/db/repositories/copilot-memory-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import {
  buildLocalDiagnosticsExport,
  redactDiagnosticValue
} from "../src/services/diagnostics.js";

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

describe("local diagnostics export", () => {
  it("redacts secrets from scalar and nested diagnostic values", () => {
    assert.equal(redactDiagnosticValue("sk-ant-secret"), "[redacted]");
    assert.deepEqual(
      redactDiagnosticValue({
        token: "abc",
        nested: { OPENFORGE_MASTER_KEY: "secret", safe: "value" }
      }),
      {
        token: "[redacted]",
        nested: { OPENFORGE_MASTER_KEY: "[redacted]", safe: "value" }
      }
    );
  });

  it("exports local health and activity counts without plaintext credentials", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("diagnostics@example.com", "hash");
      const otherUser = new UserRepository(db).create("other-diagnostics@example.com", "hash");
      new ApiKeyRepository(db, user.id, "a".repeat(64)).create({
        provider: "openai",
        label: "test",
        plaintextKey: "sk-test-secret"
      });
      const providers = new ModelProviderRepository(db, user.id, "a".repeat(64));
      const openAiProvider = providers.createProviderProfile({
        name: "OpenAI",
        providerKey: "openai",
        baseUrl: "https://api.openai.com/v1",
        authType: "api_key",
        apiFormat: "openai",
        supportedAdapters: ["opencode"]
      });
      providers.createModelProfile({
        providerProfileId: openAiProvider.id,
        name: "GPT",
        modelId: "gpt-5.1",
        isDefault: true
      });
      providers.createCredential({
        providerProfileId: openAiProvider.id,
        label: "Prod key",
        plaintextSecret: "sk-provider-secret"
      });
      const deepSeekProvider = providers.createProviderProfile({
        name: "DeepSeek",
        providerKey: "deepseek",
        baseUrl: "https://api.deepseek.com",
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["opencode"]
      });
      db.prepare("UPDATE model_provider_profiles SET status = 'disabled' WHERE id = ?").run(deepSeekProvider.id);
      new ModelProviderRepository(db, otherUser.id, "a".repeat(64)).createProviderProfile({
        name: "Foreign Provider",
        providerKey: "anthropic",
        baseUrl: "https://api.anthropic.com",
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["opencode"]
      });
      new AuditLogRepository(db, user.id).create({
        action: "diagnostics.test",
        resourceType: "diagnostics",
        details: { token: "abc" }
      });
      const memory = new CopilotMemoryRepository(db, user.id);
      memory.createEntry({
        kind: "decision",
        scope: "global",
        text: "Remember token=secret-value"
      });
      memory.createNote({
        text: "Working note with Bearer abc.def"
      });

      const report = buildLocalDiagnosticsExport({
        db,
        userId: user.id,
        masterKey: "a".repeat(64),
        appVersion: "0.0.0-test",
        now: new Date("2026-05-06T00:00:00.000Z"),
        env: {
          OPENFORGE_MASTER_KEY: "a".repeat(64),
          OPENAI_API_KEY: "sk-test-secret"
        }
      });

      assert.equal(report.generatedAt, "2026-05-06T00:00:00.000Z");
      assert.equal(report.app.version, "0.0.0-test");
      assert.equal(report.counts.apiKeys, 1);
      assert.equal(report.counts.auditLogs, 1);
      assert.equal(report.counts.copilotMemoryEntries, 1);
      assert.equal(report.counts.copilotMemoryNotes, 1);
      assert.equal(report.modelProviders.counts.providers, 2);
      assert.equal(report.modelProviders.counts.activeProviders, 1);
      assert.equal(report.modelProviders.counts.models, 1);
      assert.equal(report.modelProviders.counts.activeModels, 1);
      assert.equal(report.modelProviders.counts.credentials, 1);
      assert.equal(report.modelProviders.counts.activeCredentials, 1);
      assert.equal(report.modelProviders.counts.defaultModels, 1);
      assert.deepEqual(report.modelProviders.apiFormats, {
        openai: 1,
        "openai-compatible": 1
      });
      assert.deepEqual(report.modelProviders.providers, [
        {
          id: openAiProvider.id,
          name: "OpenAI",
          providerKey: "openai",
          apiFormat: "openai",
          authType: "api_key",
          status: "active",
          modelCount: 1,
          activeModelCount: 1,
          credentialCount: 1,
          activeCredentialCount: 1,
          hasDefaultModel: true,
          readyForUse: true
        },
        {
          id: deepSeekProvider.id,
          name: "DeepSeek",
          providerKey: "deepseek",
          apiFormat: "openai-compatible",
          authType: "api_key",
          status: "disabled",
          modelCount: 0,
          activeModelCount: 0,
          credentialCount: 0,
          activeCredentialCount: 0,
          hasDefaultModel: false,
          readyForUse: false
        }
      ]);
      assert.equal(report.copilot.capabilities.memoryEnabled, true);
      assert.equal(report.copilot.capabilities.memoryWritesRequireApproval, true);
      assert.equal("OPENFORGE_MASTER_KEY" in report.environment, false);
      assert.equal("OPENAI_API_KEY" in report.environment, false);
      assert.equal(JSON.stringify(report).includes("sk-test-secret"), false);
      assert.equal(JSON.stringify(report).includes("sk-provider-secret"), false);
      assert.equal(JSON.stringify(report).includes("Foreign Provider"), false);
      assert.equal(JSON.stringify(report).includes("secret-value"), false);
    } finally {
      db.close();
    }
  });

  it("includes safe Feishu integration capability state without CLI error details", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("diagnostics-feishu@example.com", "hash");

      const report = buildLocalDiagnosticsExport({
        db,
        userId: user.id,
        masterKey: "a".repeat(64),
        appVersion: "0.0.0-test",
        now: new Date("2026-05-17T00:00:00.000Z"),
        feishuStatus: {
          available: false,
          authState: "unknown",
          identityMode: "unknown",
          enabled: false,
          error: "command failed with token sk-diagnostics-secret"
        }
      });

      assert.deepEqual(report.integrations.feishu, {
        available: false,
        authState: "unknown",
        identityMode: "unknown",
        enabled: false
      });
      assert.equal(JSON.stringify(report).includes("sk-diagnostics-secret"), false);
    } finally {
      db.close();
    }
  });

  it("exports tenant-scoped project-manager counts and safe latest markers only", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("diagnostics-pm@example.com", "hash");
      const otherUser = new UserRepository(db).create("diagnostics-pm-other@example.com", "hash");
      const project = new ProjectRepository(db, user.id).create({
        name: "Diagnostics PM",
        path: "/tmp/diagnostics-pm",
        aiTool: "claude"
      });
      const otherProject = new ProjectRepository(db, otherUser.id).create({
        name: "Diagnostics PM foreign",
        path: "/tmp/diagnostics-pm-foreign",
        aiTool: "claude"
      });
      const repo = new ProjectManagerRepository(db, user.id);
      repo.upsertGoal(project.id, { summary: "Diagnostics summary" });
      const item = repo.createWorkItem(project.id, {
        title: "Count me",
        details: { rawTerminalOutput: "OPENFORGE_ATTACH_TOKEN=diagnostics-pm-secret" }
      });
      repo.updateWorkItemStatus(project.id, item.id, { status: "in_progress" });
      new ProjectManagerRepository(db, otherUser.id).createWorkItem(otherProject.id, {
        title: "Foreign hidden"
      });

      const report = buildLocalDiagnosticsExport({
        db,
        userId: user.id,
        masterKey: "a".repeat(64),
        appVersion: "0.0.0-test",
        now: new Date("2026-05-20T00:00:00.000Z")
      });

      assert.equal(report.projectManager.goalCount, 1);
      assert.equal(report.projectManager.workItemCountsByStatus.in_progress, 1);
      assert.equal(report.projectManager.workItemCountsByStatus.todo, 0);
      assert.equal(report.projectManager.ledgerEventCount, 3);
      assert.equal(report.projectManager.latestEvent?.eventType, "work_item_status_changed");
      assert.equal(JSON.stringify(report).includes("diagnostics-pm-secret"), false);
      assert.equal(JSON.stringify(report).includes("Foreign hidden"), false);
    } finally {
      db.close();
    }
  });
});
