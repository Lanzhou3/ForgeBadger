import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { UserRepository } from "../packages/gateway/src/db/repositories/user-repository.js";
import {
  prepareFeishuPublicWebhook,
  resolvePrepareFeishuPublicWebhookConfig
} from "./prepare-feishu-public-webhook.ts";

const gatewayRequire = createRequire(new URL("../packages/gateway/package.json", import.meta.url));
const Database = gatewayRequire("better-sqlite3");
const { drizzle } = gatewayRequire("drizzle-orm/better-sqlite3");
const { migrate } = gatewayRequire("drizzle-orm/better-sqlite3/migrator");

describe("prepare Feishu public webhook", () => {
  it("stores public webhook config without returning raw webhook secrets", () => {
    const fixture = createFixtureDb();
    try {
      const config = resolvePrepareFeishuPublicWebhookConfig({
        FORGEBADGER_DB_PATH: fixture.dbPath,
        FORGEBADGER_MASTER_KEY: fixture.masterKey,
        FORGEBADGER_FEISHU_FORGEBADGER_USER_EMAIL: fixture.email,
        FORGEBADGER_FEISHU_PUBLIC_WEBHOOK_ID: "public-live-test",
        FORGEBADGER_FEISHU_PUBLIC_WEBHOOK_ENABLED: "1",
        FORGEBADGER_FEISHU_WEBHOOK_VERIFICATION_TOKEN: "verify-token-secret",
        FORGEBADGER_FEISHU_WEBHOOK_EVENT_ENCRYPT_KEY: "encrypt-key-secret",
        FORGEBADGER_FEISHU_ALLOWED_CHAT_IDS: "oc_allowed,oc_second",
        FORGEBADGER_FEISHU_USER_MAPPINGS_JSON: JSON.stringify([
          { feishuUserId: "ou_allowed", displayName: "Allowed User" }
        ])
      });
      assert.equal(config.ok, true);
      if (!config.ok) return;

      const result = prepareFeishuPublicWebhook(config);
      const output = JSON.stringify(result);

      assert.equal(result.ok, true);
      assert.equal(result.publicWebhookId, "public-live-test");
      assert.equal(result.callbackPath, "/api/v1/integrations/feishu/webhook/public-live-test");
      assert.equal(result.publicWebhookEnabled, true);
      assert.equal(result.integrationEnabled, true);
      assert.equal(result.identityMode, "bot");
      assert.equal(result.allowedChatIdCount, 2);
      assert.equal(result.mappingCount, 1);
      assert.equal(output.includes("verify-token-secret"), false);
      assert.equal(output.includes("encrypt-key-secret"), false);

      const db = new Database(fixture.dbPath);
      try {
        const row = db.prepare(`
          SELECT verification_token_encrypted, event_encrypt_key_encrypted
          FROM integration_feishu_configs
          WHERE public_webhook_id = ?
        `).get("public-live-test") as {
          verification_token_encrypted: string;
          event_encrypt_key_encrypted: string;
        };
        assert.equal(row.verification_token_encrypted.includes("verify-token-secret"), false);
        assert.equal(row.event_encrypt_key_encrypted.includes("encrypt-key-secret"), false);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed when required environment is missing", () => {
    const config = resolvePrepareFeishuPublicWebhookConfig({});

    assert.equal(config.ok, false);
    assert.match(config.reason, /FORGEBADGER_DB_PATH/);
  });

  it("uses only ForgeBadger variables", () => {
    const config = resolvePrepareFeishuPublicWebhookConfig({
      FORGEBADGER_DB_PATH: "/tmp/forgebadger.db",
      FORGEBADGER_MASTER_KEY: "current-master",
      FORGEBADGER_FEISHU_FORGEBADGER_USER_EMAIL: "current@example.com",
      FORGEBADGER_FEISHU_PUBLIC_WEBHOOK_ID: "current-webhook",
      FORGEBADGER_FEISHU_WEBHOOK_VERIFICATION_TOKEN: "current-verify",
      FORGEBADGER_FEISHU_WEBHOOK_EVENT_ENCRYPT_KEY: "current-encrypt"
    });

    assert.equal(config.ok, true);
    if (!config.ok) return;
    assert.equal(config.dbPath, "/tmp/forgebadger.db");
    assert.equal(config.masterKey, "current-master");
    assert.equal(config.forgebadgerUserEmail, "current@example.com");
    assert.equal(config.publicWebhookId, "current-webhook");
  });
});

function createFixtureDb(): {
  dbPath: string;
  masterKey: string;
  email: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "forgebadger-feishu-webhook-"));
  const dbPath = path.join(dir, "forgebadger.db");
  const db = new Database(dbPath);
  const migrationsFolder = path.join(workspaceRoot(), "packages/gateway/src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  const email = "feishu-webhook@example.com";
  new UserRepository(db).create(email, "hash");
  db.close();
  return {
    dbPath,
    masterKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    email,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

function workspaceRoot(): string {
  return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}
