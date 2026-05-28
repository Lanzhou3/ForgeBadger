import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPOSITORY = "Lanzhou3/OpenForge";

export const EXPECTED_TRIAL_ISSUE_ROUTES = [
  {
    number: 3,
    gate: "LIVE-PROVIDER",
    title: "Record live Copilot provider smoke with disposable credential",
    labels: ["product-hardening"]
  },
  {
    number: 4,
    gate: "WINDOWS-WSL",
    title: "Run physical Windows and WSL OpenForge smoke",
    labels: ["trial-feedback", "product-hardening"]
  },
  {
    number: 5,
    gate: "FIRST-USER-FEEDBACK",
    title: "Collect first-user Copilot hardening feedback",
    labels: ["trial-feedback", "product-hardening"]
  }
];

export async function validateTrialIssueRoutes(options = {}) {
  const errors = [];
  const checked = [];
  const fetchIssue = options.fetchIssue ?? ((route) => fetchIssueWithGh(route, options));

  for (const route of EXPECTED_TRIAL_ISSUE_ROUTES) {
    let issue;
    try {
      issue = await fetchIssue(route);
    } catch (error) {
      errors.push(`GitHub issue #${route.number} could not be read: ${error.message}`);
      continue;
    }
    if (!issue) {
      errors.push(`GitHub issue #${route.number} could not be read.`);
      continue;
    }

    checked.push({
      number: issue.number ?? route.number,
      gate: route.gate,
      title: issue.title ?? "",
      state: issue.state ?? "",
      url: issue.url ?? ""
    });

    if (issue.number !== route.number) {
      errors.push(`GitHub issue #${route.number} returned unexpected number: ${issue.number}`);
    }
    if (issue.state !== "OPEN") {
      errors.push(`GitHub issue #${route.number} must remain OPEN for trial routing; found ${issue.state}.`);
    }
    if (issue.title !== route.title) {
      errors.push(`GitHub issue #${route.number} title must remain: ${route.title}`);
    }

    const labels = issueLabels(issue);
    for (const label of route.labels) {
      if (!labels.has(label)) {
        errors.push(`GitHub issue #${route.number} must keep label: ${label}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    gateClearingEvidence: false,
    checked,
    errors
  };
}

function fetchIssueWithGh(route, options) {
  const repository = options.repository ?? process.env.OPENFORGE_TRIAL_ISSUE_ROUTES_REPO ?? DEFAULT_REPOSITORY;
  const output = execFileSync(
    "gh",
    [
      "issue",
      "view",
      String(route.number),
      "--repo",
      repository,
      "--json",
      "number,title,state,labels,url"
    ],
    { encoding: "utf8" }
  );
  return JSON.parse(output);
}

function issueLabels(issue) {
  return new Set(
    (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean)
  );
}

export function parseTrialIssueRoutesCliArgs(args) {
  const parsed = { repository: undefined };
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseTrialIssueRoutesCliArgs(process.argv.slice(2));
    const result = await validateTrialIssueRoutes(args);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
