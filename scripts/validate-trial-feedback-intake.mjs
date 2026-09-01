import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const DEFAULT_GITHUB_ISSUE_FORM_PATH = path.join(
  REPO_ROOT,
  ".github",
  "ISSUE_TEMPLATE",
  "forgebadger-trial-feedback.yml"
);
const DEFAULT_MARKDOWN_TEMPLATE_PATH = path.join(REPO_ROOT, "docs", "TRIAL-FEEDBACK.md");
const DEFAULT_TRIAL_RUNBOOK_PATH = path.join(REPO_ROOT, "docs", "TRIAL-RUNBOOK.md");
const DEFAULT_TRIAL_CHECKLIST_PATH = path.join(REPO_ROOT, "docs", "TRIAL-CHECKLIST.md");
const DEFAULT_OPEN_SOURCE_READINESS_PATH = path.join(REPO_ROOT, "docs", "OPEN-SOURCE-READINESS.md");
const DEFAULT_SUPPORT_DIAGNOSTICS_PATH = path.join(REPO_ROOT, "docs", "SUPPORT-DIAGNOSTICS.md");
const DEFAULT_ROOT_README_PATH = path.join(REPO_ROOT, "README.md");
const DEFAULT_ZH_CN_README_PATH = path.join(REPO_ROOT, "docs", "README.zh-CN.md");
const DEFAULT_ZH_TW_README_PATH = path.join(REPO_ROOT, "docs", "README.zh-TW.md");

export const REQUIRED_GITHUB_FIELDS = [
  "result",
  "affected_surface",
  "startup_path",
  "environment",
  "doctor",
  "startup_health",
  "core_trial",
  "copilot",
  "mapped_requirement",
  "category",
  "severity",
  "caveat_owner",
  "windows_wsl",
  "diagnostics",
  "reproduction",
  "safety"
];

export const REQUIRED_GITHUB_OPTIONS = {
  result: ["pass", "pass with caveats", "blocked"],
  affected_surface: [
    "onboarding",
    "dependency",
    "provider",
    "platform",
    "terminal",
    "Copilot",
    "Feishu",
    "Project Manager",
    "docs",
    "other"
  ],
  startup_path: ["npm/CLI", "source fallback", "other"],
  mapped_requirement: [
    "UX-01 dependency/runtime guidance",
    "UX-02 provider/model/credential recovery",
    "UX-03 Copilot conversation and approval state coherence",
    "UX-04 reproducible feedback quality",
    "UX-05 active-run monotonic ordering",
    "UX-06 partial API/query failure recovery",
    "UX-07 E2E mock/selector regression signal",
    "REL-* release evidence caveat",
    "other"
  ],
  category: ["dependency", "provider", "CLI", "platform", "Copilot", "docs", "E2E", "other"],
  severity: ["blocker", "high", "medium", "low"]
};

export const REQUIRED_GITHUB_FIELD_TYPES = {
  result: "dropdown",
  affected_surface: "dropdown",
  startup_path: "dropdown",
  environment: "textarea",
  doctor: "textarea",
  startup_health: "textarea",
  core_trial: "textarea",
  portfolio: "textarea",
  mapped_requirement: "dropdown",
  category: "dropdown",
  severity: "dropdown",
  caveat_owner: "textarea",
  windows_wsl: "textarea",
  diagnostics: "textarea",
  reproduction: "textarea",
  safety: "checkboxes"
};

export const REQUIRED_MARKDOWN_SECTIONS = [
  "Summary",
  "Dependency Versions",
  "Diagnostics Export",
  "Reproduction Steps",
  "Expected Behavior",
  "Actual Behavior",
  "Triage",
  "Browser Evidence",
  "Bounded Support Notes"
];

export const REQUIRED_RUNBOOK_PHRASES = [
  "Open Settings.",
  "Click **Export diagnostics JSON**.",
  "Do not ask first users to retrieve browser auth tokens from developer tools.",
  "Maintainer-only fallback"
];

export const REQUIRED_CHECKLIST_PHRASES = [
  "Use this checklist as the first-user trial entry point.",
  "docs/EXTERNAL-EVIDENCE-GATES.md",
  "`FEISHU-BOT-WS`",
  "Feishu Bot Long-Connection Smoke",
  "`pnpm trial:intake-validate`",
  "`pnpm trial:issue-routes-validate`",
  "`pnpm trial:readiness-validate`",
  "`pnpm trial:feedback-audit -- /tmp/forgebadger-trial-feedback.md`",
  "`pnpm trial:feedback-issue-audit -- --issue=<number>`",
  "`pnpm trial:feedback-issues-audit`",
  "`pnpm evidence:gates-validate`",
  "--output <report.json>",
  "`pnpm evidence:feishu-bot-live-audit -- <report.json>`",
  "`pnpm evidence:feishu-bot-live-report -- --report <report.json> --output <report.md>`",
  "`FIRST-USER-FEEDBACK`",
  "Templates and empty issue forms do not count as completed feedback.",
  "Follow-up route, phase, or issue:",
  "Redaction review completed:"
];

export const REQUIRED_FIRST_USER_ENTRYPOINT_PHRASES = [
  "docs/TRIAL-FEEDBACK.md",
  ".github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml",
  "pnpm trial:feedback-audit",
  "pnpm trial:feedback-issue-audit",
  "pnpm trial:feedback-issues-audit",
  "FIRST-USER-FEEDBACK"
];

export const REQUIRED_ROOT_README_TRIAL_ENTRYPOINT_PHRASES = [
  "docs/TRIAL-RUNBOOK.md",
  "docs/TRIAL-CHECKLIST.md",
  "docs/TROUBLESHOOTING.md",
  "docs/TRIAL-FEEDBACK.md",
  ".github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml"
];

export const REQUIRED_LOCALIZED_README_TRIAL_ENTRYPOINT_PHRASES = [
  "TRIAL-RUNBOOK.md",
  "TRIAL-CHECKLIST.md",
  "TROUBLESHOOTING.md",
  "TRIAL-FEEDBACK.md",
  "../.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml"
];

export const REQUIRED_SAFETY_PHRASES = {
  github: [
    "Do not paste API keys",
    "Do not attach raw terminal transcripts",
    "I reviewed this issue and attachments for secrets",
    "Any API keys, passwords, JWTs, attach tokens",
    "I did not attach raw terminal transcripts"
  ],
  markdown: [
    "Do not ask first users to retrieve browser auth tokens from developer tools.",
    "Do not include plaintext API keys",
    "no raw transcript",
    "no raw log attachment"
  ]
};

const REQUIRED_GITHUB_REQUIRED_FIELDS = REQUIRED_GITHUB_FIELDS.filter(
  (field) => field !== "windows_wsl" && field !== "safety"
);

export const REQUIRED_CAVEAT_OWNER_PHRASES = [
  "Owner:",
  "Disposition:",
  "Follow-up route:",
  "FEISHU-BOT-WS evidence",
  "Next action or no-action rationale:",
  "Evidence needed to move to pass:"
];

export const REQUIRED_MARKDOWN_PHRASES = [
  "Result: pass / pass with caveats / blocked",
  "Affected surface:",
  "Startup path:",
  "ForgeBadger version or commit:",
  "node --version",
  "tmux -V",
  "claude --version",
  "forgebadger doctor",
  "Owner:",
  "Disposition:",
  "Follow-up route:",
  "FEISHU-BOT-WS evidence",
  "Next action or no-action rationale:",
  "Caveat status:",
  "Redaction review completed:",
  "Copilot route availability:",
  "Copilot conversation lifecycle observed:",
  "Approval decision result, if exercised:",
  "Confirmed no raw terminal input without approval:",
  "Terminal attach result:",
  "Terminal input/output result summary, no raw transcript:",
  "Terminal resize result:",
  "Refresh/reconnect result:",
  "Stop-session result:",
  "Gateway/Web restart recovery result:",
  "Gateway log summary, no raw log attachment:",
  "Web log summary, no raw log attachment:"
];

export const REQUIRED_GITHUB_COPILOT_PROMPTS = [
  "Copilot route availability:",
  "Copilot conversation lifecycle observed:",
  "Approval decision result, if exercised:",
  "Feishu account/configuration result, if configured:",
  "Visible Copilot blocker, if any:",
  "Confirmed no raw terminal input without approval:"
];

export const REQUIRED_MARKDOWN_COPILOT_PROMPTS = [
  "Copilot route availability:",
  "Copilot conversation lifecycle observed:",
  "Approval decision result, if exercised:",
  "Feishu account/configuration result, if configured:",
  "Visible Copilot blocker, if any:",
  "Confirmed no raw terminal input without approval:"
];

const UNSAFE_INTAKE_PATTERNS = [
  /\b(?:attach|upload|submit|paste)\s+raw\b/i,
  /\bpaste\s+(?:your\s+)?(?:api\s+key|password|jwt|token|private\s+key)\b/i,
  /\bretrieve\s+browser\s+auth\s+tokens?\s+from\s+developer\s+tools\b/i
];

const FORBIDDEN_FIRST_USER_RUNBOOK_PATTERNS = [
  { pattern: /\bbrowser developer tools\b/i, label: "browser developer tools" },
  { pattern: /\bRead Local Storage\b/i, label: "Read Local Storage" },
  { pattern: /\bforgebadger\.token\b/i, label: "forgebadger.token" },
  { pattern: /\bopenforge\.token\b/i, label: "legacy browser token storage" },
  { pattern: /\bauthorization:\s*Bearer\s*<token>\b/i, label: "authorization: Bearer <token>" }
];

export function validateTrialFeedbackIntake(options = {}) {
  const errors = [];
  const githubIssueForm = readInput(
    options.githubIssueForm,
    options.githubIssueFormPath ?? DEFAULT_GITHUB_ISSUE_FORM_PATH,
    ".github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml",
    errors
  );
  const markdownTemplate = readInput(
    options.markdownTemplate,
    options.markdownTemplatePath ?? DEFAULT_MARKDOWN_TEMPLATE_PATH,
    "docs/TRIAL-FEEDBACK.md",
    errors
  );
  const trialRunbook = readInput(
    options.trialRunbook,
    options.trialRunbookPath ?? DEFAULT_TRIAL_RUNBOOK_PATH,
    "docs/TRIAL-RUNBOOK.md",
    errors
  );
  const trialChecklist = readInput(
    options.trialChecklist,
    options.trialChecklistPath ?? DEFAULT_TRIAL_CHECKLIST_PATH,
    "docs/TRIAL-CHECKLIST.md",
    errors
  );
  const openSourceReadiness = readInput(
    options.openSourceReadiness,
    options.openSourceReadinessPath ?? DEFAULT_OPEN_SOURCE_READINESS_PATH,
    "docs/OPEN-SOURCE-READINESS.md",
    errors
  );
  const supportDiagnostics = readInput(
    options.supportDiagnostics,
    options.supportDiagnosticsPath ?? DEFAULT_SUPPORT_DIAGNOSTICS_PATH,
    "docs/SUPPORT-DIAGNOSTICS.md",
    errors
  );
  const rootReadme = readInput(
    options.rootReadme,
    options.rootReadmePath ?? DEFAULT_ROOT_README_PATH,
    "README.md",
    errors
  );
  const zhCnReadme = readInput(
    options.zhCnReadme,
    options.zhCnReadmePath ?? DEFAULT_ZH_CN_README_PATH,
    "docs/README.zh-CN.md",
    errors
  );
  const zhTwReadme = readInput(
    options.zhTwReadme,
    options.zhTwReadmePath ?? DEFAULT_ZH_TW_README_PATH,
    "docs/README.zh-TW.md",
    errors
  );

  if (githubIssueForm !== undefined) {
    validateGithubIssueForm(githubIssueForm, errors);
    validateUnsafeIntakeLanguage(githubIssueForm, "GitHub issue form", errors);
  }
  if (markdownTemplate !== undefined) {
    validateMarkdownTemplate(markdownTemplate, errors);
    validateUnsafeIntakeLanguage(markdownTemplate, "Markdown template", errors);
  }
  if (trialRunbook !== undefined) {
    validateTrialRunbook(trialRunbook, errors);
  }
  if (trialChecklist !== undefined) {
    validateTrialChecklist(trialChecklist, errors);
  }
  if (openSourceReadiness !== undefined) {
    validateFirstUserEntrypoint(openSourceReadiness, "open-source readiness", errors);
  }
  if (supportDiagnostics !== undefined) {
    validateFirstUserEntrypoint(supportDiagnostics, "support diagnostics", errors);
  }
  if (rootReadme !== undefined) {
    validateReadmeTrialEntrypoint(
      rootReadme,
      "root README",
      REQUIRED_ROOT_README_TRIAL_ENTRYPOINT_PHRASES,
      errors
    );
  }
  if (zhCnReadme !== undefined) {
    validateReadmeTrialEntrypoint(
      zhCnReadme,
      "Simplified Chinese README",
      REQUIRED_LOCALIZED_README_TRIAL_ENTRYPOINT_PHRASES,
      errors
    );
  }
  if (zhTwReadme !== undefined) {
    validateReadmeTrialEntrypoint(
      zhTwReadme,
      "Traditional Chinese README",
      REQUIRED_LOCALIZED_README_TRIAL_ENTRYPOINT_PHRASES,
      errors
    );
  }

  return { ok: errors.length === 0, errors };
}

function readInput(inlineContent, fallbackPath, label, errors) {
  if (inlineContent !== undefined) {
    return inlineContent;
  }
  try {
    return fs.readFileSync(fallbackPath, "utf8");
  } catch (error) {
    errors.push(`${label} could not be read: ${error.message}`);
    return undefined;
  }
}
function validateGithubIssueForm(source, errors) {
  const fieldBlocks = extractIssueFormFieldBlocks(source);
  for (const field of REQUIRED_GITHUB_FIELDS) {
    if (!fieldBlocks.has(field)) {
      errors.push(`GitHub issue form is missing required field id: ${field}`);
    }
  }

  for (const [field, expectedType] of Object.entries(REQUIRED_GITHUB_FIELD_TYPES)) {
    const block = fieldBlocks.get(field);
    if (block === undefined) {
      continue;
    }
    const actualType = extractIssueFormFieldType(block);
    if (actualType !== expectedType) {
      errors.push(`GitHub issue field ${field} must keep type: ${expectedType}`);
    }
  }

  for (const field of REQUIRED_GITHUB_REQUIRED_FIELDS) {
    const block = fieldBlocks.get(field);
    if (block !== undefined && !hasRequiredTrue(block)) {
      errors.push(`GitHub issue field ${field} must keep validations.required: true`);
    }
  }

  for (const [field, requiredOptions] of Object.entries(REQUIRED_GITHUB_OPTIONS)) {
    const block = fieldBlocks.get(field);
    if (block === undefined) {
      continue;
    }
    const options = extractYamlListValues(block);
    for (const option of requiredOptions) {
      if (!options.includes(option)) {
        errors.push(`GitHub issue field ${field} is missing required option: ${option}`);
      }
    }
  }

  for (const phrase of REQUIRED_CAVEAT_OWNER_PHRASES) {
    if (!source.includes(phrase)) {
      errors.push(`GitHub issue form caveat owner block is missing: ${phrase}`);
    }
  }

  for (const phrase of REQUIRED_SAFETY_PHRASES.github) {
    if (!source.includes(phrase)) {
      errors.push(`GitHub issue form safety language is missing: ${phrase}`);
    }
  }

  const copilotBlock = fieldBlocks.get("copilot");
  if (copilotBlock !== undefined) {
    for (const phrase of REQUIRED_GITHUB_COPILOT_PROMPTS) {
      if (!copilotBlock.includes(phrase)) {
        errors.push(`GitHub issue form Copilot evidence prompt is missing: ${phrase}`);
      }
    }
  }
}

function extractIssueFormFieldBlocks(source) {
  const blocks = new Map();
  const lines = source.split(/\r?\n/);
  let current = [];

  for (const line of lines) {
    if (/^  - type:\s+/.test(line) && current.length > 0) {
      storeIssueFormBlock(blocks, current.join("\n"));
      current = [];
    }
    if (current.length > 0 || /^  - type:\s+/.test(line)) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    storeIssueFormBlock(blocks, current.join("\n"));
  }

  return blocks;
}

function storeIssueFormBlock(blocks, block) {
  const match = block.match(/^\s+id:\s*([A-Za-z0-9_-]+)\s*$/m);
  if (match) {
    blocks.set(match[1], block);
  }
}

function extractIssueFormFieldType(block) {
  return block.match(/^  - type:\s+([A-Za-z0-9_-]+)\s*$/m)?.[1];
}

function hasRequiredTrue(block) {
  return /^\s+validations:\s*$/m.test(block) && /^\s+required:\s+true\s*$/m.test(block);
}

function extractYamlListValues(block) {
  return block
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1])
    .filter((value) => value !== undefined)
    .map((value) => stripYamlScalar(value));
}

function stripYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function validateMarkdownTemplate(source, errors) {
  for (const section of REQUIRED_MARKDOWN_SECTIONS) {
    const pattern = new RegExp(`^## ${escapeRegex(section)}\\s*$`, "m");
    if (!pattern.test(source)) {
      errors.push(`Markdown trial feedback template is missing section: ${section}`);
    }
  }

  for (const phrase of [
    ...REQUIRED_MARKDOWN_PHRASES,
    ...REQUIRED_MARKDOWN_COPILOT_PROMPTS,
    ...REQUIRED_SAFETY_PHRASES.markdown
  ]) {
    if (!source.includes(phrase)) {
      errors.push(`Markdown trial feedback template is missing required language: ${phrase}`);
    }
  }
}

function validateTrialRunbook(source, errors) {
  for (const phrase of REQUIRED_RUNBOOK_PHRASES) {
    if (!source.includes(phrase)) {
      errors.push(`first-user runbook is missing required diagnostics guidance: ${phrase}`);
    }
  }

  validateForbiddenBrowserTokenGuidance(source, "first-user runbook", errors);
}

function validateTrialChecklist(source, errors) {
  for (const phrase of REQUIRED_CHECKLIST_PHRASES) {
    if (!source.includes(phrase)) {
      errors.push(`trial checklist is missing required first-user guidance: ${phrase}`);
    }
  }

  validateUnsafeIntakeLanguage(source, "Trial checklist", errors);
  validateForbiddenBrowserTokenGuidance(source, "trial checklist", errors);
}

function validateFirstUserEntrypoint(source, label, errors) {
  for (const phrase of REQUIRED_FIRST_USER_ENTRYPOINT_PHRASES) {
    if (!source.includes(phrase)) {
      errors.push(`${label} is missing required first-user audit route: ${phrase}`);
    }
  }
}

function validateReadmeTrialEntrypoint(source, label, requiredPhrases, errors) {
  for (const phrase of requiredPhrases) {
    if (!source.includes(phrase)) {
      errors.push(`${label} is missing required first-user trial entrypoint: ${phrase}`);
    }
  }
}

function validateForbiddenBrowserTokenGuidance(source, label, errors) {
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const { pattern, label: patternLabel } of FORBIDDEN_FIRST_USER_RUNBOOK_PATTERNS) {
      if (pattern.test(line) && !isNegatedSafetyInstruction(line)) {
        errors.push(
          `${label} contains forbidden browser-token guidance on line ${index + 1}: ${patternLabel}`
        );
      }
    }
  }
}

function validateUnsafeIntakeLanguage(source, label, errors) {
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const pattern of UNSAFE_INTAKE_PATTERNS) {
      if (pattern.test(line) && !isNegatedSafetyInstruction(line)) {
        errors.push(`${label} contains unsafe intake language on line ${index + 1}: ${line.trim()}`);
      }
    }
  }
}

function isNegatedSafetyInstruction(line) {
  const normalized = line.toLowerCase();
  return (
    normalized.includes("do not") ||
    normalized.includes("did not") ||
    normalized.includes("no raw") ||
    normalized.includes("not ask") ||
    normalized.includes("not include")
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateTrialFeedbackIntake();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}
