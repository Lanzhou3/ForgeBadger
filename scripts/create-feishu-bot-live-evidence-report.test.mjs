import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFeishuBotLiveEvidenceReport,
  parseFeishuBotLiveEvidenceReportArgs
} from "./create-feishu-bot-live-evidence-report.mjs";

describe("Feishu bot live evidence report generator", () => {
  it("builds a redacted Markdown report from an audited live smoke report", () => {
    const result = buildFeishuBotLiveEvidenceReport(buildGateClearingReport(), {
      reportPath: "docs/reports/feishu-live.json",
      generatedAt: "2026-06-14T14:30:00+08:00",
      commit: "abc1234"
    });

    assert.equal(result.ok, true);
    assert.equal(result.readyForHumanReview, true);
    assert.equal(result.gateClearingEvidence, false);
    assert.match(result.markdown, /# Feishu Bot Long-Connection Evidence Report/);
    assert.match(result.markdown, /Generated: 2026-06-14T14:30:00\+08:00/);
    assert.match(result.markdown, /Commit: abc1234/);
    assert.match(result.markdown, /Source report: docs\/reports\/feishu-live\.json/);
    assert.match(result.markdown, /Registry status before review: `FEISHU-BOT-WS=Caveat`/);
    assert.match(result.markdown, /Audit result: ready for maintainer review/);
    assert.match(result.markdown, /Public callback required: false/);
    assert.match(result.markdown, /Event subscription: `im\.message\.receive_v1`/);
    assert.match(result.markdown, /Received events: 2/);
    assert.match(result.markdown, /Bounded replies sent: 2/);
    assert.match(result.markdown, /Terminal input rejections: 1/);
    assert.match(result.markdown, /Reconnect observations: 1/);
    assert.match(result.markdown, /- `receive_route`: ok route=status/);
    assert.match(result.markdown, /- `terminal_input_rejected`: ok rejection=feishu_terminal_input_rejected/);
    assert.match(result.markdown, /This report is not raw Feishu event storage/);
    assert.doesNotMatch(result.markdown, /oc_live_chat/);
    assert.doesNotMatch(result.markdown, /ou_live_user/);
    assert.doesNotMatch(result.markdown, /app_secret=plain/);
  });

  it("refuses to generate a report when the live smoke report fails audit", () => {
    const report = buildGateClearingReport();
    report.gateClearingEvidence = false;
    report.counts.reconnected = 0;

    const result = buildFeishuBotLiveEvidenceReport(report, {
      reportPath: "docs/reports/feishu-live.json"
    });

    assert.equal(result.ok, false);
    assert.equal(result.readyForHumanReview, false);
    assert.equal(result.gateClearingEvidence, false);
    assert.equal(result.markdown, undefined);
    assert.match(result.errors.join("\n"), /gateClearingEvidence=true/);
    assert.match(result.errors.join("\n"), /reconnect/);
  });

  it("parses report and output CLI arguments", () => {
    assert.deepEqual(parseFeishuBotLiveEvidenceReportArgs([
      "--report",
      "docs/reports/feishu-live.json",
      "--output",
      "docs/reports/feishu-live.md"
    ]), {
      ok: true,
      reportPath: "docs/reports/feishu-live.json",
      outputPath: "docs/reports/feishu-live.md"
    });
  });

  it("ignores the pnpm argument separator before named CLI arguments", () => {
    assert.deepEqual(parseFeishuBotLiveEvidenceReportArgs([
      "--",
      "--report",
      "docs/reports/feishu-live.json",
      "--output",
      "docs/reports/feishu-live.md"
    ]), {
      ok: true,
      reportPath: "docs/reports/feishu-live.json",
      outputPath: "docs/reports/feishu-live.md"
    });
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
