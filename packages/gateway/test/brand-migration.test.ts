import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

describe("ForgeBadger brand migration", () => {
  it("renames the identity column and only changes the exact legacy command default", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (id text PRIMARY KEY);
      CREATE TABLE integration_feishu_configs (
        user_id text PRIMARY KEY,
        command_prefix text NOT NULL DEFAULT '/openforge'
      );
      CREATE TABLE integration_feishu_user_mappings (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        feishu_user_id text NOT NULL,
        openforge_user_id text NOT NULL
      );
      CREATE INDEX idx_integration_feishu_user_mappings_openforge_user
      ON integration_feishu_user_mappings (user_id, openforge_user_id);
      INSERT INTO integration_feishu_configs VALUES ('legacy', '/openforge');
      INSERT INTO integration_feishu_configs VALUES ('custom', '/operations');
      INSERT INTO integration_feishu_user_mappings VALUES ('m1', 'owner', 'feishu', 'mapped-user');
    `);

    const migrationPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/db/migrations/0052_rename_forgebadger_contracts.sql"
    );
    db.exec(readFileSync(migrationPath, "utf8"));

    const columns = db.prepare("PRAGMA table_info(integration_feishu_user_mappings)").all() as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === "forgebadger_user_id"), true);
    assert.equal(columns.some((column) => column.name === "openforge_user_id"), false);
    assert.deepEqual(
      db.prepare("SELECT user_id, command_prefix FROM integration_feishu_configs ORDER BY user_id").all(),
      [
        { user_id: "custom", command_prefix: "/operations" },
        { user_id: "legacy", command_prefix: "/forgebadger" }
      ]
    );
    assert.equal(
      db.prepare("SELECT forgebadger_user_id FROM integration_feishu_user_mappings").pluck().get(),
      "mapped-user"
    );
    db.close();
  });
});
