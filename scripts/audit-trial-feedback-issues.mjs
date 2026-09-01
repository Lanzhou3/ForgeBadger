import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditTrialFeedbackIssue,
  TRIAL_FEEDBACK_ROUTE_TRACKER_ISSUES
} from "./audit-trial-feedback-issue.mjs";

export const DEFAULT_REPOSITORY = "Lanzhou3/ForgeBadger";
const DEFAULT_LIMIT = 50;

export async function auditTrialFeedbackIssues(options = {}) {
  const repository = options.repository ?? process.env.FORGEBADGER_TRIAL_FEEDBACK_ISSUE_REPO ?? DEFAULT_REPOSITORY;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const fetchIssues = options.fetchIssues ?? fetchTrialFeedbackIssuesWithGh;
  const auditIssue = options.auditIssue ?? auditTrialFeedbackIssue;

  let issues;
  try {
    issues = await fetchIssues({ repository, limit });
  } catch (error) {
    return {
      ok: false,
      gateClearingEvidence: false,
      trackerIssueNumbers: [],
      candidateIssueNumbers: [],
      readyIssueNumbers: [],
      blockedIssueNumbers: [],
      audited: [],
      errors: [`GitHub trial-feedback issues could not be listed: ${error.message}`],
      nextSteps: ["Fix GitHub CLI access before auditing trial feedback issue candidates."]
    };
  }

  const trackerIssues = [];
  const candidates = [];
  for (const issue of issues ?? []) {
    if (isRouteTrackerIssue(issue)) {
      trackerIssues.push(issue);
    } else {
      candidates.push(issue);
    }
  }

  const audited = [];
  const errors = [];
  for (const issue of candidates) {
    const result = await auditIssue({ repository, issueNumber: issue.number });
    audited.push(result);
    if (result.gateClearingEvidence === true) {
      errors.push(`GitHub issue #${issue.number} audit must not claim gate-clearing evidence.`);
    }
    if (result.ok !== true || result.readyForHumanTriage !== true) {
      const details = Array.isArray(result.errors) && result.errors.length > 0
        ? result.errors.join("; ")
        : "not ready for human triage";
      errors.push(`GitHub issue #${issue.number} is not ready for human triage: ${details}`);
    }
  }

  const readyIssueNumbers = audited
    .filter((result) => result.ok === true && result.readyForHumanTriage === true)
    .map((result) => result.issue?.number)
    .filter(Number.isInteger);
  const blockedIssueNumbers = candidates
    .map((issue) => issue.number)
    .filter((number) => !readyIssueNumbers.includes(number));

  return {
    ok: errors.length === 0,
    gateClearingEvidence: false,
    trackerIssueNumbers: trackerIssues.map((issue) => issue.number),
    candidateIssueNumbers: candidates.map((issue) => issue.number),
    readyIssueNumbers,
    blockedIssueNumbers,
    audited: audited.map(summarizeAuditResult),
    errors,
    nextSteps: buildNextSteps({ candidates, readyIssueNumbers, blockedIssueNumbers })
  };
}

export function parseTrialFeedbackIssuesAuditCliArgs(args) {
  const parsed = { repository: undefined, limit: DEFAULT_LIMIT };
  for (const arg of args) {
    if (arg === "--") {
      continue;
    }
    if (arg.startsWith("--repo=")) {
      parsed.repository = arg.slice("--repo=".length);
      continue;
    }
    if (arg === "--repo") {
      throw new Error("Use --repo=<owner/name>.");
    }
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit must be a positive integer.");
      }
      parsed.limit = value;
      continue;
    }
    if (arg === "--limit") {
      throw new Error("Use --limit=<number>.");
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function fetchTrialFeedbackIssuesWithGh(options) {
  const output = execFileSync(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      options.repository,
      "--label",
      "trial-feedback",
      "--state",
      "all",
      "--limit",
      String(options.limit),
      "--json",
      "number,title,state,labels,url"
    ],
    { encoding: "utf8" }
  );
  return JSON.parse(output);
}

function isRouteTrackerIssue(issue) {
  return TRIAL_FEEDBACK_ROUTE_TRACKER_ISSUES.get(issue.number) === issue.title;
}

function summarizeAuditResult(result) {
  return {
    ok: result.ok === true,
    readyForHumanTriage: result.readyForHumanTriage === true,
    gateClearingEvidence: result.gateClearingEvidence === true,
    issue: result.issue,
    errors: result.errors ?? [],
    warnings: result.warnings ?? []
  };
}

function buildNextSteps({ candidates, readyIssueNumbers, blockedIssueNumbers }) {
  if (candidates.length === 0) {
    return [
      "No completed feedback candidate issues found.",
      "Collect a real first-user trial packet through docs/TRIAL-RUNBOOK.md and the GitHub issue form."
    ];
  }
  if (blockedIssueNumbers.length > 0) {
    return blockedIssueNumbers.map(
      (number) => `Run pnpm trial:feedback-issue-audit -- --issue=${number} and fix the reported packet gaps before maintainer triage.`
    );
  }
  return readyIssueNumbers.map(
    (number) => `GitHub issue #${number} is ready for maintainer triage, but it is not automatic gate-clearing evidence.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseTrialFeedbackIssuesAuditCliArgs(process.argv.slice(2));
    const result = await auditTrialFeedbackIssues(args);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
