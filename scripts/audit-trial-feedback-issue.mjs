import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditTrialFeedbackPacket } from "./audit-trial-feedback-packet.mjs";

export const DEFAULT_REPOSITORY = "Lanzhou3/ForgeBadger";
const REQUIRED_LABEL = "trial-feedback";
export const TRIAL_FEEDBACK_ROUTE_TRACKER_ISSUES = new Map([
  [3, "Record live Copilot provider smoke with disposable credential"],
  [4, "Run physical Windows and WSL ForgeBadger smoke"],
  [5, "Collect first-user Copilot hardening feedback"]
]);

export async function auditTrialFeedbackIssue(options = {}) {
  const issueNumber = options.issueNumber;
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("issueNumber must be a positive integer.");
  }

  const fetchIssue = options.fetchIssue ?? fetchIssueWithGh;
  let issue;
  try {
    issue = await fetchIssue({
      repository: options.repository ?? process.env.FORGEBADGER_TRIAL_FEEDBACK_ISSUE_REPO ?? process.env.OPENFORGE_TRIAL_FEEDBACK_ISSUE_REPO ?? DEFAULT_REPOSITORY,
      issueNumber
    });
  } catch (error) {
    return failedResult({ issueNumber, errors: [`GitHub issue #${issueNumber} could not be read: ${error.message}`] });
  }

  const errors = [];
  if (!issue) {
    return failedResult({ issueNumber, errors: ["GitHub issue could not be read."] });
  }

  const labels = issueLabels(issue);
  if (!labels.has(REQUIRED_LABEL)) {
    errors.push(`GitHub issue #${issueNumber} must keep label: ${REQUIRED_LABEL}`);
  }
  const trackerTitle = TRIAL_FEEDBACK_ROUTE_TRACKER_ISSUES.get(issueNumber);
  if (trackerTitle && issue.title === trackerTitle) {
    errors.push(`GitHub issue #${issueNumber} is a route tracker, not a completed feedback packet.`);
  }

  const packet = `${issueFormBodyToTrialFeedbackPacket(issue.body ?? "")}\n\n${issue.body ?? ""}`;
  const packetAudit = auditTrialFeedbackPacket(packet);
  errors.push(...packetAudit.errors);

  return {
    ok: errors.length === 0,
    readyForHumanTriage: errors.length === 0,
    gateClearingEvidence: false,
    issue: summarizeIssue(issue, issueNumber),
    errors,
    warnings: errors.length === 0 ? packetAudit.warnings : []
  };
}

export function parseTrialFeedbackIssueAuditCliArgs(args) {
  const parsed = { issueNumber: undefined, repository: undefined };
  for (const arg of args) {
    if (arg === "--") {
      continue;
    }
    if (arg.startsWith("--issue=")) {
      const value = Number(arg.slice("--issue=".length));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--issue must be a positive integer.");
      }
      parsed.issueNumber = value;
      continue;
    }
    if (arg === "--issue") {
      throw new Error("Use --issue=<number>.");
    }
    if (arg.startsWith("--repo=")) {
      parsed.repository = arg.slice("--repo=".length);
      continue;
    }
    if (arg === "--repo") {
      throw new Error("Use --repo=<owner/name>.");
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.issueNumber === undefined) {
    throw new Error("Usage: node scripts/audit-trial-feedback-issue.mjs --issue=<number> [--repo=<owner/name>]");
  }
  return parsed;
}

function fetchIssueWithGh(options) {
  const output = execFileSync(
    "gh",
    [
      "issue",
      "view",
      String(options.issueNumber),
      "--repo",
      options.repository,
      "--json",
      "number,title,state,labels,body,url"
    ],
    { encoding: "utf8" }
  );
  return JSON.parse(output);
}

function issueFormBodyToTrialFeedbackPacket(body) {
  const fields = parseIssueFormSections(body);
  const environment = fields.get("Environment") ?? "";
  const coreTrial = fields.get("Core trial path") ?? "";
  const copilot = fields.get("Copilot smoke evidence") ?? "";
  const ownerRoute = fields.get("Owner, disposition, and follow-up route") ?? "";
  const diagnostics = fields.get("Diagnostics and browser evidence") ?? "";
  const reproduction = fields.get("Reproduction steps for each issue") ?? "";

  return `# ForgeBadger Trial Feedback Packet

## Summary

- Result: ${singleLine(fields.get("Trial result"))}
- Affected surface: ${singleLine(fields.get("Affected surface"))}
- Startup path: ${singleLine(fields.get("Startup path"))}
- ForgeBadger version or commit: ${fieldValue(environment, "ForgeBadger version or commit")}
- Operating system: ${fieldValue(environment, "OS")}
- Shell: ${fieldValue(environment, "Shell")}
- Browser and version: ${fieldValue(environment, "Browser")}

## Dependency Versions

- node --version: ${fieldValue(environment, "node --version")}
- tmux -V: ${fieldValue(environment, "tmux -V")}
- claude --version: ${fieldValue(environment, "claude --version")}
- forgebadger doctor summary: ${singleLine(fields.get("forgebadger doctor summary"))}

## Diagnostics Export

- Diagnostics export attached: ${fieldValue(diagnostics, "Diagnostics export attached")}
- Export path used: Settings -> Export diagnostics JSON
- Redaction review completed: ${hasCheckedSafety(fields.get("Safety confirmation")) ? "yes" : ""}

## Reproduction Steps

${numberedSteps(reproduction)}

## Expected Behavior

${extractExpectedActual(reproduction, "Expected")}

## Actual Behavior

${extractExpectedActual(reproduction, "Actual")}

## Triage

- Category: ${singleLine(fields.get("Category"))}
- Severity: ${singleLine(fields.get("severity"))}
- Mapped requirement: ${singleLine(fields.get("Mapped UX requirement"))}
- Owner: ${fieldValue(ownerRoute, "Owner")}
- Disposition: ${fieldValue(ownerRoute, "Disposition")}
- Follow-up route: ${fieldValue(ownerRoute, "Follow-up route")}
- Next action or no-action rationale: ${fieldValue(ownerRoute, "Next action or no-action rationale")}
- Caveat status: ${caveatStatus(fields.get("Trial result"))}

## Browser Evidence

- Console errors: ${fieldValue(diagnostics, "Browser console error summary")}
- Network failures: ${fieldValue(diagnostics, "Browser network failure summary")}
- pnpm smoke:copilot-provider result: ${fieldValue(copilot, "pnpm smoke:copilot-provider result")}
- Provider smoke skip or failure reason: ${fieldValue(copilot, "Provider smoke skip or failure reason")}
- Copilot provider with active model configured: ${fieldValue(copilot, "Provider with active model configured")}
- Copilot prompt used: ${fieldValue(copilot, "Prompt used")}
- Copilot read-tool evidence observed: ${fieldValue(copilot, "Read-tool evidence observed")}
- Copilot pending-action approve/reject result: ${fieldValue(copilot, "Pending-action approve/reject result")}
- Copilot memory write proposal tested: ${fieldValue(copilot, "Memory write proposal tested")}
- Confirmed no terminal/shell/Codex turn input in Copilot: ${fieldValue(copilot, "Confirmed no terminal/shell/Codex turn input in Copilot")}
- Terminal attach result: ${fieldValue(coreTrial, "Browser terminal attach")}
- Terminal input/output result summary, no raw transcript: ${fieldValue(coreTrial, "Input/output")}
- Terminal resize result: ${fieldValue(coreTrial, "Resize")}
- Refresh/reconnect result: ${fieldValue(coreTrial, "Refresh/reconnect")}
- Stop-session result: ${fieldValue(coreTrial, "Stop")}
- Gateway/Web restart recovery result: ${fieldValue(coreTrial, "Gateway/Web restart recovery")}
- Screenshots or written observations, redacted: ${fieldValue(diagnostics, "Screenshots or notes, redacted")}

## Bounded Support Notes

- Gateway log summary, no raw log attachment: ${fieldValue(fields.get("Startup and health checks") ?? "", "Gateway health envelope")}
- Web log summary, no raw log attachment: ${fieldValue(fields.get("Startup and health checks") ?? "", "/login result")}
- Relevant command result summary, no raw private output: ${singleLine(fields.get("forgebadger doctor summary"))}
`;
}

function parseIssueFormSections(body) {
  const sections = new Map();
  const matches = [...String(body ?? "").matchAll(/^###\s+(.+?)\s*$/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const start = current.index + current[0].length;
    const end = next?.index ?? body.length;
    sections.set(current[1].trim(), body.slice(start, end).trim());
  }
  return sections;
}

function fieldValue(source, label) {
  const escaped = escapeRegex(label);
  const value = String(source ?? "").match(new RegExp(`^${escaped}:[ \\t]*(.+?)[ \\t]*$`, "im"))?.[1]?.trim();
  return value ?? "";
}

function numberedSteps(source) {
  const lines = String(source ?? "")
    .split(/\r?\n/)
    .filter((line) => /^\s*\d+\.\s+/.test(line.trim()));
  return lines.length > 0 ? lines.join("\n") : "";
}

function extractExpectedActual(source, label) {
  const match = String(source ?? "").match(new RegExp(`^${escapeRegex(label)}:[ \\t]*(.+?)[ \\t]*$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function caveatStatus(result) {
  const normalized = singleLine(result).toLowerCase();
  if (normalized === "pass") return "none";
  if (normalized === "blocked") return "blocked";
  if (normalized === "pass with caveats") return "pass with caveats";
  return "";
}

function hasCheckedSafety(source) {
  return /\[x\].*reviewed this issue/i.test(source ?? "") && /\[x\].*removed/i.test(source ?? "");
}

function singleLine(value) {
  return String(value ?? "").split(/\r?\n/)[0]?.trim() ?? "";
}

function issueLabels(issue) {
  return new Set(
    (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean)
  );
}

function summarizeIssue(issue, issueNumber) {
  return {
    number: issue.number ?? issueNumber,
    title: issue.title ?? "",
    state: issue.state ?? "",
    url: issue.url ?? ""
  };
}

function failedResult({ issueNumber, errors }) {
  return {
    ok: false,
    readyForHumanTriage: false,
    gateClearingEvidence: false,
    issue: { number: issueNumber, title: "", state: "", url: "" },
    errors,
    warnings: []
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseTrialFeedbackIssueAuditCliArgs(process.argv.slice(2));
    const result = await auditTrialFeedbackIssue(args);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
