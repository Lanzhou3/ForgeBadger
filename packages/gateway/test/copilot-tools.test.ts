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
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
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
      supportedAdapters: ["claude"]
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
    const sessionDetail = definitions.find((tool) => tool.name === "openforge.get_session_detail");
    const proposeSessionCreate = definitions.find((tool) => tool.name === "openforge.propose_session_create");
    const memorySearch = definitions.find((tool) => tool.name === "openforge.memory_search");

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
    assert.deepEqual(sessionDetail?.inputSchema, {
      type: "object",
      properties: {
        sessionId: { type: "string", minLength: 1 }
      },
      required: ["sessionId"],
      additionalProperties: false
    });
    assert.deepEqual(proposeSessionCreate?.inputSchema, {
      type: "object",
      properties: {
        projectId: { type: "string", minLength: 1 },
        aiTool: { type: "string", enum: ["claude", "opencode", "codex"] },
        name: { type: "string", minLength: 1 }
      },
      required: ["projectId", "aiTool"],
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

  function context(id: string, runId?: string) {
    return { db, userId: id, masterKey, ...(runId ? { runId } : {}) };
  }
});
