import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { hashToken } from "../src/db/repositories/auth-session-repository.js";
import {
  MCP_TOKEN_PREFIX,
  McpTokenRepository,
  parseMcpTokenScopes
} from "../src/db/repositories/mcp-token-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("McpTokenRepository", () => {
  let db: Database;
  let users: UserRepository;
  let repo: McpTokenRepository;
  let userId: string;

  beforeEach(() => {
    db = createTestDb();
    users = new UserRepository(db);
    repo = new McpTokenRepository(db);
    userId = users.create("owner@example.com", "hash", { role: "admin" }).id;
  });

  it("returns the plaintext once and stores only its sha256 hash", () => {
    // Arrange / Act
    const { record, token } = repo.create({ userId, name: "ci", scopes: ["read"] });

    // Assert
    assert.ok(token.startsWith(MCP_TOKEN_PREFIX));
    assert.equal(record.tokenHash, hashToken(token));
    const row = db.prepare("SELECT token_hash FROM mcp_access_tokens WHERE id = ?").get(record.id) as { token_hash: string };
    assert.equal(row.token_hash, hashToken(token));
  });

  it("finds active tokens by plaintext and rejects them after revocation", () => {
    // Arrange
    const { record, token } = repo.create({ userId, name: "agent", scopes: ["read", "operate"] });

    // Act
    const found = repo.findActiveByToken(token);
    const revoked = repo.revokeByIdAndUser(record.id, userId);

    // Assert
    assert.equal(found?.id, record.id);
    assert.deepEqual(parseMcpTokenScopes(found!.scopes), ["read", "operate"]);
    assert.equal(revoked, true);
    assert.equal(repo.findActiveByToken(token), undefined);
  });

  it("rejects lookups for tokens without the mcp prefix or unknown hashes", () => {
    assert.equal(repo.findActiveByToken("opaque-session-token"), undefined);
    assert.equal(repo.findActiveByToken(`${MCP_TOKEN_PREFIX}deadbeef`), undefined);
  });

  it("scopes listing and revocation to the owning user", () => {
    // Arrange
    const other = users.create("other@example.com", "hash", { role: "user" });
    const { record } = repo.create({ userId, name: "mine", scopes: ["read"] });

    // Act / Assert
    assert.equal(repo.revokeByIdAndUser(record.id, other.id), false);
    assert.equal(repo.listByUser(other.id).length, 0);
    assert.equal(repo.listByUser(userId).length, 1);
  });

  it("records the last-used timestamp without affecting revocation state", () => {
    // Arrange
    const { record, token } = repo.create({ userId, name: "ci", scopes: ["read"] });
    assert.equal(record.lastUsedAt, null);

    // Act
    repo.touchLastUsed(record.id);

    // Assert
    const found = repo.findActiveByToken(token);
    assert.ok(found?.lastUsedAt instanceof Date);
    assert.equal(found?.revokedAt, null);
  });
});

describe("parseMcpTokenScopes", () => {
  it("parses stored scopes and falls back to read on malformed data", () => {
    assert.deepEqual(parseMcpTokenScopes('["read","operate"]'), ["read", "operate"]);
    assert.deepEqual(parseMcpTokenScopes("not-json"), ["read"]);
    assert.deepEqual(parseMcpTokenScopes('{"a":1}'), ["read"]);
    assert.deepEqual(parseMcpTokenScopes('["bogus"]'), []);
  });
});
