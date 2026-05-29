import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateExternalEvidenceGates } from "./validate-external-evidence-gates.mjs";
import { validateTrialFeedbackIntake } from "./validate-trial-feedback-intake.mjs";
import { validateTrialIssueRoutes } from "./validate-trial-issue-routes.mjs";

const READINESS_CHECKS = [
  {
    id: "trial-intake",
    label: "Trial intake materials",
    runner: (options) => options.validateIntake()
  },
  {
    id: "trial-issue-routes",
    label: "Trial issue routes",
    runner: (options) => options.validateIssueRoutes({ repository: options.repository })
  },
  {
    id: "external-evidence-gates",
    label: "External evidence gate registry",
    runner: (options) => options.validateExternalGates()
  }
];

export async function validateTrialReadiness(options = {}) {
  const normalizedOptions = {
    ...options,
    validateIntake: options.validateIntake ?? validateTrialFeedbackIntake,
    validateIssueRoutes: options.validateIssueRoutes ?? validateTrialIssueRoutes,
    validateExternalGates: options.validateExternalGates ?? validateExternalEvidenceGates
  };
  const checks = [];
  const errors = [];

  for (const check of READINESS_CHECKS) {
    let result;
    try {
      result = await check.runner(normalizedOptions);
    } catch (error) {
      result = { ok: false, errors: [error.message] };
    }

    const checkErrors = Array.isArray(result.errors) ? result.errors : [];
    if (result.ok !== true && checkErrors.length === 0) {
      checkErrors.push(`${check.label} failed without details.`);
    }
    if (result.gateClearingEvidence === true) {
      checkErrors.push(`${check.label} must not claim gate-clearing evidence.`);
    }
    const checkOk = result.ok === true && checkErrors.length === 0;
    checks.push({
      id: check.id,
      label: check.label,
      ok: checkOk,
      errors: checkErrors,
      checked: result.checked ?? undefined,
      gateClearingEvidence: result.gateClearingEvidence === true
    });

    for (const error of checkErrors) {
      errors.push(`${check.id}: ${error}`);
    }
  }

  return {
    ok: errors.length === 0,
    gateClearingEvidence: false,
    checks,
    errors,
    nextSteps: errors.length === 0 ? readyNextSteps() : blockedNextSteps()
  };
}

export function parseTrialReadinessCliArgs(args) {
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

function readyNextSteps() {
  return [
    "Run the first-user trial with docs/TRIAL-RUNBOOK.md and docs/TRIAL-CHECKLIST.md.",
    "Complete or file a redacted feedback packet before maintainer triage.",
    "Run pnpm trial:feedback-audit -- <packet.md> before using Markdown feedback as evidence.",
    "Run pnpm trial:feedback-issue-audit -- --issue=<number> before using GitHub issue feedback as evidence.",
    "Run pnpm trial:feedback-issues-audit to scan non-tracker GitHub feedback candidates before maintainer triage."
  ];
}

function blockedNextSteps() {
  return [
    "Fix readiness errors before starting a real first-user collection round.",
    "Do not change external gate states until required artifacts are linked and reviewed."
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseTrialReadinessCliArgs(process.argv.slice(2));
    const result = await validateTrialReadiness(args);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
