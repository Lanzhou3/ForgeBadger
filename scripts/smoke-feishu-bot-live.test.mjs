import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  resolveFeishuBotLiveConfig,
  runFeishuBotLiveSmoke,
  writeFeishuBotLiveSmokeReport
} from "./smoke-feishu-bot-live.mjs";

describe("Feishu bot live long-connection smoke helper", () => {
  it("fails closed when required live credentials are missing", () => {
    const config = resolveFeishuBotLiveConfig({
      OPENFORGE_TOKEN: "token"
    });

    assert.equal(config.ok, false);
    assert.match(config.reason, /FEISHU_APP_ID/);
    assert.match(config.reason, /FEISHU_APP_SECRET/);
  });

  it("parses an optional output path for saving the redacted live report", () => {
    const config = resolveFeishuBotLiveConfig({
      OPENFORGE_TOKEN: "token",
      FEISHU_APP_ID: "cli_a_live_app",
      FEISHU_APP_SECRET: "live-app-secret"
    }, ["--output", "docs/reports/feishu-live-report.json"]);

    assert.equal(config.ok, true);
    assert.equal(config.config.outputPath, "docs/reports/feishu-live-report.json");
  });

  it("writes the redacted live report to a 0600 JSON file and creates parent directories", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openforge-feishu-live-"));
    const outputPath = path.join(tmpDir, "nested", "report.json");

    writeFeishuBotLiveSmokeReport({
      ok: true,
      mode: "real_feishu_bot_long_connection",
      gateClearingEvidence: true
    }, outputPath);

    const stat = fs.statSync(outputPath);
    const saved = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(saved.mode, "real_feishu_bot_long_connection");
    assert.equal(stat.mode & 0o777, 0o600);
  });

  it("routes real SDK events through Gateway and sends bounded replies without public callback ingress", async () => {
    const sentMessages = [];
    const requests = [];
    const sdk = createFakeLarkSdk({
      sentMessages,
      events: [
        {
          sender: { sender_id: { open_id: "ou_live_user" } },
          message: {
            message_id: "om_live_status",
            chat_id: "oc_live_chat",
            message_type: "text",
            content: JSON.stringify({ text: "/openforge status" })
          }
        },
        {
          sender: { sender_id: { open_id: "ou_live_user" } },
          message: {
            message_id: "om_live_terminal",
            chat_id: "oc_live_chat",
            message_type: "text",
            content: JSON.stringify({ text: "/openforge terminal session-1 continue app_secret=unsafe" })
          }
        }
      ]
    });

    const report = await runFeishuBotLiveSmoke({
      gatewayUrl: "http://127.0.0.1:48731",
      token: "Bearer live-token-secret",
      appId: "cli_a_live_app",
      appSecret: "live-app-secret",
      domain: "feishu",
      durationMs: 50,
      maxEvents: 2,
      requireReconnect: true,
      sdk,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        const body = JSON.parse(init.body);
        if (String(url).endsWith("/connection-events")) {
          return jsonResponse(200, {
            code: 0,
            data: { connection: { state: body.state, eventSubscription: "im.message.receive_v1" } },
            message: ""
          });
        }
        if (body.event?.event?.message?.message_id === "om_live_terminal") {
          return jsonResponse(403, {
            code: 1,
            message: "Feishu bot WebSocket event rejected",
            details: { code: "feishu_terminal_input_rejected" },
            data: {
              replyPlan: {
                receiveId: "oc_live_chat",
                receiveIdType: "chat_id",
                msgType: "text",
                text: "OpenForge rejected terminal input from Feishu."
              }
            }
          });
        }
        return jsonResponse(200, {
          code: 0,
          data: {
            route: "status",
            replyPlan: {
              receiveId: "oc_live_chat",
              receiveIdType: "chat_id",
              msgType: "text",
              text: "OpenForge status\nProjects: 1\napp_secret=must-redact"
            }
          },
          message: ""
        });
      }
    });
    const serialized = JSON.stringify(report);

    assert.equal(report.ok, true);
    assert.equal(report.mode, "real_feishu_bot_long_connection");
    assert.equal(report.publicCallbackRequired, false);
    assert.equal(report.gateClearingEvidence, true, JSON.stringify(report, null, 2));
    assert.equal(report.counts.acceptedEvents, 1);
    assert.equal(report.counts.terminalInputRejections, 1);
    assert.equal(report.counts.replySent, 2);
    assert.equal(report.counts.reconnected, 1);
    assert.equal(sentMessages.length, 2);
    assert.deepEqual(sentMessages[0].params, { receive_id_type: "chat_id" });
    assert.equal(sentMessages[0].data.receive_id, "oc_live_chat");
    assert.equal(sentMessages[0].data.msg_type, "text");
    assert.equal(JSON.parse(sentMessages[0].data.content).text.includes("OpenForge status"), true);
    assert.equal(requests.some((request) => request.url.endsWith("/bot-websocket/events")), true);
    assert.equal(requests.some((request) => request.url.endsWith("/bot-websocket/connection-events")), true);
    assert.equal(serialized.includes("live-token-secret"), false);
    assert.equal(serialized.includes("live-app-secret"), false);
    assert.equal(serialized.includes("oc_live_chat"), false);
    assert.equal(serialized.includes("ou_live_user"), false);
    assert.equal(serialized.includes("must-redact"), false);
  });

  it("enables send-replies and reconnect requirements when --require-gate-evidence is set", () => {
    const config = resolveFeishuBotLiveConfig({
      OPENFORGE_TOKEN: "token",
      FEISHU_APP_ID: "cli_a_live_app",
      FEISHU_APP_SECRET: "live-app-secret"
    }, ["--require-gate-evidence"]);

    assert.equal(config.ok, true);
    assert.equal(config.config.requireGateEvidence, true);
    assert.equal(config.config.requireReconnect, true);
    assert.equal(config.config.sendReplies, true);
  });

  it("keeps evidence non-clearing when reconnect or boundary checks are missing", async () => {
    const sentMessages = [];
    const sdk = createFakeLarkSdk({
      sentMessages,
      skipReconnect: true,
      events: [
        {
          sender: { sender_id: { open_id: "ou_live_user" } },
          message: {
            message_id: "om_live_status",
            chat_id: "oc_live_chat",
            message_type: "text",
            content: JSON.stringify({ text: "/openforge status" })
          }
        }
      ]
    });

    const report = await runFeishuBotLiveSmoke({
      gatewayUrl: "http://127.0.0.1:48731",
      token: "token",
      appId: "cli_a_live_app",
      appSecret: "live-app-secret",
      durationMs: 20,
      maxEvents: 1,
      requireReconnect: false,
      sdk,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/connection-events")) {
          return jsonResponse(200, { code: 0, data: { connection: { state: "connected" } }, message: "" });
        }
        return jsonResponse(200, {
          code: 0,
          data: {
            route: "status",
            replyPlan: {
              receiveId: "oc_live_chat",
              receiveIdType: "chat_id",
              msgType: "text",
              text: "OpenForge status"
            }
          },
          message: ""
        });
      }
    });

    assert.equal(report.ok, true);
    assert.equal(report.gateClearingEvidence, false);
    assert.match(report.caveat, /reconnect/u);
    assert.match(report.caveat, /terminal rejection/u);
  });
});

function createFakeLarkSdk(options) {
  return {
    Domain: { Feishu: "https://open.feishu.cn", Lark: "https://open.larksuite.com" },
    LoggerLevel: { info: "info", warn: "warn" },
    Client: class FakeClient {
      constructor(params) {
        this.params = params;
        this.im = {
          v1: {
            message: {
              create: async (payload) => {
                options.sentMessages.push(payload);
                return { code: 0 };
              }
            }
          }
        };
      }
    },
    EventDispatcher: class FakeEventDispatcher {
      register(handles) {
        this.handles = handles;
        return this;
      }
    },
    WSClient: class FakeWSClient {
      constructor(params) {
        this.params = params;
        this.closed = false;
      }

      async start({ eventDispatcher }) {
        await this.params.onReady?.();
        for (const event of options.events) {
          await eventDispatcher.handles["im.message.receive_v1"](event);
        }
        if (!options.skipReconnect) {
          await this.params.onReconnecting?.();
          await this.params.onReconnected?.();
        }
      }

      close() {
        this.closed = true;
      }
    }
  };
}

function jsonResponse(status, body) {
  return {
    status,
    async json() {
      return body;
    }
  };
}
