import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { McpTokenRepository } from "../src/db/repositories/mcp-token-repository.js";
import { hashToken } from "../src/db/repositories/auth-session-repository.js";

it("upgrades an on-disk legacy token database and preserves grants across reopen", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fb-mcp-migrate-"));
  const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  const oldMigrations = path.join(root, "old-migrations");
  mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(path.join(migrations, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
  // Simulate the pre-grants state: drop 0118 and everything after it, otherwise
  // drizzle sees a later entry (0119+) as applied and never replays 0118.
  const cut = journal.entries.findIndex(entry => entry.tag === "0118_mcp_project_grants");
  journal.entries = journal.entries.slice(0, cut);
  writeFileSync(path.join(oldMigrations, "meta/_journal.json"), JSON.stringify(journal));
  for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql"))) copyFileSync(path.join(migrations, file), path.join(oldMigrations, file));
  let db = new Database(path.join(root, "test.db"));
  try {
    migrate(drizzle(db), { migrationsFolder: oldMigrations });
    const user = new UserRepository(db).create("migration@example.test", "hash");
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const scopes = JSON.stringify(["read", "operate", "cli_dispatch"]);
    const legacyToken = "fbmcp_migration_fixture";
    db.prepare("INSERT INTO mcp_access_tokens (id,user_id,name,token_hash,scopes,allowed_root,expires_at) VALUES (?,?,?,?,?,?,?)")
      .run("legacy", user.id, "legacy", hashToken(legacyToken), scopes, root, expiry);
    migrate(drizzle(db), { migrationsFolder: migrations });
    const permanent = new McpTokenRepository(db).create({ userId: user.id, name: "permanent", scopes: ["read"], allowedProjects: [{ id: "fixture", root }] });
    db.close();
    db = new Database(path.join(root, "test.db"));
    migrate(drizzle(db), { migrationsFolder: migrations });
    const repo = new McpTokenRepository(db);
    const legacy = repo.findActiveByToken(legacyToken)!;
    assert.equal(legacy.allowedProjects, null);
    assert.equal(legacy.allowedRoot, root);
    assert.equal(legacy.scopes, scopes);
    assert.equal(legacy.expiresAt!.getTime(), expiry * 1000);
    const restored = repo.findActiveByToken(permanent.token)!;
    assert.equal(restored.expiresAt, null);
    assert.deepEqual(JSON.parse(restored.allowedProjects!), [{ id: "fixture", root }]);
    repo.revokeByIdAndUser(restored.id, user.id);
    assert.equal(repo.findActiveByToken(permanent.token), undefined);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
