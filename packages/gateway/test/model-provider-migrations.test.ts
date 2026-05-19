import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

describe("model provider migrations", () => {
  it("keeps valid provider adapters and resets empty or unsupported entries to Claude Code", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE model_provider_profiles (
        id text PRIMARY KEY NOT NULL,
        supported_adapters text DEFAULT '[]' NOT NULL
      );
      INSERT INTO model_provider_profiles (id, supported_adapters) VALUES
        ('claude-only', '["claude"]'),
        ('mixed', '["claude","opencode"]'),
        ('codex-only', '["codex"]'),
        ('empty', '[]');
    `);
    db.exec(readMigration("0016_model_provider_adapter_normalization.sql"));

    const rows = db.prepare(`
      SELECT id, supported_adapters AS supportedAdapters
      FROM model_provider_profiles
      ORDER BY id ASC
    `).all() as Array<{ id: string; supportedAdapters: string }>;

    assert.deepEqual(rows, [
      { id: "claude-only", supportedAdapters: '["claude"]' },
      { id: "codex-only", supportedAdapters: '["claude"]' },
      { id: "empty", supportedAdapters: '["claude"]' },
      { id: "mixed", supportedAdapters: '["claude","opencode"]' }
    ]);
  });
});

function readMigration(fileName: string): string {
  return readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations", fileName),
    "utf8"
  );
}
