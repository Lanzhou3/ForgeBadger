import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { FeishuCopilotChannelRepository } from "../src/db/repositories/feishu-copilot-channel-repository.js";
import { FeishuIntegrationRepository } from "../src/db/repositories/feishu-integration-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createGatewayApp, type GatewayAppOptions } from "../src/server.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { OpenForgeEventBus } from "../src/services/event-bus.js";
import { FeishuChannelRuntime } from "../src/services/integrations/feishu-channel-runtime.js";
import { createFeishuSdkHandlers } from "../src/services/integrations/feishu-runtime-factory.js";
import type { FeishuSdkFactory } from "../src/services/integrations/feishu-sdk.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const bridgeToken = "feishu-route-dsh-bridge-token-0123456789abcdef";
const webhookId = "feishu-route-dsh";
const verificationToken = "feishu-route-verification-token";
const eventEncryptKey = "feishu-route-event-encrypt-key";
const fakeLauncher = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "helpers",
  "fake-dsh-runtime.mjs"
);

describe("Feishu production route composition", () => {
  it("resumes a long-connection DSH approval through the same BFF from a signed classic webhook", async () => {
    const db = createTestDb();
    const stateDir = mkdtempSync(path.join(tmpdir(), "openforge-feishu-route-dsh-"));
    const logPath = path.join(stateDir, "fake-runtime.jsonl");
    const runtime = createIdleFeishuRuntime();
    const sdkCalls = { create: [] as unknown[], patch: [] as unknown[] };
    const sdkFactory = createFakeSdkFactory(sdkCalls);
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      eventBus: new OpenForgeEventBus(),
      sessionManager: new InMemorySessionManager(createEchoingTmux() as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      feishuChannelRuntime: runtime,
      dshCopilot: {
        launcherPath: fakeLauncher,
        gatewayUrl: "http://127.0.0.1:1",
        bridgeToken,
        stateDir,
        idleMs: 60_000,
        extraEnv: { DSH_FAKE_SCENARIO: "operate", DSH_FAKE_LOG: logPath }
      },
      feishuWebhookSdkFactory: sdkFactory
    } as GatewayAppOptions & { feishuWebhookSdkFactory: FeishuSdkFactory });

    try {
      const userId = seedUserAndFeishu(db);
      const handlers = createFeishuSdkHandlers({
        db,
        masterKey,
        userId,
        resolveAgentDeps: () => runtime.getAgentDeps(),
        buildAgentStack: (await import("../src/services/agent/agent-stack.js")).buildAgentStack,
        sdkFactory
      });
      const baseUrl = await listen(app.server);

      handlers.onMessage({
        header: { event_id: "ev-long-create-pending", event_type: "im.message.receive_v1" },
        event: {
          message: {
            message_id: "om-long-create-pending",
            chat_id: "oc-shared-dsh",
            chat_type: "p2p",
            message_type: "text",
            content: JSON.stringify({ text: "把任务下发给会话" })
          },
          sender: { sender_id: { open_id: "ou-owner" } }
        }
      }, { botOpenId: "ou-bot" });

      const pending = await waitForPending(db, userId);
      const body = JSON.stringify({
        token: verificationToken,
        header: { event_id: "ev-webhook-approve-classic" },
        event: {
          open_id: "ou-owner",
          open_chat_id: "oc-shared-dsh",
          open_message_id: "om-approval-card",
          action: {
            value: {
              copilot_decision: "approve",
              conversation_id: pending.conversationId,
              run_id: pending.runId,
              action_id: pending.actionId
            }
          }
        }
      });
      const response = await postSignedWebhook(baseUrl, body, "nonce-classic");
      const responseBody = await response.json() as { card?: { type?: string }; msg?: string };

      assert.equal(response.status, 200, JSON.stringify(responseBody));
      assert.equal(responseBody.card?.type, "raw");
      await waitFor(() => readFakeLog(logPath)
        .filter((record) => record.kind === "approval-response").length === 1);
      await waitFor(() => runStatus(db, pending.runId) === "completed");
      assert.equal(
        readFakeLog(logPath).find((record) => record.kind === "approval-response")?.outcome,
        "allowed-once"
      );
      assert.equal(readFakeLog(logPath).filter((record) => record.kind === "approval").length, 1);
      assert.equal(pendingStatus(db, pending.actionId), "approved");
      assert.equal(sdkCalls.patch.some((call) =>
        (call as { path?: { message_id?: string } }).path?.message_id === "om-approval-card"
      ), true, "the original classic approval card is patched");

      const replay = await postSignedWebhook(baseUrl, body, "nonce-classic-replay");
      assert.deepEqual(await replay.json(), { msg: "replayed" });
      assert.equal(readFakeLog(logPath).filter((record) => record.kind === "approval-response").length, 1);
    } finally {
      await app.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("normalizes a signed modern card callback and patches its context message", async () => {
    const db = createTestDb();
    const sdkCalls = { create: [] as unknown[], patch: [] as unknown[] };
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      eventBus: new OpenForgeEventBus(),
      sessionManager: new InMemorySessionManager(createEchoingTmux() as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      feishuWebhookSdkFactory: createFakeSdkFactory(sdkCalls)
    });

    try {
      const userId = seedUserAndFeishu(db);
      const pending = seedPendingApproval(db, userId, "oc-modern-callback", "ou-owner");
      const baseUrl = await listen(app.server);
      const body = JSON.stringify({
        token: verificationToken,
        header: { event_id: "ev-webhook-reject-modern" },
        event: {
          operator: { open_id: "ou-owner" },
          context: {
            open_chat_id: "oc-modern-callback",
            open_message_id: "om-modern-approval-card"
          },
          action: {
            value: {
              copilot_decision: "reject",
              conversation_id: pending.conversationId,
              run_id: pending.runId,
              action_id: pending.actionId
            }
          }
        }
      });

      const response = await postSignedWebhook(baseUrl, body, "nonce-modern");
      const responseBody = await response.json() as { card?: { type?: string }; msg?: string };

      assert.equal(response.status, 200, JSON.stringify(responseBody));
      assert.equal(responseBody.card?.type, "raw");
      await waitFor(() => pendingStatus(db, pending.actionId) === "rejected");
      await waitFor(() => sdkCalls.patch.some((call) =>
        (call as { path?: { message_id?: string } }).path?.message_id === "om-modern-approval-card"
      ));
      assert.deepEqual(listRateScopes(db), [
        `chat:oc-modern-callback`,
        `integration:${webhookId}`,
        `user:${userId}`
      ]);
    } finally {
      await app.close();
    }
  });

  it("keeps signed public-webhook group messages fail-closed without an exact bot mention", async () => {
    const db = createTestDb();
    const sdkCalls = { create: [] as unknown[], patch: [] as unknown[] };
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      eventBus: new OpenForgeEventBus(),
      sessionManager: new InMemorySessionManager(createEchoingTmux() as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      feishuWebhookSdkFactory: createFakeSdkFactory(sdkCalls)
    });

    try {
      const userId = seedUserAndFeishu(db);
      const baseUrl = await listen(app.server);
      const body = JSON.stringify({
        token: verificationToken,
        header: { event_id: "ev-webhook-group-no-proven-mention" },
        event: {
          sender: { sender_id: { open_id: "ou-group-member" } },
          message: {
            message_id: "om-webhook-group",
            chat_id: "oc-webhook-group",
            chat_type: "group",
            message_type: "text",
            content: JSON.stringify({ text: "@机器人 帮我检查项目" })
          }
        }
      });

      const response = await postSignedWebhook(baseUrl, body, "nonce-group");
      const responseBody = await response.json() as { msg?: string };
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(response.status, 200, JSON.stringify(responseBody));
      assert.equal(responseBody.msg, "ok");
      assert.equal(feishuConversationId(db, userId, "oc-webhook-group"), undefined);
      assert.deepEqual(sdkCalls, { create: [], patch: [] });
    } finally {
      await app.close();
    }
  });

  it("rejects a signed p2p message outside the configured chat allowlist before admission", async () => {
    const db = createTestDb();
    const sdkCalls = { create: [] as unknown[], patch: [] as unknown[] };
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      eventBus: new OpenForgeEventBus(),
      sessionManager: new InMemorySessionManager(createEchoingTmux() as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      feishuWebhookSdkFactory: createFakeSdkFactory(sdkCalls)
    });

    try {
      const userId = seedUserAndFeishu(db);
      const baseUrl = await listen(app.server);
      const body = JSON.stringify({
        token: verificationToken,
        header: { event_id: "ev-webhook-chat-not-allowed" },
        event: {
          sender: { sender_id: { open_id: "ou-owner" } },
          message: {
            message_id: "om-webhook-chat-not-allowed",
            chat_id: "oc-not-allowed",
            chat_type: "p2p",
            message_type: "text",
            content: JSON.stringify({ text: "不应进入 Copilot" })
          }
        }
      });

      const response = await postSignedWebhook(baseUrl, body, "nonce-chat-not-allowed");
      const responseBody = await response.json() as { msg?: string };
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(response.status, 200, JSON.stringify(responseBody));
      assert.equal(responseBody.msg, "ignored");
      assert.equal(countRows(db, "portfolio_feishu_ingress_events"), 0);
      assert.equal(countRows(db, "integration_feishu_webhook_replay_entries"), 0);
      assert.equal(countRows(db, "integration_feishu_webhook_rate_windows"), 0);
      assert.equal(feishuConversationId(db, userId, "oc-not-allowed"), undefined);
      assert.deepEqual(sdkCalls, { create: [], patch: [] });
    } finally {
      await app.close();
    }
  });

  it("rejects a correctly signed stale webhook timestamp before replay admission", async () => {
    const db = createTestDb();
    const sdkCalls = { create: [] as unknown[], patch: [] as unknown[] };
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      eventBus: new OpenForgeEventBus(),
      sessionManager: new InMemorySessionManager(createEchoingTmux() as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      feishuWebhookSdkFactory: createFakeSdkFactory(sdkCalls)
    });

    try {
      seedUserAndFeishu(db);
      const baseUrl = await listen(app.server);
      const body = JSON.stringify({
        token: verificationToken,
        header: { event_id: "ev-webhook-stale-timestamp" },
        event: {
          sender: { sender_id: { open_id: "ou-owner" } },
          message: {
            message_id: "om-webhook-stale-timestamp",
            chat_id: "oc-shared-dsh",
            chat_type: "p2p",
            message_type: "text",
            content: JSON.stringify({ text: "过期请求" })
          }
        }
      });
      const staleTimestamp = String(Math.floor(Date.now() / 1_000) - 301);

      const response = await postSignedWebhook(
        baseUrl,
        body,
        "nonce-stale-timestamp",
        staleTimestamp
      );

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { msg: "feishu_webhook_timestamp_out_of_window" });
      assert.equal(countRows(db, "integration_feishu_webhook_replay_entries"), 0);
      assert.deepEqual(sdkCalls, { create: [], patch: [] });
    } finally {
      await app.close();
    }
  });

  it("rejects unknown identity and missing or cross-tenant mappings before message or card admission", async () => {
    const cases = [
      { name: "unknown-identity", kind: "card" as const },
      { name: "missing-mapping", kind: "message" as const },
      { name: "cross-tenant-mapping", kind: "card" as const }
    ];

    for (const policyCase of cases) {
      const db = createTestDb();
      const sdkCalls = { create: [] as unknown[], patch: [] as unknown[] };
      const app = createGatewayApp({
        jwtSecret,
        masterKey,
        db,
        eventBus: new OpenForgeEventBus(),
        sessionManager: new InMemorySessionManager(createEchoingTmux() as never),
        apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
        feishuWebhookSdkFactory: createFakeSdkFactory(sdkCalls)
      });

      try {
        const userId = seedUserAndFeishu(db);
        const integration = new FeishuIntegrationRepository(db, userId, masterKey);
        if (policyCase.name === "unknown-identity") {
          integration.upsertConfig({ identityMode: "unknown" });
        } else if (policyCase.name === "missing-mapping") {
          integration.replaceUserMappings([]);
        } else {
          const foreignUserId = new UserRepository(db)
            .create("foreign-feishu-mapping@example.com", "hash").id;
          integration.replaceUserMappings([
            { feishuUserId: "ou-owner", openforgeUserId: foreignUserId }
          ]);
        }
        const pending = policyCase.kind === "card"
          ? seedPendingApproval(db, userId, "oc-modern-callback", "ou-owner")
          : undefined;
        const before = snapshotCopilotState(db);
        const body = policyCase.kind === "card"
          ? JSON.stringify({
              token: verificationToken,
              header: { event_id: `ev-${policyCase.name}` },
              event: {
                operator: { open_id: "ou-owner" },
                context: {
                  open_chat_id: "oc-modern-callback",
                  open_message_id: `om-${policyCase.name}`
                },
                action: {
                  value: {
                    copilot_decision: "reject",
                    conversation_id: pending!.conversationId,
                    run_id: pending!.runId,
                    action_id: pending!.actionId
                  }
                }
              }
            })
          : JSON.stringify({
              token: verificationToken,
              header: { event_id: `ev-${policyCase.name}` },
              event: {
                sender: { sender_id: { open_id: "ou-owner" } },
                message: {
                  message_id: `om-${policyCase.name}`,
                  chat_id: "oc-shared-dsh",
                  chat_type: "p2p",
                  message_type: "text",
                  content: JSON.stringify({ text: "不应进入 Copilot" })
                }
              }
            });
        const baseUrl = await listen(app.server);

        const response = await postSignedWebhook(baseUrl, body, `nonce-${policyCase.name}`);
        const responseBody = await response.json() as { msg?: string };
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(response.status, 200, `${policyCase.name}: ${JSON.stringify(responseBody)}`);
        assert.equal(responseBody.msg, "ignored", policyCase.name);
        assert.deepEqual(snapshotCopilotState(db), before, policyCase.name);
        assert.equal(countRows(db, "portfolio_feishu_ingress_events"), 0, policyCase.name);
        assert.equal(countRows(db, "integration_feishu_webhook_replay_entries"), 0, policyCase.name);
        assert.equal(countRows(db, "integration_feishu_webhook_rate_windows"), 0, policyCase.name);
        assert.equal(countPolicyRejections(db), 1, policyCase.name);
        assert.deepEqual(sdkCalls, { create: [], patch: [] }, policyCase.name);
      } finally {
        await app.close();
      }
    }
  });

  it("rejects malformed and far-future timestamps before replay admission", async () => {
    const db = createTestDb();
    const sdkCalls = { create: [] as unknown[], patch: [] as unknown[] };
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      eventBus: new OpenForgeEventBus(),
      sessionManager: new InMemorySessionManager(createEchoingTmux() as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      feishuWebhookSdkFactory: createFakeSdkFactory(sdkCalls)
    });

    try {
      seedUserAndFeishu(db);
      const baseUrl = await listen(app.server);
      for (const invalid of [
        { name: "malformed", timestamp: "123.5", code: "feishu_webhook_timestamp_invalid" },
        {
          name: "future",
          timestamp: String(Math.floor(Date.now() / 1_000) + 301),
          code: "feishu_webhook_timestamp_out_of_window"
        }
      ]) {
        const body = JSON.stringify({
          token: verificationToken,
          header: { event_id: `ev-webhook-${invalid.name}-timestamp` },
          event: {
            sender: { sender_id: { open_id: "ou-owner" } },
            message: {
              message_id: `om-webhook-${invalid.name}-timestamp`,
              chat_id: "oc-shared-dsh",
              chat_type: "p2p",
              message_type: "text",
              content: JSON.stringify({ text: "无效时间戳请求" })
            }
          }
        });
        const response = await postSignedWebhook(
          baseUrl,
          body,
          `nonce-${invalid.name}-timestamp`,
          invalid.timestamp
        );
        assert.equal(response.status, 401, invalid.name);
        assert.deepEqual(await response.json(), { msg: invalid.code }, invalid.name);
      }
      assert.equal(countRows(db, "integration_feishu_webhook_replay_entries"), 0);
      assert.deepEqual(sdkCalls, { create: [], patch: [] });
    } finally {
      await app.close();
    }
  });

  it("keeps every non-webhook Feishu route behind JWT authentication", async () => {
    const db = createTestDb();
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      eventBus: new OpenForgeEventBus(),
      sessionManager: new InMemorySessionManager(createEchoingTmux() as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey })
    });

    try {
      seedUserAndFeishu(db);
      const baseUrl = await listen(app.server);
      for (const pathSuffix of ["account", "config", "user-mappings"]) {
        const response = await fetch(`${baseUrl}/api/v1/integrations/feishu/${pathSuffix}`);
        assert.equal(response.status, 401, pathSuffix);
      }
    } finally {
      await app.close();
    }
  });

  it("rejects missing or disabled Feishu accounts before replay and rate admission", async () => {
    for (const accountState of ["missing", "disabled"] as const) {
      const db = createTestDb();
      const sdkCalls = { create: [] as unknown[], patch: [] as unknown[] };
      const app = createGatewayApp({
        jwtSecret,
        masterKey,
        db,
        eventBus: new OpenForgeEventBus(),
        sessionManager: new InMemorySessionManager(createEchoingTmux() as never),
        apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
        feishuWebhookSdkFactory: createFakeSdkFactory(sdkCalls)
      });

      try {
        const userId = seedUserAndFeishu(db);
        if (accountState === "missing") {
          db.prepare("DELETE FROM feishu_channel_accounts WHERE user_id = ?").run(userId);
        } else {
          new FeishuChannelRepository(db, userId, masterKey).upsertAccount({
            appId: "cli-feishu-route-dsh",
            enabled: false
          });
        }
        const baseUrl = await listen(app.server);
        const body = JSON.stringify({
          token: verificationToken,
          header: { event_id: `ev-webhook-account-${accountState}` },
          event: {
            sender: { sender_id: { open_id: "ou-owner" } },
            message: {
              message_id: `om-webhook-account-${accountState}`,
              chat_id: "oc-shared-dsh",
              chat_type: "p2p",
              message_type: "text",
              content: JSON.stringify({ text: "不应进入 Copilot" })
            }
          }
        });

        const response = await postSignedWebhook(
          baseUrl,
          body,
          `nonce-account-${accountState}`
        );
        const responseBody = await response.json() as { msg?: string };
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(response.status, 200, accountState);
        assert.equal(responseBody.msg, "ignored", accountState);
        assert.equal(countRows(db, "integration_feishu_webhook_replay_entries"), 0, accountState);
        assert.equal(countRows(db, "integration_feishu_webhook_rate_windows"), 0, accountState);
        assert.equal(countRows(db, "portfolio_feishu_ingress_events"), 0, accountState);
        assert.equal(feishuConversationId(db, userId, "oc-shared-dsh"), undefined, accountState);
        assert.deepEqual(sdkCalls, { create: [], patch: [] }, accountState);
      } finally {
        await app.close();
      }
    }
  });
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function createIdleFeishuRuntime(): FeishuChannelRuntime {
  return new FeishuChannelRuntime({
    supervisor: {
      start: async () => undefined,
      stop: async () => undefined,
      reconcileAccount: async () => undefined,
      getHealth: () => ({
        state: "connected",
        accountId: "account-test",
        configRevision: 1,
        reconnectAttempt: 0,
        lastConnectedAt: new Date(),
        lastErrorMessage: null
      })
    },
    setInterval: () => 1,
    clearInterval: () => undefined
  });
}

function createEchoingTmux() {
  const panes = new Map<string, string>();
  return {
    async createSession() {},
    async killSession() {},
    async capturePane(name: string) { return panes.get(name) ?? ""; },
    async listSessions() { return [] as string[]; },
    async sendInput(name: string, data: string) {
      panes.set(name, (panes.get(name) ?? "") + data);
    }
  };
}

function createFakeSdkFactory(calls: { create: unknown[]; patch: unknown[] }): FeishuSdkFactory {
  return {
    createRestClient: () => ({
      im: {
        message: {
          create: async (input: unknown) => {
            calls.create.push(input);
            return { code: 0, data: { message_id: `om-created-${calls.create.length}` } };
          },
          patch: async (input: unknown) => {
            calls.patch.push(input);
            return { code: 0 };
          }
        }
      }
    })
  } as unknown as FeishuSdkFactory;
}

function seedUserAndFeishu(db: Database.Database): string {
  const userId = new UserRepository(db).create("feishu-route-dsh@example.com", "hash").id;
  const providers = new ModelProviderRepository(db, userId, masterKey);
  const provider = providers.createProviderProfile({
    name: "Stub",
    providerKey: "stub",
    anthropicBaseUrl: "https://stub.example",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["opencode"]
  });
  providers.createModelProfile({
    providerProfileId: provider.id,
    name: "Stub model",
    modelId: "stub-model",
    capabilities: ["chat"],
    isDefault: true
  });
  providers.createCredential({
    providerProfileId: provider.id,
    label: "key",
    plaintextSecret: "fake-llm-key"
  });
  new FeishuChannelRepository(db, userId, masterKey).upsertAccount({
    appId: "cli-feishu-route-dsh",
    appSecret: "secret",
    enabled: true
  });
  const integration = new FeishuIntegrationRepository(db, userId, masterKey);
  integration.upsertConfig({
    enabled: true,
    emergencyDisabled: false,
    identityMode: "bot",
    allowedChatIds: ["oc-shared-dsh", "oc-modern-callback", "oc-webhook-group"]
  });
  integration.replaceUserMappings([
    { feishuUserId: "ou-owner", openforgeUserId: userId },
    { feishuUserId: "ou-group-member", openforgeUserId: userId }
  ]);
  integration.configurePublicWebhook({
    publicWebhookId: webhookId,
    publicWebhookEnabled: true,
    verificationToken,
    eventEncryptKey
  });
  return userId;
}

function seedPendingApproval(
  db: Database.Database,
  userId: string,
  chatId: string,
  senderIdentity: string
): { conversationId: string; runId: string; actionId: string } {
  const log = new CopilotConversationLog(db, userId);
  const conversation = log.createConversation("Feishu route approval");
  const run = log.createRun(conversation.id, {});
  const pending = log.createPendingAction({
    runId: run.id,
    tool: "dispatch_task_to_session",
    inputJson: "{}",
    inputDigest: "digest"
  });
  log.updateRun(run.id, { status: "awaiting_approval" });
  new FeishuCopilotChannelRepository(db, userId).claimOwner({
    chatId,
    conversationId: conversation.id,
    senderIdentity
  });
  return { conversationId: conversation.id, runId: run.id, actionId: pending.id };
}

async function listen(server: ReturnType<typeof createGatewayApp>["server"]): Promise<string> {
  let baseUrl = "";
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
  return baseUrl;
}

async function postSignedWebhook(
  baseUrl: string,
  body: string,
  nonce: string,
  timestamp = String(Math.floor(Date.now() / 1_000))
): Promise<Response> {
  const signature = createHash("sha256")
    .update(`${timestamp}${nonce}${eventEncryptKey}${body}`)
    .digest("hex");
  return fetch(`${baseUrl}/api/v1/integrations/feishu/webhook/${webhookId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-lark-request-timestamp": timestamp,
      "x-lark-request-nonce": nonce,
      "x-lark-signature": signature
    },
    body
  });
}

async function waitForPending(
  db: Database.Database,
  userId: string
): Promise<{ conversationId: string; runId: string; actionId: string }> {
  let found: { conversationId: string; runId: string; actionId: string } | undefined;
  await waitFor(() => {
    found = db.prepare(`
      SELECT c.conversation_id AS conversationId, r.id AS runId, a.id AS actionId
      FROM feishu_copilot_channels c
      JOIN copilot_runs r ON r.conversation_id = c.conversation_id
      JOIN copilot_pending_actions a ON a.run_id = r.id
      WHERE c.user_id = ? AND r.status = 'awaiting_approval' AND a.status = 'pending'
      LIMIT 1
    `).get(userId) as typeof found;
    return Boolean(found);
  });
  return found!;
}

function readFakeLog(logPath: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function runStatus(db: Database.Database, runId: string): string | undefined {
  return (db.prepare("SELECT status FROM copilot_runs WHERE id = ?").get(runId) as { status: string } | undefined)?.status;
}

function pendingStatus(db: Database.Database, actionId: string): string | undefined {
  return (db.prepare("SELECT status FROM copilot_pending_actions WHERE id = ?").get(actionId) as { status: string } | undefined)?.status;
}

function feishuConversationId(
  db: Database.Database,
  userId: string,
  chatId: string
): string | undefined {
  return (db.prepare(`
    SELECT conversation_id AS conversationId
    FROM feishu_copilot_channels
    WHERE user_id = ? AND chat_id = ?
  `).get(userId, chatId) as { conversationId: string } | undefined)?.conversationId;
}

type CountedTable =
  | "copilot_conversations"
  | "copilot_runs"
  | "integration_feishu_webhook_rate_windows"
  | "integration_feishu_webhook_replay_entries"
  | "portfolio_feishu_ingress_events";

function countRows(db: Database.Database, table: CountedTable): number {
  const statement = table === "copilot_conversations"
    ? "SELECT COUNT(*) AS count FROM copilot_conversations"
    : table === "copilot_runs"
      ? "SELECT COUNT(*) AS count FROM copilot_runs"
      : table === "integration_feishu_webhook_rate_windows"
        ? "SELECT COUNT(*) AS count FROM integration_feishu_webhook_rate_windows"
        : table === "integration_feishu_webhook_replay_entries"
          ? "SELECT COUNT(*) AS count FROM integration_feishu_webhook_replay_entries"
          : "SELECT COUNT(*) AS count FROM portfolio_feishu_ingress_events";
  return (db.prepare(statement).get() as { count: number }).count;
}

function listRateScopes(db: Database.Database): string[] {
  const rows = db.prepare(`
    SELECT scope, scope_id AS scopeId
    FROM integration_feishu_webhook_rate_windows
    ORDER BY scope ASC
  `).all() as Array<{ scope: string; scopeId: string }>;
  return rows.map((row) => `${row.scope}:${row.scopeId}`);
}

function snapshotCopilotState(db: Database.Database): {
  conversations: number;
  runs: number;
  pending: Array<{ id: string; status: string }>;
} {
  return {
    conversations: countRows(db, "copilot_conversations"),
    runs: countRows(db, "copilot_runs"),
    pending: db.prepare(`
      SELECT id, status FROM copilot_pending_actions ORDER BY id ASC
    `).all() as Array<{ id: string; status: string }>
  };
}

function countPolicyRejections(db: Database.Database): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'feishu.webhook.reject'
  `).get() as { count: number }).count;
}

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
