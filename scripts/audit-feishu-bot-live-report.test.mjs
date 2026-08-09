import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseFeishuBotLiveReportAuditArgs,
  validateFeishuBotLiveReport
} from "./audit-feishu-bot-live-report.mjs";

describe("Feishu bot live evidence report audit", () => {
  it("accepts a redacted gate-clearing live report as ready for human review", () => {
    const result = validateFeishuBotLiveReport(buildGateClearingReport());

    assert.deepEqual(result, {
      ok: true,
      readyForHumanReview: true,
      gateClearingEvidence: false,
      errors: []
    });
  });

  it("rejects reports that lack reconnect, bounded reply, or terminal rejection evidence", () => {
    const report = buildGateClearingReport();
    report.gateClearingEvidence = false;
    report.counts.reconnected = 0;
    report.counts.replySent = 0;
    report.counts.terminalInputRejections = 0;
    report.checks = report.checks.filter((check) => (
      check.name !== "connection_reconnected"
      && check.name !== "bounded_reply_sent"
      && check.name !== "terminal_input_rejected"
    ));

    const result = validateFeishuBotLiveReport(report);

    assert.equal(result.ok, false);
    assert.equal(result.readyForHumanReview, false);
    assert.equal(result.gateClearingEvidence, false);
    assert.match(result.errors.join("\n"), /gateClearingEvidence=true/);
    assert.match(result.errors.join("\n"), /reconnect/);
    assert.match(result.errors.join("\n"), /bounded reply/);
    assert.match(result.errors.join("\n"), /terminal rejection/);
  });

  it("rejects reports that contain secret-like or raw Feishu identifier content", () => {
    const report = buildGateClearingReport();
    report.checks.push({
      name: "unsafe_debug",
      ok: true,
      replyPreview: "Bearer live-token app_secret=plain sk-live-secret oc_raw_chat_id ou_raw_user_id"
    });

    const result = validateFeishuBotLiveReport(report);

    assert.equal(result.ok, false);
    assert.equal(result.readyForHumanReview, false);
    assert.match(result.errors.join("\n"), /secret-like content/);
    assert.match(result.errors.join("\n"), /raw Feishu identifier/);
  });

  it("parses the report path and json flag", () => {
    const parsed = parseFeishuBotLiveReportAuditArgs(["--json", "docs/reports/feishu-live.json"]);

    assert.deepEqual(parsed, {
      ok: true,
      reportPath: "docs/reports/feishu-live.json",
      json: true
    });
  });

  it("ignores the pnpm argument separator before report path arguments", () => {
    const parsed = parseFeishuBotLiveReportAuditArgs(["--", "docs/reports/feishu-live.json"]);

    assert.deepEqual(parsed, {
      ok: true,
      reportPath: "docs/reports/feishu-live.json",
      json: false
    });
  });

  it("rejects missing report paths", () => {
    const parsed = parseFeishuBotLiveReportAuditArgs(["--json"]);

    assert.equal(parsed.ok, false);
    assert.match(parsed.reason, /report path/);
  });
});

function buildGateClearingReport() {
  return {
    ok: true,
    mode: "real_feishu_bot_long_connection",
    gateClearingEvidence: true,
    publicCallbackRequired: false,
    gatewayUrl: "http://127.0.0.1:48731",
    eventSubscription: "im.message.receive_v1",
    durationMs: 120000,
    maxEvents: 2,
    sendReplies: true,
    requireReconnect: true,
    counts: {
      connected: 1,
      reconnecting: 1,
      reconnected: 1,
      receivedEvents: 2,
      acceptedEvents: 1,
      terminalInputRejections: 1,
      replySent: 2,
      replyFailures: 0
    },
    checks: [
      { name: "connection_connected", ok: true, state: "connected" },
      { name: "receive_route", ok: true, route: "status", replyPreview: "OpenForge status\nProjects: 1" },
      { name: "bounded_reply_sent", ok: true, msgType: "text", receiveIdType: "chat_id" },
      {
        name: "terminal_input_rejected",
        ok: true,
        rejectionCode: "feishu_terminal_input_rejected",
        replyPreview: "OpenForge rejected terminal input from Feishu."
      },
      { name: "rejection_reply_sent", ok: true, msgType: "text", receiveIdType: "chat_id" },
      { name: "connection_reconnecting", ok: true, state: "reconnecting" },
      { name: "connection_reconnected", ok: true, state: "reconnected" }
    ],
    caveat: "This report contains real receive, bounded reply, reconnect, and terminal-rejection evidence; review redaction before moving FEISHU-BOT-WS."
  };
}
