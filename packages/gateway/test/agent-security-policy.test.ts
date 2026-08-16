import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homedir } from "node:os";
import { createSecurityPolicy, logSecurityDecision } from "../src/services/agent/security-policy.js";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const home = "/Users/alice";

function setupDb(): Database {
  const db = new Database(":memory:");
  const migDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migDir, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) db.exec(t);
    }
  }
  db.prepare("INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)")
    .run("u1", "u1", "u1@x.co", "hash", "user", "active");
  return db;
}

describe("security policy", () => {
  const policy = createSecurityPolicy({ homeDir: home });

  it("auto-approves read tools", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "list_projects",
      toolRisk: "read",
      requiresApproval: false,
      input: {}
    });
    assert.equal(decision.action, "auto_approve");
    assert.equal(decision.riskClass, "low");
  });

  it("requires approval for generic operate tools", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "delete_everything",
      toolRisk: "operate",
      requiresApproval: true,
      input: {}
    });
    assert.equal(decision.action, "require_approval");
  });

  it("auto-approves create_project under home directory", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: `${home}/Projects/my-app` }
    });
    assert.equal(decision.action, "auto_approve");
    assert.equal(decision.riskClass, "low");
  });

  it("auto-approves create_project with tilde expansion", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: "~/Projects/my-app" }
    });
    assert.equal(decision.action, "auto_approve");
  });

  it("requires approval when create_project path is outside home", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: "/opt/projects/my-app" }
    });
    assert.equal(decision.action, "require_approval");
    assert.equal(decision.riskClass, "high");
  });

  it("denies create_project under denied roots", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: "/etc/my-app" }
    });
    assert.equal(decision.action, "deny");
    assert.equal(decision.riskClass, "high");
  });

  it("denies traversal in create_project path", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: `${home}/Projects/../etc` }
    });
    assert.equal(decision.action, "deny");
  });

  it("requires approval for relative create_project path", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: "Projects/my-app" }
    });
    assert.equal(decision.action, "require_approval");
  });

  it("always requires approval for advance_work_item", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "advance_work_item",
      toolRisk: "operate",
      requiresApproval: true,
      input: { workItemId: "wi-1", toState: "done", idempotencyKey: "k1" }
    });
    assert.equal(decision.action, "require_approval");
    assert.equal(decision.riskClass, "high");
  });

  it("denies inputs containing traversal", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "write_memory",
      toolRisk: "read",
      requiresApproval: false,
      input: { text: "note", scope: "project", projectId: "../etc" }
    });
    assert.equal(decision.action, "deny");
  });
});

describe("security policy audit log", () => {
  it("writes a copilot_operation_log row", () => {
    const db = setupDb();
    logSecurityDecision({
      db,
      userId: "u1",
      operation: "create_project",
      input: { path: "~/x" },
      action: "auto_approve",
      reason: "within home"
    });
    const rows = db.prepare("SELECT * FROM copilot_operation_log WHERE user_id = ?").all("u1") as unknown[];
    assert.equal(rows.length, 1);
  });
});
