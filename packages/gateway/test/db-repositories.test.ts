import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentRepository,
  ActivityRepository,
  ApiKeyRepository,
  ModelRepository,
  NotificationRepository,
  ProjectAgentSequenceRepository,
  ProjectRepository,
  SessionRepository,
  SkillRepository,
  TemplateRepository,
  UserRepository
} from "../src/db/repositories/index.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("db repositories", () => {
  let db: Database;
  let userRepo: UserRepository;

  beforeEach(() => {
    db = createTestDb();
    userRepo = new UserRepository(db);
  });

  describe("UserRepository", () => {
    it("creates and finds a user by email", () => {
      const created = userRepo.create("alice@example.com", "hash123");
      assert.equal(created.email, "alice@example.com");
      assert.equal(created.passwordHash, "hash123");

      const found = userRepo.findByEmail("alice@example.com");
      assert.ok(found);
      assert.equal(found!.email, "alice@example.com");
    });

    it("finds a user by id", () => {
      const created = userRepo.create("bob@example.com", "hash456");
      const found = userRepo.findById(created.id);
      assert.ok(found);
      assert.equal(found!.id, created.id);
    });

    it("returns undefined for non-existent user", () => {
      assert.equal(userRepo.findByEmail("nobody@example.com"), undefined);
      assert.equal(userRepo.findById("nonexistent"), undefined);
    });
  });

  describe("ProjectRepository", () => {
    it("creates and lists projects for a user", () => {
      const user = userRepo.create("proj-user@example.com", "hash");
      const repo = new ProjectRepository(db, user.id);

      const project = repo.create({
        name: "My Project",
        path: "/tmp/my-project",
        aiTool: "claude"
      });
      assert.equal(project.name, "My Project");
      assert.equal(project.userId, user.id);
      assert.equal(project.isImported, false);

      const list = repo.list();
      assert.equal(list.length, 1);
      assert.equal(list[0]!.name, "My Project");
    });

    it("imports a project with isImported=true", () => {
      const user = userRepo.create("import-user@example.com", "hash");
      const repo = new ProjectRepository(db, user.id);

      const project = repo.import({
        name: "Imported Project",
        path: "/tmp/imported",
        aiTool: "claude"
      });
      assert.equal(project.isImported, true);
    });

    it("enforces tenant isolation", () => {
      const userA = userRepo.create("a@example.com", "hash");
      const userB = userRepo.create("b@example.com", "hash");
      const repoA = new ProjectRepository(db, userA.id);
      const repoB = new ProjectRepository(db, userB.id);

      const project = repoA.create({ name: "A Project", path: "/tmp/a", aiTool: "claude" });
      assert.equal(repoA.list().length, 1);
      assert.equal(repoB.list().length, 0);
      assert.equal(repoB.getById(project.id), undefined);
    });

    it("deletes a project", () => {
      const user = userRepo.create("del-user@example.com", "hash");
      const repo = new ProjectRepository(db, user.id);
      const project = repo.create({ name: "To Delete", path: "/tmp/del", aiTool: "claude" });

      repo.delete(project.id);
      assert.equal(repo.getById(project.id), undefined);
      assert.equal(repo.list().length, 0);
    });
  });

  describe("NotificationRepository", () => {
    it("stores notification read state per user", () => {
      const userA = userRepo.create("notify-a@example.com", "hash");
      const userB = userRepo.create("notify-b@example.com", "hash");
      const repoA = new NotificationRepository(db, userA.id);
      const repoB = new NotificationRepository(db, userB.id);

      const notification = repoA.create({
        type: "session_created",
        titleKey: "notifications.sessionCreated",
        message: "Session A",
        href: "/sessions/session-a",
        sessionId: "session-a",
        payload: { session_id: "session-a" }
      });

      assert.equal(repoA.list().length, 1);
      assert.equal(repoA.unreadCount(), 1);
      assert.equal(repoB.list().length, 0);
      assert.equal(repoB.markRead(notification.id), undefined);

      const read = repoA.markRead(notification.id);
      assert.ok(read);
      assert.equal(read!.isRead, true);
      assert.equal(repoA.unreadCount(), 0);
    });

    it("marks and clears notifications only for the current tenant", () => {
      const userA = userRepo.create("notify-clear-a@example.com", "hash");
      const userB = userRepo.create("notify-clear-b@example.com", "hash");
      const repoA = new NotificationRepository(db, userA.id);
      const repoB = new NotificationRepository(db, userB.id);

      repoA.create({
        type: "session_created",
        titleKey: "notifications.sessionCreated",
        message: "Session A",
        href: "/sessions/a"
      });
      repoA.create({
        type: "session_deleted",
        titleKey: "notifications.sessionDeleted",
        message: "Session A",
        href: "/sessions/a"
      });
      repoB.create({
        type: "session_created",
        titleKey: "notifications.sessionCreated",
        message: "Session B",
        href: "/sessions/b"
      });

      assert.equal(repoA.markAllRead(), 2);
      assert.equal(repoA.unreadCount(), 0);
      assert.equal(repoB.unreadCount(), 1);
      assert.equal(repoA.clearAll(), 2);
      assert.equal(repoA.list().length, 0);
      assert.equal(repoB.list().length, 1);
    });
  });

  describe("ActivityRepository", () => {
    it("stores and filters session activities per user", () => {
      const userA = userRepo.create("activity-a@example.com", "hash");
      const userB = userRepo.create("activity-b@example.com", "hash");
      const project = new ProjectRepository(db, userA.id).create({
        name: "Activity Project",
        path: "/tmp/activity",
        aiTool: "claude"
      });
      const agentA = new AgentRepository(db, userA.id).create({
        projectId: project.id,
        name: "Agent A"
      });
      const agentB = new AgentRepository(db, userA.id).create({
        projectId: project.id,
        name: "Agent B"
      });
      const session = new SessionRepository(db, userA.id).create({
        projectId: project.id,
        name: "Activity Session",
        aiTool: "claude",
        workingDir: project.path,
        agentId: agentA.id
      });
      const otherSession = new SessionRepository(db, userA.id).create({
        projectId: project.id,
        name: "Other Activity Session",
        aiTool: "claude",
        workingDir: project.path,
        agentId: agentB.id
      });
      const repoA = new ActivityRepository(db, userA.id);
      const repoB = new ActivityRepository(db, userB.id);

      repoA.create({
        sessionId: session.id,
        projectId: project.id,
        type: "session_started",
        status: "success",
        message: "Session started",
        metadata: { tmux: "of-test" }
      });
      repoA.create({
        projectId: project.id,
        sessionId: otherSession.id,
        type: "config_write",
        status: "success",
        message: "Config written"
      });

      assert.equal(repoA.list({ sessionId: session.id }).length, 1);
      assert.equal(repoA.list({ projectId: project.id }).length, 2);
      assert.equal(repoA.list({ projectId: project.id, agentId: agentA.id }).length, 1);
      assert.equal(repoB.list({ projectId: project.id }).length, 0);
    });

    it("filters activities by type", () => {
      const userA = userRepo.create("activity-type-a@example.com", "hash");
      const userB = userRepo.create("activity-type-b@example.com", "hash");
      const repoA = new ActivityRepository(db, userA.id);
      const repoB = new ActivityRepository(db, userB.id);

      repoA.create({
        type: "codex_app_server_started",
        status: "info",
        message: "Codex app-server running"
      });
      repoA.create({
        type: "session_started",
        status: "success",
        message: "Session started"
      });
      repoB.create({
        type: "codex_app_server_started",
        status: "info",
        message: "Other user event"
      });

      const activities = repoA.list({ types: ["codex_app_server_started"] });

      assert.equal(activities.length, 1);
      assert.equal(activities[0].type, "codex_app_server_started");
      assert.equal(repoB.list({ types: ["codex_app_server_started"] }).length, 1);
    });
  });

  describe("SessionRepository", () => {
    it("creates and lists sessions", () => {
      const user = userRepo.create("session-user@example.com", "hash");
      const projectRepo = new ProjectRepository(db, user.id);
      const project = projectRepo.create({ name: "Session Project", path: "/tmp/sp", aiTool: "claude" });
      const repo = new SessionRepository(db, user.id);

      const session = repo.create({
        projectId: project.id,
        name: "Session 1",
        aiTool: "claude",
        workingDir: "/tmp/sp"
      });
      assert.equal(session.name, "Session 1");

      const list = repo.list();
      assert.equal(list.length, 1);
    });

    it("updates session status", () => {
      const user = userRepo.create("status-user@example.com", "hash");
      const projectRepo = new ProjectRepository(db, user.id);
      const project = projectRepo.create({ name: "Status Project", path: "/tmp/st", aiTool: "claude" });
      const repo = new SessionRepository(db, user.id);
      const session = repo.create({
        projectId: project.id,
        name: "Session",
        aiTool: "claude",
        workingDir: "/tmp/st"
      });

      const updated = repo.updateStatus(session.id, "running");
      assert.ok(updated);
      assert.equal(updated!.status, "running");
    });

    it("enforces tenant isolation for sessions", () => {
      const userA = userRepo.create("sa@example.com", "hash");
      const userB = userRepo.create("sb@example.com", "hash");
      const projectRepoA = new ProjectRepository(db, userA.id);
      const projectA = projectRepoA.create({ name: "PA", path: "/tmp/pa", aiTool: "claude" });
      const repoA = new SessionRepository(db, userA.id);
      const repoB = new SessionRepository(db, userB.id);

      const session = repoA.create({
        projectId: projectA.id,
        name: "S",
        aiTool: "claude",
        workingDir: "/tmp/pa"
      });
      assert.equal(repoB.getById(session.id), undefined);
    });

    it("lists sessions by project while preserving tenant isolation", () => {
      const userA = userRepo.create("session-project-a@example.com", "hash");
      const userB = userRepo.create("session-project-b@example.com", "hash");
      const projectRepoA = new ProjectRepository(db, userA.id);
      const projectA = projectRepoA.create({ name: "Project A", path: "/tmp/pa", aiTool: "claude" });
      const projectB = projectRepoA.create({ name: "Project B", path: "/tmp/pb", aiTool: "claude" });
      const projectForOtherUser = new ProjectRepository(db, userB.id).create({
        name: "Project Other",
        path: "/tmp/po",
        aiTool: "claude"
      });
      const repoA = new SessionRepository(db, userA.id);
      const repoB = new SessionRepository(db, userB.id);

      const sessionA = repoA.create({
        projectId: projectA.id,
        name: "S A",
        aiTool: "claude",
        workingDir: "/tmp/pa"
      });
      repoA.create({
        projectId: projectB.id,
        name: "S B",
        aiTool: "claude",
        workingDir: "/tmp/pb"
      });
      repoB.create({
        projectId: projectForOtherUser.id,
        name: "S Other",
        aiTool: "claude",
        workingDir: "/tmp/po"
      });

      assert.deepEqual(repoA.listByProject(projectA.id).map((session) => session.id), [sessionA.id]);
      assert.deepEqual(repoB.listByProject(projectA.id), []);
    });

    it("persists terminal attach and credential launch metadata", () => {
      const user = userRepo.create("session-meta@example.com", "hash");
      const projectRepo = new ProjectRepository(db, user.id);
      const project = projectRepo.create({ name: "Meta Project", path: "/tmp/meta", aiTool: "claude" });
      const apiKey = new ApiKeyRepository(
        db,
        user.id,
        "0123456789abcdef0123456789abcdef"
      ).create({
        provider: "anthropic",
        plaintextKey: "sk-session-secret"
      });
      const repo = new SessionRepository(db, user.id);

      const session = repo.create({
        projectId: project.id,
        name: "Session",
        aiTool: "claude",
        workingDir: "/tmp/meta",
        attachToken: "attach-secret",
        tmuxSession: "of-user-session",
        credentialMode: "stored_encrypted_key",
        apiKeyId: apiKey.id
      });

      assert.equal(session.attachToken, "attach-secret");
      assert.equal(session.tmuxSession, "of-user-session");
      assert.equal(session.credentialMode, "stored_encrypted_key");
      assert.equal(session.apiKeyId, apiKey.id);
      assert.equal(repo.getById(session.id)?.attachToken, "attach-secret");
    });
  });

  describe("TemplateRepository", () => {
    it("lists built-in templates for Claude Code, OpenCode, Codex, and Kimi Code", () => {
      const user = userRepo.create("tmpl-user@example.com", "hash");
      const repo = new TemplateRepository(db, user.id);

      const builtIns = repo.listBuiltIn();
      assert.deepEqual(
        builtIns.map((template) => template.id).sort(),
        ["builtin-claude-code", "builtin-codex", "builtin-kimi", "builtin-opencode"]
      );
      assert.ok(builtIns.some((t) => t.name === "Claude Code"));
      assert.ok(builtIns.some((t) => t.name === "OpenCode"));
      assert.ok(builtIns.some((t) => t.name === "Codex"));
      assert.ok(builtIns.some((t) => t.name === "Kimi Code"));

      const claude = repo.getBuiltInClaude();
      assert.equal(claude.name, "Claude Code");
      assert.equal(claude.version, "2.2.0");
    });

    it("returns built-in template with files", () => {
      const user = userRepo.create("tmpl2-user@example.com", "hash");
      const repo = new TemplateRepository(db, user.id);
      const claude = repo.getBuiltInClaude();
      const withFiles = repo.getById(claude.id);
      assert.ok(withFiles);
      assert.ok(withFiles!.files);
      assert.ok(withFiles!.files!.some((f) => f.filePath === "CLAUDE.md"));
      assert.equal(withFiles!.files!.some((f) => f.filePath === ".claude/CLAUDE.md"), false);
      assert.ok(withFiles!.files!.some((f) => f.filePath === ".claude/settings.json"));
      assert.ok(withFiles!.files!.some((f) => f.filePath === "WORKFLOW.md"));
      assert.ok(withFiles!.files!.some((f) => f.filePath === "PLAN.md"));
      assert.equal(withFiles!.files!.some((f) => f.filePath === "CHANGELOG.md"), false);
      assert.equal(withFiles!.files!.some((f) => f.filePath === "CONTRIBUTING.md"), false);
      assert.ok(withFiles!.files!.some((f) => f.filePath === ".claude/rules/security.md"));
      assert.ok(withFiles!.files!.some((f) => f.filePath === ".claude/rules/api.md"));
      assert.ok(withFiles!.files!.some((f) => f.filePath === ".claude/rules/backend.md"));
      assert.ok(withFiles!.files!.some((f) => f.filePath === ".claude/rules/frontend.md"));
      assert.ok(withFiles!.files!.some((f) => f.filePath === ".claude/rules/testing.md"));
      assert.ok(withFiles!.files!.some((f) => f.filePath === ".claude/hooks/openforge-guard.mjs"));
      assert.equal(withFiles!.files!.some((f) => f.filePath === ".claude/hooks/openforge-notification.mjs"), false);
      const claudeMd = withFiles!.files!.find((f) => f.filePath === "CLAUDE.md")?.content ?? "";
      assert.ok(claudeMd.split("\n").length <= 200);
      assert.match(claudeMd, /Common Commands/);
      assert.match(claudeMd, /Architecture/);
      assert.match(claudeMd, /Verification Contract/);
      assert.match(claudeMd, /Claude Code Hooks And Notifications/);
      assert.match(claudeMd, /Operating Pattern/);
      assert.match(claudeMd, /Permissions And Safety/);
      assert.match(claudeMd, /Repository Orientation/);
      assert.match(claudeMd, /Coding Standards/);
      assert.match(claudeMd, /Review And Handoff/);
      assert.match(claudeMd, /\/hooks/);
      assert.match(claudeMd, /code\.claude\.com\/docs\/en/);
      assert.match(claudeMd, /Security Boundaries/);
      assert.match(claudeMd, /When To Update This File/);
      assert.equal(claudeMd.includes("Auto Memory"), false);
      assert.equal(claudeMd.includes("Instruction Loading"), false);
      assert.equal(claudeMd.includes("What Belongs In This File"), false);
      assert.equal(claudeMd.includes("What To Move Elsewhere"), false);
      assert.equal(claudeMd.includes("CLAUDE.local.md"), false);
      assert.equal(claudeMd.includes("Context Management"), false);
      assert.equal(claudeMd.includes("Skills And Rules"), false);
      assert.equal(claudeMd.includes("AGENTS.md Compatibility"), false);
      const settings = JSON.parse(
        withFiles!.files!.find((f) => f.filePath === ".claude/settings.json")?.content ?? "{}"
      );
      assert.equal(settings.hooks.PermissionRequest[0].matcher, undefined);
      assert.equal(settings.hooks.PermissionRequest[0].hooks[0].type, "http");
      assert.match(settings.hooks.PermissionRequest[0].hooks[0].url, /\/api\/v1\/session-hooks\/claude-notification/);
      assert.equal(settings.hooks.PermissionRequest[0].hooks[0].headers["x-openforge-session-token"], "$OPENFORGE_ATTACH_TOKEN");
      assert.deepEqual(settings.hooks.PermissionRequest[0].hooks[0].allowedEnvVars, [
        "OPENFORGE_SESSION_ID",
        "OPENFORGE_ATTACH_TOKEN"
      ]);
      assert.equal(settings.hooks.PermissionDenied[0].hooks[0].type, "http");
      assert.equal(settings.hooks.Notification[0].matcher, "permission_prompt");
      assert.equal(settings.hooks.Notification[0].hooks[0].type, "http");
      assert.equal(settings.hooks.PreToolUse[0].matcher, "Bash");
      assert.equal(settings.hooks.PreToolUse[0].hooks[0].type, "command");
      assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /openforge-guard\.mjs/);

      const guard = withFiles!.files!.find((f) => f.filePath === ".claude/hooks/openforge-guard.mjs")?.content ?? "";
      assert.match(guard, /rm\\s\+-rf/);
      assert.match(guard, /process\.exit\(2\)/);
    });

    it("refreshes stale built-in Claude template files", () => {
      const user = userRepo.create("tmpl-refresh-user@example.com", "hash");
      db.prepare(
        "INSERT INTO templates (id, user_id, name, version, is_builtin, usage_count, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("builtin-claude-code", null, "Claude Code", "0.1.0", 1, 0, "active");
      db.prepare(
        "INSERT INTO template_files (template_id, file_path, content, file_type) VALUES (?, ?, ?, ?)"
      ).run("builtin-claude-code", ".claude/CLAUDE.md", "# Old", "markdown");
      db.prepare(
        "INSERT INTO template_files (template_id, file_path, content, file_type) VALUES (?, ?, ?, ?)"
      ).run("builtin-claude-code", ".claude/hooks/openforge-notification.mjs", "old hook", "javascript");

      const repo = new TemplateRepository(db, user.id);
      const refreshed = repo.getById("builtin-claude-code");
      const claudeMd = refreshed?.files?.find((file) => file.filePath === "CLAUDE.md")?.content ?? "";

      assert.equal(refreshed?.version, "2.2.0");
      assert.match(claudeMd, /Verification Contract/);
      assert.match(claudeMd, /Operating Pattern/);
      assert.equal(
        refreshed?.files?.some((file) => file.filePath === ".claude/hooks/openforge-notification.mjs"),
        false
      );
      assert.equal(
        refreshed?.files?.some((file) => file.filePath === ".claude/CLAUDE.md"),
        false
      );
    });

    it("returns the built-in Claude template by id before templates have been listed", () => {
      const user = userRepo.create("tmpl-direct-user@example.com", "hash");
      const repo = new TemplateRepository(db, user.id);

      const withFiles = repo.getById("builtin-claude-code");

      assert.ok(withFiles);
      assert.equal(withFiles!.name, "Claude Code");
      assert.ok(withFiles!.files);
      assert.ok(withFiles!.files!.some((file) => file.filePath === "CLAUDE.md"));
    });

    it("returns OpenCode and Codex built-in templates by id before templates have been listed", () => {
      const user = userRepo.create("tmpl-direct-adapter-user@example.com", "hash");
      const repo = new TemplateRepository(db, user.id);

      const opencode = repo.getById("builtin-opencode");
      const codex = repo.getById("builtin-codex");

      assert.equal(opencode?.name, "OpenCode");
      assert.ok(opencode?.files?.some((file) => file.filePath === "AGENTS.md"));
      assert.ok(opencode?.files?.some((file) => file.filePath === "opencode.json"));
      assert.ok(opencode?.files?.some((file) => file.filePath === ".opencode/agents/code-reviewer.md"));
      assert.equal(codex?.name, "Codex");
      assert.ok(codex?.files?.some((file) => file.filePath === "AGENTS.md"));
      assert.ok(codex?.files?.some((file) => file.filePath === ".codex/config.toml"));
      assert.ok(codex?.files?.some((file) => file.filePath === ".codex/agents/code-reviewer.md"));
    });

    it("does not read or update another user's template files", () => {
      const userA = userRepo.create("tmpl-owner@example.com", "hash");
      const userB = userRepo.create("tmpl-reader@example.com", "hash");
      db.prepare(
        "INSERT INTO templates (id, user_id, name, version, is_builtin, usage_count, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("template-user-a", userA.id, "Private Template", "1.0.0", 0, 0, "active");
      db.prepare(
        "INSERT INTO template_files (template_id, file_path, content, file_type) VALUES (?, ?, ?, ?)"
      ).run("template-user-a", ".claude/CLAUDE.md", "private", "markdown");

      const repoB = new TemplateRepository(db, userB.id);

      assert.equal(repoB.getById("template-user-a"), undefined);
      assert.equal(repoB.updateFile("template-user-a", ".claude/CLAUDE.md", "changed"), undefined);

      const stored = db.prepare("SELECT content FROM template_files WHERE template_id = ?").get("template-user-a") as { content: string };
      assert.equal(stored.content, "private");
    });

    it("does not allow built-in template file mutation", () => {
      const user = userRepo.create("tmpl-builtin-edit@example.com", "hash");
      const repo = new TemplateRepository(db, user.id);
      const builtin = repo.getBuiltInClaude();

      assert.equal(repo.updateFile(builtin.id, ".claude/CLAUDE.md", "changed"), undefined);
    });

    it("creates, updates, clones, upserts files, and deletes custom templates", () => {
      const user = userRepo.create("tmpl-custom@example.com", "hash");
      const repo = new TemplateRepository(db, user.id);
      const builtin = repo.getBuiltInClaude();

      const cloned = repo.clone(builtin.id, "Custom Claude");
      assert.equal(cloned.name, "Custom Claude");
      assert.equal(cloned.isBuiltin, false);
      assert.equal(cloned.userId, user.id);

      const clonedDetails = repo.getById(cloned.id);
      assert.ok(clonedDetails?.files?.some((file) => file.filePath === "CLAUDE.md"));

      const created = repo.create({
        name: "Scratch",
        description: "Custom template",
        files: [{ filePath: ".claude/CLAUDE.md", content: "# {{projectName}}", fileType: "markdown" }]
      });
      assert.equal(created.name, "Scratch");

      const updated = repo.update(created.id, { name: "Scratch v2" });
      assert.equal(updated?.name, "Scratch v2");

      const file = repo.upsertFile(created.id, ".claude/agents.md", "agent config", "markdown");
      assert.equal(file?.content, "agent config");
      const updatedFile = repo.upsertFile(created.id, ".claude/agents.md", "updated", "markdown");
      assert.equal(updatedFile?.content, "updated");

      assert.equal(repo.delete(created.id), true);
      assert.equal(repo.getById(created.id), undefined);
    });

    it("does not clone or delete another user's custom template", () => {
      const owner = userRepo.create("tmpl-owner-2@example.com", "hash");
      const other = userRepo.create("tmpl-other-2@example.com", "hash");
      const ownerRepo = new TemplateRepository(db, owner.id);
      const otherRepo = new TemplateRepository(db, other.id);
      const template = ownerRepo.create({
        name: "Private",
        files: [{ filePath: ".claude/CLAUDE.md", content: "private", fileType: "markdown" }]
      });

      assert.throws(() => otherRepo.clone(template.id, "Leaked"), /Template not found/i);
      assert.equal(otherRepo.delete(template.id), false);
      assert.ok(ownerRepo.getById(template.id));
    });

    it("exports and imports template packages", () => {
      const user = userRepo.create("tmpl-package@example.com", "hash");
      const repo = new TemplateRepository(db, user.id);
      const template = repo.create({
        name: "Portable",
        description: "Exportable",
        version: "1.2.3",
        files: [{ filePath: ".claude/CLAUDE.md", content: "# Portable", fileType: "markdown" }]
      });

      const exported = repo.exportPackage(template.id);
      assert.equal(exported.name, "Portable");
      assert.equal(exported.files[0]!.filePath, ".claude/CLAUDE.md");

      const imported = repo.importPackage({ ...exported, name: "Imported Portable" });
      assert.equal(imported.name, "Imported Portable");
      assert.equal(repo.getById(imported.id)?.files?.[0]?.content, "# Portable");
    });

    it("records version snapshots for template updates", () => {
      const user = userRepo.create("tmpl-history@example.com", "hash");
      const repo = new TemplateRepository(db, user.id);
      const template = repo.create({
        name: "History",
        files: [{ filePath: ".claude/CLAUDE.md", content: "v1", fileType: "markdown" }]
      });

      repo.update(template.id, { name: "History v2", version: "2.0.0" });
      repo.updateFile(template.id, ".claude/CLAUDE.md", "v2");

      const versions = repo.listVersions(template.id);
      assert.equal(versions.length, 2);
      assert.equal(versions[0]!.version, "2.0.0");
      assert.equal(versions[1]!.version, "1.0.0");
      assert.equal(versions[1]!.files[0]!.content, "v1");
    });

    it("restores a custom template from a version snapshot", () => {
      const user = userRepo.create("tmpl-restore@example.com", "hash");
      const repo = new TemplateRepository(db, user.id);
      const template = repo.create({
        name: "Restore",
        files: [
          { filePath: ".claude/CLAUDE.md", content: "v1", fileType: "markdown" },
          { filePath: ".claude/rules/security.md", content: "secure-v1", fileType: "markdown" }
        ]
      });

      repo.update(template.id, { name: "Restore v2", description: "changed", version: "2.0.0" });
      repo.updateFile(template.id, ".claude/CLAUDE.md", "v2");
      const snapshot = repo.listVersions(template.id).find((version) => version.version === "1.0.0");

      const restored = repo.restoreVersion(template.id, snapshot!.id);

      assert.equal(restored?.name, "Restore");
      assert.equal(restored?.version, "1.0.0");
      assert.equal(restored?.description, null);
      assert.equal(restored?.files?.find((file) => file.filePath === ".claude/CLAUDE.md")?.content, "v1");
      assert.equal(
        restored?.files?.find((file) => file.filePath === ".claude/rules/security.md")?.content,
        "secure-v1"
      );
      assert.ok(repo.listVersions(template.id).some((version) => version.action === "template.restore"));
    });
  });

  describe("ModelRepository", () => {
    it("creates and lists models", () => {
      const user = userRepo.create("model-user@example.com", "hash");
      const repo = new ModelRepository(db, user.id);

      const model = repo.create({ name: "Claude Sonnet", provider: "anthropic", modelId: "claude-sonnet" });
      assert.equal(model.name, "Claude Sonnet");
      assert.equal(repo.list().length, 1);
    });

    it("sets default model", () => {
      const user = userRepo.create("def-user@example.com", "hash");
      const repo = new ModelRepository(db, user.id);
      const m1 = repo.create({ name: "M1", provider: "p", modelId: "m1" });
      const m2 = repo.create({ name: "M2", provider: "p", modelId: "m2" });

      assert.ok(repo.setDefault(m1.id));
      assert.ok(repo.setDefault(m2.id));

      const updatedM1 = repo.getById(m1.id);
      const updatedM2 = repo.getById(m2.id);
      assert.equal(updatedM1!.isDefault, false);
      assert.equal(updatedM2!.isDefault, true);
    });

    it("sets default for provider-backed models without legacy rows", () => {
      const user = userRepo.create("provider-default@example.com", "hash");
      const providerRepo = new ModelProviderRepository(db, user.id, "0123456789abcdef0123456789abcdef");
      const provider = providerRepo.createProviderProfile({
        name: "DeepSeek",
        providerKey: "deepseek",
        baseUrl: "https://api.deepseek.com",
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["opencode"]
      });
      const model = providerRepo.createModelProfile({
        providerProfileId: provider.id,
        name: "DeepSeek Chat",
        modelId: "deepseek-chat",
        mirrorLegacy: false
      });
      const repo = new ModelRepository(db, user.id);

      const updated = repo.setDefault(model.id);

      assert.ok(updated);
      assert.equal(updated.id, model.id);
      assert.equal(updated.isDefault, true);
    });

    it("enforces tenant isolation for models", () => {
      const userA = userRepo.create("ma@example.com", "hash");
      const userB = userRepo.create("mb@example.com", "hash");
      const repoA = new ModelRepository(db, userA.id);
      const repoB = new ModelRepository(db, userB.id);

      const model = repoA.create({ name: "MA", provider: "p", modelId: "m" });
      assert.equal(repoB.getById(model.id), undefined);
    });
  });

  describe("ApiKeyRepository", () => {
    it("creates and lists api keys without decrypted values", () => {
      const user = userRepo.create("key-user@example.com", "hash");
      const repo = new ApiKeyRepository(db, user.id, "0123456789abcdef0123456789abcdef");

      const key = repo.create({ provider: "anthropic", plaintextKey: "sk-secret" });
      assert.equal(key.provider, "anthropic");
      assert.ok(key.keyEncrypted);

      const list = repo.list();
      assert.equal(list.length, 1);
      const summary = list[0]!;
      assert.equal(summary.provider, "anthropic");
      assert.ok(!(summary as Record<string, unknown>).keyEncrypted);
    });

    it("enforces tenant isolation for api keys", () => {
      const userA = userRepo.create("ka@example.com", "hash");
      const userB = userRepo.create("kb@example.com", "hash");
      const repoA = new ApiKeyRepository(db, userA.id, "0123456789abcdef0123456789abcdef");
      const repoB = new ApiKeyRepository(db, userB.id, "0123456789abcdef0123456789abcdef");

      repoA.create({ provider: "anthropic", plaintextKey: "secret" });
      assert.equal(repoA.list().length, 1);
      assert.equal(repoB.list().length, 0);
    });

    it("decrypts and deletes keys only for the owning user", () => {
      const userA = userRepo.create("kd-a@example.com", "hash");
      const userB = userRepo.create("kd-b@example.com", "hash");
      const repoA = new ApiKeyRepository(db, userA.id, "0123456789abcdef0123456789abcdef");
      const repoB = new ApiKeyRepository(db, userB.id, "0123456789abcdef0123456789abcdef");

      const key = repoA.create({ provider: "anthropic", plaintextKey: "test-api-key-secret", label: "Claude" });

      assert.equal(repoA.decryptForLaunch(key.id), "test-api-key-secret");
      assert.throws(() => repoB.decryptForLaunch(key.id), /not found/i);
      assert.equal(repoB.delete(key.id), false);
      assert.equal(repoA.delete(key.id), true);
      assert.equal(repoA.list().length, 0);
    });

    it("rotates encrypted material without exposing plaintext", () => {
      const user = userRepo.create("rotate-repo@example.com", "hash");
      const repo = new ApiKeyRepository(db, user.id, "0123456789abcdef0123456789abcdef");
      const key = repo.create({
        provider: "anthropic",
        plaintextKey: "test-api-key-old",
        label: "Claude"
      });
      const before = repo.getById(key.id);

      const rotated = repo.rotate(key.id, "test-api-key-new");

      assert.ok(rotated);
      assert.equal(rotated!.id, key.id);
      assert.equal(rotated!.provider, "anthropic");
      assert.equal(rotated!.label, "Claude");
      assert.notEqual(repo.getById(key.id)!.keyEncrypted, before!.keyEncrypted);
      assert.equal(repo.decryptForLaunch(key.id), "test-api-key-new");
      assert.equal(JSON.stringify(repo.list()).includes("test-api-key-new"), false);
    });
  });

  describe("AgentRepository", () => {
    it("creates and lists agents", () => {
      const user = userRepo.create("agent-user@example.com", "hash");
      const repo = new AgentRepository(db, user.id);

      const agent = repo.create({ name: "Coder" });
      assert.equal(agent.name, "Coder");
      assert.equal(repo.list().length, 1);
    });

    it("updates an agent", () => {
      const user = userRepo.create("upd-agent@example.com", "hash");
      const repo = new AgentRepository(db, user.id);
      const agent = repo.create({ name: "Old Name" });

      const updated = repo.update(agent.id, { name: "New Name" });
      assert.ok(updated);
      assert.equal(updated!.name, "New Name");
    });

    it("enforces tenant isolation for agents", () => {
      const userA = userRepo.create("aa@example.com", "hash");
      const userB = userRepo.create("ab@example.com", "hash");
      const repoA = new AgentRepository(db, userA.id);
      const repoB = new AgentRepository(db, userB.id);

      const agent = repoA.create({ name: "A-Agent" });
      assert.equal(repoB.getById(agent.id), undefined);
    });

    it("rejects project and model references from another user", () => {
      const userA = userRepo.create("agent-owner@example.com", "hash");
      const userB = userRepo.create("agent-other@example.com", "hash");
      const projectA = new ProjectRepository(db, userA.id).create({
        name: "A Project",
        path: "/tmp/agent-a",
        aiTool: "claude"
      });
      const modelA = new ModelRepository(db, userA.id).create({
        name: "A Model",
        provider: "anthropic",
        modelId: "claude"
      });
      const repoB = new AgentRepository(db, userB.id);

      assert.throws(() => repoB.create({ name: "Cross Project", projectId: projectA.id }), /Project not found/i);
      assert.throws(() => repoB.create({ name: "Cross Model", modelId: modelA.id }), /Model not found/i);
    });
  });

  describe("ProjectAgentSequenceRepository", () => {
    it("stores ordered project Agents for the current user", () => {
      const user = userRepo.create("agent-sequence@example.com", "hash");
      const project = new ProjectRepository(db, user.id).create({
        name: "Sequence Project",
        path: "/tmp/agent-sequence",
        aiTool: "claude"
      });
      const agentRepo = new AgentRepository(db, user.id);
      const first = agentRepo.create({ name: "First", projectId: project.id });
      const second = agentRepo.create({ name: "Second", projectId: project.id });
      const sequenceRepo = new ProjectAgentSequenceRepository(db, user.id);

      const sequence = sequenceRepo.replace(project.id, [second.id, first.id]);

      assert.deepEqual(sequence.map((item) => [item.agentId, item.position]), [
        [second.id, 0],
        [first.id, 1]
      ]);
      assert.deepEqual(sequenceRepo.list(project.id).map((item) => item.name), ["Second", "First"]);
    });

    it("rejects another user's project or Agents", () => {
      const userA = userRepo.create("agent-sequence-a@example.com", "hash");
      const userB = userRepo.create("agent-sequence-b@example.com", "hash");
      const projectA = new ProjectRepository(db, userA.id).create({
        name: "A Project",
        path: "/tmp/agent-sequence-a",
        aiTool: "claude"
      });
      const agentA = new AgentRepository(db, userA.id).create({
        name: "A Agent",
        projectId: projectA.id
      });
      const sequenceRepoB = new ProjectAgentSequenceRepository(db, userB.id);

      assert.throws(() => sequenceRepoB.replace(projectA.id, [agentA.id]), /Project not found/i);
      assert.deepEqual(sequenceRepoB.list(projectA.id), []);
    });
  });

  describe("SkillRepository", () => {
    it("creates and lists skills", () => {
      const user = userRepo.create("skill-user@example.com", "hash");
      const repo = new SkillRepository(db, user.id);

      const skill = repo.create({ name: "refactor", content: "# Refactor skill" });
      assert.equal(skill.name, "refactor");
      assert.equal(repo.list().length, 1);
    });

    it("toggles skill enabled state", () => {
      const user = userRepo.create("toggle-user@example.com", "hash");
      const repo = new SkillRepository(db, user.id);
      const skill = repo.create({ name: "toggle-me", content: "# Toggle" });
      assert.equal(skill.isEnabled, true);

      const disabled = repo.toggle(skill.id, false);
      assert.ok(disabled);
      assert.equal(disabled!.isEnabled, false);
    });

    it("enforces tenant isolation for skills", () => {
      const userA = userRepo.create("sa2@example.com", "hash");
      const userB = userRepo.create("sb2@example.com", "hash");
      const repoA = new SkillRepository(db, userA.id);
      const repoB = new SkillRepository(db, userB.id);

      const skill = repoA.create({ name: "isolate", content: "# Isolate" });
      assert.equal(repoB.getById(skill.id), undefined);
    });

    it("rejects duplicate skill names for same user", () => {
      const user = userRepo.create("uniq-user@example.com", "hash");
      const repo = new SkillRepository(db, user.id);
      repo.create({ name: "unique-skill", content: "# First" });

      assert.throws(() => {
        repo.create({ name: "unique-skill", content: "# Second" });
      }, /UNIQUE constraint failed/);
    });
  });
});
