import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const READY_WARNING =
  "Packet audit passing means ready for maintainer triage, not automatic FIRST-USER-FEEDBACK gate clearance.";

const REQUIRED_SECTIONS = [
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

const REQUIRED_FIELDS = [
  { label: "Result", disallow: /pass\s*\/\s*pass with caveats\s*\/\s*blocked/i },
  { label: "Affected surface", disallow: /onboarding\s*\/\s*dependency\s*\/\s*provider/i },
  { label: "Startup path", disallow: /npm\/CLI\s*\/\s*source fallback/i },
  { label: "ForgeBadger version or commit" },
  { label: "Operating system" },
  { label: "Shell" },
  { label: "Browser and version" },
  { label: "node --version" },
  { label: "tmux -V" },
  { label: "claude --version" },
  { label: "forgebadger doctor summary" },
  { label: "Diagnostics export attached", disallow: /yes\s*\/\s*no/i },
  { label: "Export path used", disallow: /Settings\s*->\s*Export diagnostics JSON\s*\/\s*unavailable/i },
  { label: "Redaction review completed", requiredValue: /^yes$/i },
  { label: "Category", disallow: /dependency\s*\/\s*provider\s*\/\s*CLI/i },
  { label: "Severity", disallow: /blocker\s*\/\s*high\s*\/\s*medium\s*\/\s*low/i },
  { label: "Mapped requirement", disallow: /UX-01\s*\/\s*UX-02/i },
  { label: "Owner" },
  { label: "Disposition", disallow: /gate-clearing evidence\s*\/\s*preserved caveat/i },
  { label: "Follow-up route", disallow: /issue #3 LIVE-PROVIDER\s*\/\s*issue #4 WINDOWS-WSL/i },
  { label: "Next action or no-action rationale" },
  { label: "Caveat status", disallow: /none\s*\/\s*pass with caveats\s*\/\s*blocked/i },
  { label: "Terminal attach result" },
  { label: "pnpm smoke:copilot-provider result", disallow: /passed\s*\/\s*skipped\s*\/\s*failed/i },
  {
    label: "Copilot provider with active model configured",
    disallow: /yes\s*\/\s*no\s*\/\s*skipped/i
  },
  { label: "Copilot prompt used" },
  { label: "Copilot read-tool evidence observed" },
  { label: "Copilot pending-action approve/reject result" },
  { label: "Copilot memory write proposal tested", disallow: /yes\s*\/\s*no\s*\/\s*skipped/i },
  { label: "Confirmed no terminal/shell/Codex turn input in Copilot", requiredValue: /^yes$/i },
  { label: "Terminal input/output result summary, no raw transcript" },
  { label: "Terminal resize result" },
  { label: "Refresh/reconnect result" },
  { label: "Stop-session result" },
  { label: "Gateway/Web restart recovery result" },
  { label: "Gateway log summary, no raw log attachment" },
  { label: "Web log summary, no raw log attachment" }
];

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\bsk-[A-Za-z0-9_-]+/i,
  /\b(?:forgebadger|openforge)\.token\s*=\s*\S+/i,
  /\b(?:FORGEBADGER|OPENFORGE)_(?:MASTER_KEY|JWT_SECRET|ATTACH_TOKEN|API_KEY|TOKEN)\s*=\s*\S+/,
  /\b(api[_-]?key|jwt|token|password|private[_-]?key)\s*[:=]\s*\S+/i
];

const GENERIC_PLACEHOLDER_VALUES = new Set([
  "tbd",
  "todo",
  "fixme",
  "pending",
  "n/a",
  "na",
  "not applicable",
  "...",
  "…",
  "-",
  "--",
  "_"
]);

export function auditTrialFeedbackPacket(markdown) {
  const errors = [];
  const source = String(markdown ?? "");

  if (source.includes("Generated draft status:")) {
    errors.push("Generated draft status is present; generated drafts must be completed before audit passes.");
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^## ${escapeRegex(section)}\\s*$`, "m").test(source)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  for (const field of REQUIRED_FIELDS) {
    const value = findFieldValue(source, field.label);
    if (!value) {
      errors.push(`Missing required field value: ${field.label}`);
      continue;
    }
    if (isPlaceholderValue(value)) {
      errors.push(`${field.label} contains placeholder content.`);
    }
    if (field.requiredValue && !field.requiredValue.test(value)) {
      errors.push(`${field.label} must be yes.`);
    }
    if (field.disallow && field.disallow.test(value)) {
      errors.push(`${field.label} still contains placeholder options.`);
    }
  }

  if (!hasReproductionSteps(source)) {
    errors.push("Reproduction Steps must include at least two completed numbered steps.");
  }
  if (!sectionHasContent(source, "Expected Behavior")) {
    errors.push("Expected Behavior must be filled.");
  }
  if (!sectionHasContent(source, "Actual Behavior")) {
    errors.push("Actual Behavior must be filled.");
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(source)) {
      errors.push("Packet contains secret-like content; remove or redact it before triage.");
      break;
    }
  }

  return {
    ok: errors.length === 0,
    readyForHumanTriage: errors.length === 0,
    gateClearingEvidence: false,
    errors,
    warnings: errors.length === 0 ? [READY_WARNING] : []
  };
}

export function parseAuditCliArgs(args) {
  const parsed = { packetPath: undefined, json: false };
  for (const arg of args) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (parsed.packetPath) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    parsed.packetPath = arg;
  }
  if (!parsed.packetPath) {
    throw new Error("Usage: node scripts/audit-trial-feedback-packet.mjs <packet.md> [--json]");
  }
  return parsed;
}

function findFieldValue(source, label) {
  const escaped = escapeRegex(label);
  const patterns = [
    new RegExp(`^-\\s+${escaped}:[ \\t]*(.+?)[ \\t]*$`, "im"),
    new RegExp(`^${escaped}:[ \\t]*(.+?)[ \\t]*$`, "im")
  ];
  for (const pattern of patterns) {
    const value = source.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return "";
}

function hasReproductionSteps(source) {
  const body = sectionBody(source, "Reproduction Steps");
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+\.\s+(.+?)\s*$/)?.[1]?.trim() ?? "")
    .filter((value) => value && !isPlaceholderValue(value))
    .length >= 2;
}

function sectionHasContent(source, section) {
  return sectionBody(source, section)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line.length > 0 && !line.startsWith("<!--") && !isPlaceholderValue(line));
}

function sectionBody(source, section) {
  const heading = source.match(new RegExp(`^## ${escapeRegex(section)}\\s*$`, "m"));
  if (!heading || heading.index === undefined) {
    return "";
  }
  const start = heading.index + heading[0].length;
  const rest = source.slice(start);
  const nextHeadingIndex = rest.search(/^##\s+/m);
  return nextHeadingIndex === -1 ? rest : rest.slice(0, nextHeadingIndex);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlaceholderValue(value) {
  const normalized = normalizePlaceholderValue(value);
  return GENERIC_PLACEHOLDER_VALUES.has(normalized);
}

function normalizePlaceholderValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^[`"'([{<]+/, "")
    .replace(/[`"'\])}>]+$/, "")
    .trim()
    .toLowerCase();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseAuditCliArgs(process.argv.slice(2));
    const packet = fs.readFileSync(args.packetPath, "utf8");
    const result = auditTrialFeedbackPacket(packet);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const error of result.errors) {
        console.error(`error: ${error}`);
      }
      for (const warning of result.warnings) {
        console.log(`warning: ${warning}`);
      }
      console.log(`readyForHumanTriage=${result.readyForHumanTriage}`);
      console.log(`gateClearingEvidence=${result.gateClearingEvidence}`);
    }
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
