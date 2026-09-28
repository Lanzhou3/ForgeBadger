import fs from "node:fs";
import { pathToFileURL } from "node:url";

const EVENT_SUBSCRIPTION = "im.message.receive_v1";
const LIVE_MODE = "real_feishu_bot_long_connection";

export function parseFeishuBotLiveReportAuditArgs(argv = process.argv.slice(2)) {
  const result = {
    json: false,
    reportPath: undefined
  };
  for (const item of argv) {
    if (item === "--") {
      continue;
    }
    if (item === "--json") {
      result.json = true;
      continue;
    }
    if (item.startsWith("--")) {
      return { ok: false, reason: `Unknown flag: ${item}` };
    }
    if (result.reportPath) {
      return { ok: false, reason: `Unexpected argument: ${item}` };
    }
    result.reportPath = item;
  }
  if (!result.reportPath) return { ok: false, reason: "A Feishu bot live report path is required" };
  return {
    ok: true,
    reportPath: result.reportPath,
    json: result.json
  };
}

export function validateFeishuBotLiveReport(report) {
  const errors = [];
  if (!isRecord(report)) {
    return auditResult(["Report must be a JSON object"]);
  }

  requireEqual(report.mode, LIVE_MODE, "mode must be real_feishu_bot_long_connection", errors);
  requireEqual(report.ok, true, "report ok must be true", errors);
  requireEqual(report.gateClearingEvidence, true, "report gateClearingEvidence=true is required", errors);
  requireEqual(report.publicCallbackRequired, false, "publicCallbackRequired must be false", errors);
  requireEqual(report.eventSubscription, EVENT_SUBSCRIPTION, "eventSubscription must be im.message.receive_v1", errors);

  const counts = isRecord(report.counts) ? report.counts : {};
  requirePositive(counts.connected, "connected count", errors);
  requirePositive(counts.receivedEvents, "real receive evidence", errors);
  requirePositive(counts.acceptedEvents, "accepted bounded command evidence", errors);
  requirePositive(counts.replySent, "bounded reply evidence", errors);
  requirePositive(counts.reconnecting, "reconnect attempt evidence", errors);
  requirePositive(counts.reconnected, "reconnect evidence", errors);
  requirePositive(counts.terminalInputRejections, "terminal rejection evidence", errors);
  requireEqual(counts.replyFailures ?? 0, 0, "replyFailures must be 0", errors);

  const checks = Array.isArray(report.checks) ? report.checks : [];
  if (checks.length === 0) errors.push("checks must contain live evidence entries");
  for (const check of checks) {
    if (!isRecord(check) || check.ok !== true) errors.push("all checks must be ok=true");
  }
  requireCheck(checks, "connection_connected", "connected lifecycle check", errors);
  requireCheck(checks, "connection_reconnecting", "reconnecting lifecycle check", errors);
  requireCheck(checks, "connection_reconnected", "reconnected lifecycle check", errors);
  requireCheck(checks, "receive_route", "bounded receive route check", errors, (check) => typeof check.route === "string");
  requireCheck(checks, "bounded_reply_sent", "bounded reply send check", errors, (check) => check.msgType === "text" && check.receiveIdType === "chat_id");
  requireCheck(checks, "terminal_input_rejected", "terminal rejection check", errors, (check) => check.rejectionCode === "feishu_terminal_input_rejected");
  requireCheck(checks, "rejection_reply_sent", "terminal rejection reply check", errors, (check) => check.msgType === "text" && check.receiveIdType === "chat_id");

  const serialized = JSON.stringify(report);
  if (containsSecretLikeContent(serialized)) {
    errors.push("Report contains secret-like content");
  }
  if (containsRawFeishuIdentifier(serialized)) {
    errors.push("Report contains raw Feishu identifier content");
  }

  return auditResult(errors);
}

export function auditFeishuBotLiveReportFile(reportPath) {
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return validateFeishuBotLiveReport(report);
  } catch (error) {
    return auditResult([`Report could not be read or parsed: ${errorMessage(error)}`]);
  }
}

function auditResult(errors) {
  return {
    ok: errors.length === 0,
    readyForHumanReview: errors.length === 0,
    gateClearingEvidence: false,
    errors
  };
}

function requireEqual(value, expected, message, errors) {
  if (value !== expected) errors.push(message);
}

function requirePositive(value, label, errors) {
  if (typeof value !== "number" || value <= 0) errors.push(`Missing ${label}`);
}

function requireCheck(checks, name, label, errors, predicate = () => true) {
  if (!checks.some((check) => isRecord(check) && check.name === name && predicate(check))) {
    errors.push(`Missing ${label}`);
  }
}

function containsSecretLikeContent(text) {
  return [
    /\bBearer\s+(?!\[REDACTED\])\S+/iu,
    /\bsk-[A-Za-z0-9._-]+/iu,
    /\bapp[_-]?secret\s*[:=]\s*(?!\[REDACTED\])\S+/iu,
    /\b(?:FEISHU|LARK)_APP_SECRET\s*[:=]/iu,
    /\b(?:FORGEBADGER|OPENFORGE)_TOKEN\s*[:=]/iu
  ].some((pattern) => pattern.test(text));
}

function containsRawFeishuIdentifier(text) {
  const matches = text.match(/\b(?:ou|oc|om|cli)_[A-Za-z0-9._-]{6,}/gu) ?? [];
  return matches.some((match) => !match.includes("..."));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function printHumanResult(result) {
  if (result.ok) {
    console.log("Feishu bot live report is ready for human gate review.");
    console.log("gateClearingEvidence: false");
    return;
  }
  console.error("Feishu bot live report is not ready for human gate review.");
  for (const error of result.errors) console.error(`- ${error}`);
}

if (isMainModule()) {
  const parsed = parseFeishuBotLiveReportAuditArgs();
  if (!parsed.ok) {
    console.error(JSON.stringify({ ok: false, readyForHumanReview: false, gateClearingEvidence: false, errors: [parsed.reason] }, null, 2));
    process.exitCode = 1;
  } else {
    const result = auditFeishuBotLiveReportFile(parsed.reportPath);
    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHumanResult(result);
    }
    if (!result.ok) process.exitCode = 1;
  }
}
