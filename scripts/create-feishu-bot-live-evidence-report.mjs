import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { validateFeishuBotLiveReport } from "./audit-feishu-bot-live-report.mjs";

export function parseFeishuBotLiveEvidenceReportArgs(argv = process.argv.slice(2)) {
  const parsed = {
    reportPath: undefined,
    outputPath: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--") {
      continue;
    }
    if (item === "--report") {
      parsed.reportPath = requireValue(argv, index, item);
      index += 1;
      continue;
    }
    if (item === "--output") {
      parsed.outputPath = requireValue(argv, index, item);
      index += 1;
      continue;
    }
    if (item === "--help") {
      return { ok: true, help: true };
    }
    return { ok: false, reason: `Unknown argument: ${item}` };
  }

  if (!parsed.reportPath) return { ok: false, reason: "--report <report.json> is required" };
  return {
    ok: true,
    reportPath: parsed.reportPath,
    outputPath: parsed.outputPath
  };
}

export function buildFeishuBotLiveEvidenceReport(report, options = {}) {
  const audit = validateFeishuBotLiveReport(report);
  if (!audit.ok) {
    return {
      ok: false,
      readyForHumanReview: false,
      gateClearingEvidence: false,
      errors: audit.errors
    };
  }

  const counts = report.counts ?? {};
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const generatedAt = sanitizeLine(options.generatedAt ?? new Date().toISOString());
  const commit = sanitizeLine(options.commit ?? "unknown");
  const reportPath = sanitizeLine(options.reportPath ?? "unspecified");
  const markdown = `# Feishu Bot Long-Connection Evidence Report

Generated: ${generatedAt}
Commit: ${commit}
Source report: ${reportPath}

## Gate Review Status

- Gate: \`FEISHU-BOT-WS\`
- Registry status before review: \`FEISHU-BOT-WS=Caveat\`
- Audit result: ready for maintainer review
- Report gate-clearing marker: ${report.gateClearingEvidence === true ? "true" : "false"}
- Report generator gate-clearing marker: false
- Public callback required: ${report.publicCallbackRequired === true ? "true" : "false"}
- Event subscription: \`${sanitizeLine(report.eventSubscription)}\`

This report summarizes a saved, audited Feishu bot long-connection smoke output.
It does not update \`docs/EXTERNAL-EVIDENCE-GATES.md\` and does not by itself
move \`FEISHU-BOT-WS\` to \`Pass\`; a maintainer must review and link the
artifact before any registry state change.

## Evidence Summary

- Received events: ${numberSummary(counts.receivedEvents)}
- Accepted bounded commands: ${numberSummary(counts.acceptedEvents)}
- Bounded replies sent: ${numberSummary(counts.replySent)}
- Terminal input rejections: ${numberSummary(counts.terminalInputRejections)}
- Reconnect observations: ${numberSummary(counts.reconnected)}
- Reply failures: ${numberSummary(counts.replyFailures)}
- Gateway URL summary: ${sanitizeLine(report.gatewayUrl)}
- Duration ms: ${numberSummary(report.durationMs)}
- Max events: ${numberSummary(report.maxEvents)}

## Check Summary

${checks.map((check) => `- ${formatCheckSummary(check)}`).join("\n")}

## Redaction And Storage Boundary

- This report is not raw Feishu event storage.
- Raw event bodies, WebSocket frames, signatures, nonces, private chat content,
  app secrets, verification tokens, encrypt keys, provider keys, JWTs, and
  attach tokens are not included.
- Chat and user identifiers must remain shortened or redacted in the source
  JSON report before this Markdown is linked.

## Recommended Maintainer Decision

- If the source report is attached, audit output is preserved, and the
  observations match the gate clearing condition, maintainer may consider
  moving \`FEISHU-BOT-WS\` from \`Caveat\` to \`Pass\`.
- If any live prerequisite is missing, keep \`FEISHU-BOT-WS\` as \`Caveat\`
  and record the missing external evidence.
`;

  return {
    ok: true,
    readyForHumanReview: true,
    gateClearingEvidence: false,
    errors: [],
    markdown
  };
}

export function createFeishuBotLiveEvidenceReportFile(reportPath, options = {}) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      readyForHumanReview: false,
      gateClearingEvidence: false,
      errors: [`Report could not be read or parsed: ${errorMessage(error)}`]
    };
  }

  const result = buildFeishuBotLiveEvidenceReport(report, {
    reportPath,
    generatedAt: options.generatedAt,
    commit: options.commit ?? currentCommit()
  });
  if (!result.ok || !options.outputPath) return result;

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, result.markdown, "utf8");
  return result;
}

function formatCheckSummary(check) {
  if (!isRecord(check)) return "`unknown`: invalid";
  const parts = [`\`${sanitizeLine(check.name)}\`: ${check.ok === true ? "ok" : "not ok"}`];
  if (typeof check.route === "string") parts.push(`route=${sanitizeLine(check.route)}`);
  if (typeof check.rejectionCode === "string") parts.push(`rejection=${sanitizeLine(check.rejectionCode)}`);
  if (typeof check.state === "string") parts.push(`state=${sanitizeLine(check.state)}`);
  if (typeof check.msgType === "string") parts.push(`msgType=${sanitizeLine(check.msgType)}`);
  if (typeof check.receiveIdType === "string") parts.push(`receiveIdType=${sanitizeLine(check.receiveIdType)}`);
  return parts.join(" ");
}

function numberSummary(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "unknown";
}

function sanitizeLine(value) {
  return String(value ?? "unknown")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._-]+/giu, "[REDACTED]")
    .replace(/\bapp[_-]?secret\s*[:=]\s*\S+/giu, "app_secret=[REDACTED]")
    .replace(/\b(?:o[cu]|om|cli)_[A-Za-z0-9._-]+/gu, (match) => `${match.slice(0, 4)}...[REDACTED]`)
    .slice(0, 220) ?? "unknown";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function currentCommit() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true
  });
  return result.status === 0 ? sanitizeLine(result.stdout) : "unknown";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function printHelp() {
  console.log(`Usage: node scripts/create-feishu-bot-live-evidence-report.mjs --report <report.json> [--output <report.md>]

Options:
  --report <path>  Saved JSON output from pnpm smoke:feishu-bot-live.
  --output <path>  Optional Markdown report destination. Defaults to stdout.
`);
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    const parsed = parseFeishuBotLiveEvidenceReportArgs();
    if (!parsed.ok) {
      console.error(JSON.stringify({ ok: false, readyForHumanReview: false, gateClearingEvidence: false, errors: [parsed.reason] }, null, 2));
      process.exitCode = 1;
    } else if (parsed.help) {
      printHelp();
    } else {
      const result = createFeishuBotLiveEvidenceReportFile(parsed.reportPath, {
        outputPath: parsed.outputPath
      });
      if (!result.ok) {
        console.error(JSON.stringify(result, null, 2));
        process.exitCode = 1;
      } else if (!parsed.outputPath) {
        process.stdout.write(result.markdown);
      } else {
        console.log(JSON.stringify({
          ok: true,
          readyForHumanReview: true,
          gateClearingEvidence: false,
          outputPath: parsed.outputPath
        }, null, 2));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, readyForHumanReview: false, gateClearingEvidence: false, errors: [errorMessage(error)] }, null, 2));
    process.exitCode = 1;
  }
}
