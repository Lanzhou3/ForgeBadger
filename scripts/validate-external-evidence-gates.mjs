import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_REGISTRY_PATH = path.join(REPO_ROOT, "docs", "EXTERNAL-EVIDENCE-GATES.md");
const ALLOWED_STATES = new Set(["Pass", "Caveat", "Blocked"]);

export const EXPECTED_EXTERNAL_GATES = [
  {
    id: "LIVE-PROVIDER",
    currentState: "Caveat",
    ownerPhrase: "Release maintainer with disposable provider credential",
    clearingPhrase: "pnpm smoke:copilot-provider",
    rerunPhrases: ["pnpm smoke:copilot-provider", "explicit provider"],
    targetPhrases: ["phase-18-live-provider-evidence-rerun", "issue #3"]
  },
  {
    id: "WINDOWS-WSL",
    currentState: "Caveat",
    ownerPhrase: "physical Windows host and WSL",
    clearingPhrase: "real WSL run",
    rerunPhrases: ["docs/TRIAL-CHECKLIST.md", "physical hardware"],
    targetPhrases: ["v1.4-external-evidence-closeout", "issue #4"]
  },
  {
    id: "FEISHU-CALLBACK",
    currentState: "Blocked",
    ownerPhrase: "public HTTPS Gateway route",
    clearingPhrase: "Feishu developer-console URL verification",
    rerunPhrases: ["public HTTPS routing", "Feishu console URL verification"],
    targetPhrases: ["phase-19-feishu-public-callback-evidence"]
  },
  {
    id: "FIRST-USER-FEEDBACK",
    currentState: "Caveat",
    ownerPhrase: "real trial packet",
    clearingPhrase: "completed redacted first-user feedback packet",
    rerunPhrases: ["docs/TRIAL-FEEDBACK.md", "pnpm trial:feedback-audit", "pnpm trial:feedback-issue-audit"],
    targetPhrases: ["issue #5", "completed trial feedback issue"]
  }
];

export function validateExternalEvidenceGates(options = {}) {
  const errors = [];
  const registry = readRegistry(options.registry, options.registryPath ?? DEFAULT_REGISTRY_PATH, errors);
  if (registry === undefined) {
    return { ok: false, errors };
  }

  const rows = parseGateRegistryRows(registry);

  for (const expected of EXPECTED_EXTERNAL_GATES) {
    const row = rows.get(expected.id);
    if (!row) {
      errors.push(`Gate registry is missing required gate row: ${expected.id}`);
      continue;
    }
    if (row.duplicate) {
      errors.push(`Gate registry has duplicate gate row: ${expected.id}`);
      continue;
    }

    if (!ALLOWED_STATES.has(row.currentState)) {
      errors.push(`Gate ${expected.id} has unsupported state: ${row.currentState}`);
      continue;
    }
    if (row.currentState !== expected.currentState) {
      errors.push(
        `Gate ${expected.id} must remain ${expected.currentState} until the required external artifact is linked; found ${row.currentState}.`
      );
    }

    requirePhrase(row.owner, expected.ownerPhrase, expected.id, "owner", errors);
    requirePhrase(row.clearingCondition, expected.clearingPhrase, expected.id, "clearing condition", errors);
    for (const phrase of expected.rerunPhrases) {
      requirePhrase(row.rerunPath, phrase, expected.id, "rerun path", errors);
    }
    for (const phrase of expected.targetPhrases) {
      requirePhrase(row.targetDestination, phrase, expected.id, "target destination", errors);
    }
  }

  return { ok: errors.length === 0, errors };
}

function readRegistry(inlineRegistry, registryPath, errors) {
  if (inlineRegistry !== undefined) {
    return inlineRegistry;
  }
  try {
    return fs.readFileSync(registryPath, "utf8");
  } catch (error) {
    errors.push(`docs/EXTERNAL-EVIDENCE-GATES.md could not be read: ${error.message}`);
    return undefined;
  }
}

function parseGateRegistryRows(markdown) {
  const rows = new Map();
  const section = extractGateRegistryTableSection(markdown);
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith("| `")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 6) {
      continue;
    }
    const id = unwrapCode(cells[0]);
    if (rows.has(id)) {
      rows.set(id, {
        ...rows.get(id),
        duplicate: true
      });
      continue;
    }
    rows.set(id, {
      id,
      currentState: unwrapCode(cells[1]),
      owner: cells[2],
      clearingCondition: cells[3],
      rerunPath: cells[4],
      targetDestination: cells[5]
    });
  }
  return rows;
}

function extractGateRegistryTableSection(markdown) {
  const heading = markdown.match(/^## Gate Registry\s*$/m);
  if (!heading || heading.index === undefined) {
    return "";
  }
  const rest = markdown.slice(heading.index + heading[0].length);
  const nextHeadingIndex = rest.search(/^##\s+/m);
  return nextHeadingIndex === -1 ? rest : rest.slice(0, nextHeadingIndex);
}

function requirePhrase(value, phrase, gateId, field, errors) {
  if (!value.toLowerCase().includes(phrase.toLowerCase())) {
    errors.push(`Gate ${gateId} ${field} must include: ${phrase}`);
  }
}

function unwrapCode(value) {
  return value.replace(/^`/, "").replace(/`$/, "").trim();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateExternalEvidenceGates();
  if (result.ok) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const error of result.errors) {
      console.error(`error: ${error}`);
    }
    process.exitCode = 1;
  }
}
