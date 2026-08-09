import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import { FeishuIntegrationRepository } from "../src/db/repositories/feishu-integration-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import {
  normalizeFeishuBotLongConnectionEvent,
  recordFeishuBotConnectionEvent,
  routeFeishuBotCommand
} from "../src/services/integrations/feishu-bot-bridge.js";

describe("Feishu bot long-connection bridge", () => {
  it("normalizes im.message.receive_v1 events and returns bounded status replies", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("feishu-bot-status@example.com", "hash");
    seedFeishuBotPolicy(db, user.id);
    const project = new ProjectRepository(db, user.id).create({
      name: "OpenForge",
      path: "/tmp/openforge-feishu-bot-status",
      aiTool: "claude"
    });
    new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Phase 41 session",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "attach-token-secret",
      tmuxSession: "of-secret-tmux"
    });

    const command = normalizeFeishuBotLongConnectionEvent(feishuMessageEvent({
      text: "/openforge status",
      eventId: "ev_status",
      messageId: "om_status"
    }));
    assert.ok(command);

    const result = routeFeishuBotCommand({ db, userId: user.id, command });
    const serialized = JSON.stringify(result);

    assert.equal(result.ok, true);
    assert.equal(result.reply.receiveId, "oc_allowed");
    assert.equal(result.reply.receiveIdType, "chat_id");
    assert.equal(result.route, "status");
    assert.match(result.reply.text, /OpenForge status/u);
    assert.match(result.reply.text, /Projects: 1/u);
    assert.match(result.reply.text, /Sessions: 1/u);
    assert.equal(serialized.includes("attach-token-secret"), false);
    assert.equal(serialized.includes("of-secret-tmux"), false);

    const audit = new AuditLogRepository(db, user.id).list({ action: "feishu.bot_ws.accept" });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].resourceType, "feishu_bot_websocket");
  });

  it("returns task details without raw work-item details or terminal input authority", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("feishu-bot-task@example.com", "hash");
    seedFeishuBotPolicy(db, user.id);
    const project = new ProjectRepository(db, user.id).create({
      name: "OpenForge",
      path: "/tmp/openforge-feishu-bot-task",
      aiTool: "claude"
    });
    const workItem = new ProjectManagerRepository(db, user.id).createWorkItem(project.id, {
      title: "Ship Feishu bridge",
      status: "in_progress",
      acceptanceCriteria: ["bounded replies only"],
      details: {
        rawTerminalOutput: "$ cat secret.txt",
        apiKey: "sk-task-secret"
      }
    });

    const result = routeFeishuBotCommand({
      db,
      userId: user.id,
      command: {
        chatId: "oc_allowed",
        feishuUserId: "ou_allowed",
        text: `/openforge task ${workItem.id}`,
        messageId: "om_task",
        eventId: "ev_task"
      }
    });
    const serialized = JSON.stringify(result);

    assert.equal(result.ok, true);
    assert.equal(result.route, "task");
    assert.match(result.reply.text, /Ship Feishu bridge/u);
    assert.match(result.reply.text, /in_progress/u);
    assert.equal(serialized.includes("rawTerminalOutput"), false);
    assert.equal(serialized.includes("sk-task-secret"), false);
    assert.equal(serialized.includes("$ cat secret.txt"), false);
  });

  it("rejects free-form terminal control and records redacted reject evidence", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("feishu-bot-reject@example.com", "hash");
    seedFeishuBotPolicy(db, user.id);

    const result = routeFeishuBotCommand({
      db,
      userId: user.id,
      command: {
        chatId: "oc_allowed",
        feishuUserId: "ou_allowed",
        text: "/openforge input session-1 continue token=sk-terminal-secret",
        messageId: "om_terminal",
        eventId: "ev_terminal"
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, "feishu_terminal_input_rejected");
    const audit = new AuditLogRepository(db, user.id).list({ action: "feishu.bot_ws.reject" });
    assert.equal(audit.length, 1);
    assert.equal(JSON.stringify(audit).includes("sk-terminal-secret"), false);
  });

  it("atomically rejects replayed event-only bot commands", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("feishu-bot-event-replay@example.com", "hash");
    seedFeishuBotPolicy(db, user.id);
    const command = {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "/openforge status",
      eventId: "ev_event_only_replay"
    };

    const results = await Promise.all([
      Promise.resolve().then(() => routeFeishuBotCommand({ db, userId: user.id, command })),
      Promise.resolve().then(() => routeFeishuBotCommand({ db, userId: user.id, command }))
    ]);

    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok)[0]?.reasonCode, "feishu_bot_event_replayed");
    assert.equal(new AuditLogRepository(db, user.id).list({ action: "feishu.bot_ws.accept" }).length, 1);
  });

  it("records reconnect evidence without treating public callbacks as required", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("feishu-bot-reconnect@example.com", "hash");

    recordFeishuBotConnectionEvent(db, user.id, {
      state: "connected",
      connectionId: "ws-1",
      eventSubscription: "im.message.receive_v1"
    });
    recordFeishuBotConnectionEvent(db, user.id, {
      state: "reconnecting",
      connectionId: "ws-1",
      attempt: 1,
      reason: "socket closed with app_secret=hidden"
    });
    recordFeishuBotConnectionEvent(db, user.id, {
      state: "reconnected",
      connectionId: "ws-2",
      attempt: 2
    });

    const logs = new AuditLogRepository(db, user.id)
      .list({ action: "feishu.bot_ws.connection" })
      .sort((left, right) => left.id - right.id);
    assert.equal(logs.length, 3);
    const details = logs.map((log) => JSON.parse(log.details ?? "{}"));
    assert.deepEqual(details.map((detail) => detail.state), ["connected", "reconnecting", "reconnected"]);
    assert.equal(details.every((detail) => detail.publicCallbackRequired === false), true);
    assert.equal(details.every((detail) => detail.eventSubscription === "im.message.receive_v1"), true);
    assert.equal(JSON.stringify(details).includes("hidden"), false);
  });
});

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

function seedFeishuBotPolicy(db: Database.Database, userId: string): void {
  const repo = new FeishuIntegrationRepository(db, userId);
  repo.upsertConfig({
    enabled: true,
    identityMode: "bot",
    allowedChatIds: ["oc_allowed"],
    commandPrefix: "/openforge"
  });
  repo.replaceUserMappings([
    { feishuUserId: "ou_allowed", openforgeUserId: userId, displayName: "Allowed User" }
  ]);
}

function feishuMessageEvent(input: {
  text: string;
  eventId: string;
  messageId: string;
  chatId?: string;
  feishuUserId?: string;
}): Record<string, unknown> {
  return {
    schema: "2.0",
    header: {
      event_id: input.eventId,
      event_type: "im.message.receive_v1"
    },
    event: {
      sender: {
        sender_id: {
          open_id: input.feishuUserId ?? "ou_allowed"
        }
      },
      message: {
        message_id: input.messageId,
        chat_id: input.chatId ?? "oc_allowed",
        message_type: "text",
        content: JSON.stringify({ text: input.text })
      }
    }
  };
}
