import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFeishuBotWebSocketFixtureEvent,
  buildFeishuBotWebSocketSmokeReport,
  resolveFeishuBotWebSocketSmokeConfig,
  runFeishuBotWebSocketSmoke
} from "./smoke-feishu-bot-websocket.mjs";

describe("Feishu bot WebSocket smoke helper", () => {
  it("uses only ForgeBadger smoke variables", () => {
    const result = resolveFeishuBotWebSocketSmokeConfig({
      FORGEBADGER_TOKEN: "current-token",
      FORGEBADGER_GATEWAY_URL: "http://current.example:48731"
    });

    assert.equal(result.ok, true);
    assert.equal(result.config.token, "current-token");
    assert.equal(result.config.gatewayUrl, "http://current.example:48731");
  });

  it("builds SDK-style im.message.receive_v1 fixture events", () => {
    const event = buildFeishuBotWebSocketFixtureEvent({
      text: "/forgebadger status",
      eventId: "ev_fixture",
      messageId: "om_fixture",
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed"
    });

    assert.equal(event.header.event_type, "im.message.receive_v1");
    assert.equal(event.header.event_id, "ev_fixture");
    assert.equal(event.event.message.message_id, "om_fixture");
    assert.equal(event.event.message.chat_id, "oc_allowed");
    assert.equal(event.event.sender.sender_id.open_id, "ou_allowed");
    assert.equal(event.event.message.content, JSON.stringify({ text: "/forgebadger status" }));
  });

  it("posts receive, reconnect, and terminal-rejection checks without leaking auth", async () => {
    const calls = [];
    const report = await runFeishuBotWebSocketSmoke({
      gatewayUrl: "http://127.0.0.1:48731",
      token: "Bearer should-not-leak",
      chatId: "oc_sensitive_chat",
      feishuUserId: "ou_sensitive_user",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        const body = JSON.parse(init.body);
        if (String(url).endsWith("/connection-events")) {
          return jsonResponse(200, {
            code: 0,
            data: { connection: { state: body.state, eventSubscription: "im.message.receive_v1" } },
            message: ""
          });
        }
        if (body.event?.event?.message?.content?.includes("terminal")) {
          return jsonResponse(403, {
            code: 1,
            message: "Feishu bot WebSocket event rejected",
            details: { code: "feishu_terminal_input_rejected" },
            data: {
              replyPlan: {
                receiveId: "oc_sensitive_chat",
                receiveIdType: "chat_id",
                msgType: "text",
                text: "ForgeBadger rejected terminal input from Feishu."
              }
            }
          });
        }
        return jsonResponse(200, {
          code: 0,
          data: {
            route: "status",
            replyPlan: {
              receiveId: "oc_sensitive_chat",
              receiveIdType: "chat_id",
              msgType: "text",
              text: "ForgeBadger status\nProjects: 1"
            }
          },
          message: ""
        });
      }
    });
    const serialized = JSON.stringify(report);

    assert.equal(report.ok, true);
    assert.equal(report.gateClearingEvidence, false);
    assert.equal(report.mode, "authenticated_gateway_fixture");
    assert.deepEqual(report.checks.map((check) => check.name), [
      "connection_connected",
      "receive_route",
      "terminal_input_rejected",
      "connection_reconnecting",
      "connection_reconnected"
    ]);
    assert.equal(report.checks.find((check) => check.name === "receive_route")?.route, "status");
    assert.equal(report.checks.find((check) => check.name === "terminal_input_rejected")?.rejectionCode, "feishu_terminal_input_rejected");
    assert.equal(calls.length, 5);
    assert.equal(calls.every((call) => call.init.headers.Authorization === "Bearer should-not-leak"), true);
    assert.equal(serialized.includes("Bearer should-not-leak"), false);
    assert.equal(serialized.includes("oc_sensitive_chat"), false);
    assert.equal(serialized.includes("ou_sensitive_user"), false);
    assert.equal(serialized.includes("app_secret"), false);
    assert.match(report.caveat, /real Feishu bot persistent-connection run is still required/u);
  });

  it("redacts unsafe response content from smoke reports", () => {
    const report = buildFeishuBotWebSocketSmokeReport({
      gatewayUrl: "http://127.0.0.1:48731",
      checks: [
        {
          name: "receive_route",
          httpStatus: 200,
          ok: true,
          route: "status",
          replyPreview: "token sk-live-secret app_secret=hidden raw message"
        }
      ]
    });
    const serialized = JSON.stringify(report);

    assert.equal(serialized.includes("sk-live-secret"), false);
    assert.equal(serialized.includes("hidden"), false);
    assert.match(serialized, /\[REDACTED\]/u);
    assert.equal(report.gateClearingEvidence, false);
  });

  it("fails closed when authentication configuration is missing", () => {
    const config = resolveFeishuBotWebSocketSmokeConfig({});

    assert.equal(config.ok, false);
    assert.match(config.reason, /FORGEBADGER_TOKEN/);
  });
});

function jsonResponse(status, body) {
  return {
    status,
    async json() {
      return body;
    }
  };
}
