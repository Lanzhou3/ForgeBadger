import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const DEFAULT_GITHUB_ISSUE_FORM_PATH = path.join(
  REPO_ROOT,
  ".github",
  "ISSUE_TEMPLATE",
  "openforge-trial-feedback.yml"
);
const DEFAULT_MARKDOWN_TEMPLATE_PATH = path.join(REPO_ROOT, "docs", "TRIAL-FEEDBACK.md");

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
    "UX-03 Copilot run and pending-action state coherence",
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
  copilot: "textarea",
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
  "Next action or no-action rationale:",
  "Evidence needed to move to pass:"
];

export const REQUIRED_MARKDOWN_PHRASES = [
  "Result: pass / pass with caveats / blocked",
  "Affected surface:",
  "Startup path:",
  "OpenForge version or commit:",
  "node --version",
  "tmux -V",
  "claude --version",
  "openforge doctor",
  "Owner:",
  "Disposition:",
  "Follow-up route:",
  "Next action or no-action rationale:",
  "Caveat status:",
  "Redaction review completed:",
  "`pnpm smoke:copilot-provider` result:",
  "Copilot provider with active model configured:",
  "Copilot pending-action approve/reject result:",
  "Confirmed no terminal/shell/Codex turn input in Copilot:",
  "Terminal attach result:",
  "Terminal input/output result summary, no raw transcript:",
  "Terminal resize result:",
  "Refresh/reconnect result:",
  "Stop-session result:",
  "Gateway/Web restart recovery result:",
  "Gateway log summary, no raw log attachment:",
  "Web log summary, no raw log attachment:"
];

const UNSAFE_INTAKE_PATTERNS = [
  /\b(?:attach|upload|submit|paste)\s+raw\b/i,
  /\bpaste\s+(?:your\s+)?(?:api\s+key|password|jwt|token|private\s+key)\b/i,
  /\bretrieve\s+browser\s+auth\s+tokens?\s+from\s+developer\s+tools\b/i
];

export function validateTrialFeedbackIntake(options = {}) {
  const errors = [];
  const githubIssueForm = readInput(
    options.githubIssueForm,
    options.githubIssueFormPath ?? DEFAULT_GITHUB_ISSUE_FORM_PATH,
    ".github/ISSUE_TEMPLATE/openforge-trial-feedback.yml",
    errors
  );
  const markdownTemplate = readInput(
    options.markdownTemplate,
    options.markdownTemplatePath ?? DEFAULT_MARKDOWN_TEMPLATE_PATH,
    "docs/TRIAL-FEEDBACK.md",
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

  for (const phrase of [...REQUIRED_MARKDOWN_PHRASES, ...REQUIRED_SAFETY_PHRASES.markdown]) {
    if (!source.includes(phrase)) {
      errors.push(`Markdown trial feedback template is missing required language: ${phrase}`);
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
