import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import path from "node:path";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createUsageTools } from "../src/services/agent/tools/usage.js";
import { TokenUsageRepository } from "../src/db/repositories/token-usage-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

const fixtureRoots: string[] = [];
function projectFixture(db: Database, userId: string): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-agent-usage-")));
  fixtureRoots.push(root);
  new ProjectRepository(db, userId).create({ name: "Fixture", path: root, aiTool: "claude" });
  return root;
}
afterEach(() => { while (fixtureRoots.length) rmSync(fixtureRoots.pop()!, { recursive: true, force: true }); });

function createTestDb(): Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("get_usage_summary tool", () => {
  it("is a read tool that needs no approval", () => {
    const [tool] = createUsageTools();
    assert.equal(tool.name, "get_usage_summary");
    assert.equal(tool.risk, "read");
    assert.equal(tool.requiresApproval, false);
  });

  it("returns session and token aggregates for the user", async () => {
    // Arrange
    const db = createTestDb();
    const userId = new UserRepository(db).create("usage-1@example.com", "hash").id;
    const projectA = projectFixture(db, userId);
    const projectB = projectFixture(db, userId);
    new TokenUsageRepository(db, userId).upsertRecords([
      {
        adapter: "claude",
        sessionId: "s1",
        projectPath: projectA,
        modelId: "claude-sonnet",
        requestId: "req-1",
        occurredAt: new Date(Date.now() - 60_000),
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 10,
        sourceFile: "f1"
      },
      {
        adapter: "codex",
        sessionId: "s2",
        projectPath: projectB,
        modelId: "gpt-x",
        requestId: "req-2",
        occurredAt: new Date(Date.now() - 30_000),
        inputTokens: 200,
        outputTokens: 20,
        cacheReadTokens: 40,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        sourceFile: "f2"
      }
    ]);
    const context = { userId, db };
    const [tool] = createUsageTools();

    // Act
    const result = await tool.execute({}, context);

    // Assert
    const payload = result as {
      sessionUsage: { totalSessions: number };
      tokenUsage: { totalTokens: number; byAdapter: Array<{ key: string; totalTokens: number }> };
    };
    assert.equal(payload.sessionUsage.totalSessions, 0);
    assert.equal(payload.tokenUsage.totalTokens, 420);
    assert.ok(payload.tokenUsage.byAdapter.some((bucket) => bucket.key === "claude" && bucket.totalTokens === 160));
  });

  it("limits the token statistics to the requested trailing window", async () => {
    // Arrange
    const db = createTestDb();
    const userId = new UserRepository(db).create("usage-2@example.com", "hash").id;
    const projectA = projectFixture(db, userId);
    const tokenRepo = new TokenUsageRepository(db, userId);
    const daySeconds = 24 * 60 * 60;
    const nowSeconds = Math.floor(Date.now() / 1000);
    tokenRepo.upsertRecords([
      {
        adapter: "claude",
        sessionId: "s-old",
        projectPath: projectA,
        modelId: null,
        requestId: "old",
        occurredAt: new Date(nowSeconds * 1000 - daySeconds * 40 * 1000),
        inputTokens: 900,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        sourceFile: "old-file"
      },
      {
        adapter: "claude",
        sessionId: "s-new",
        projectPath: projectA,
        modelId: null,
        requestId: "new",
        occurredAt: new Date(nowSeconds * 1000 - 60_000),
        inputTokens: 30,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        sourceFile: "new-file"
      }
    ]);
    const context = { userId, db };
    const [tool] = createUsageTools();

    // Act
    const result = await tool.execute({ days: 7 }, context);

    // Assert: only the fresh record falls inside the 7-day token window.
    const payload = result as { tokenWindowDays: number; tokenUsage: { totalTokens: number } };
    assert.equal(payload.tokenWindowDays, 7);
    assert.equal(payload.tokenUsage.totalTokens, 30);
  });

  it("rejects out-of-range days values", async () => {
    const db = createTestDb();
    const context = { userId: "u", db };
    const [tool] = createUsageTools();

    await assert.rejects(() => tool.execute({ days: 0 }, context));
    await assert.rejects(() => tool.execute({ days: 400 }, context));
  });
});
