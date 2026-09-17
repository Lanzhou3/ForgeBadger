import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyBrandPattern = /(?:OpenForge|openforge|OPENFORGE|(?:^|[\s"'`])of-)/u;
const historicalSecurityAllowlist = new Map([
  ["scripts/create-trial-feedback-draft.mjs", ["(?:forgebadger|openforge)", "(?:FORGEBADGER|OPENFORGE)"]],
  ["scripts/audit-trial-feedback-packet.mjs", ["(?:forgebadger|openforge)", "(?:FORGEBADGER|OPENFORGE)"]],
  ["scripts/audit-feishu-bot-live-report.mjs", ["(?:FORGEBADGER|OPENFORGE)"]],
  ["scripts/validate-trial-feedback-intake.mjs", ["openforge\\.token"]],
  ["scripts/smoke-local-release.mjs", ["OPENFORGE_MASTER_KEY", "OPENFORGE_JWT_SECRET", "OPENFORGE_ATTACH_TOKEN"]],
  ["packages/gateway/src/services/redaction.ts", ["(?:FORGEBADGER|OPENFORGE)"]],
  ["packages/gateway/src/lib/redaction.ts", ["(?:FORGEBADGER|OPENFORGE)", "OPENFORGE_ATTACH_TOKEN"]],
  ["packages/gateway/src/services/project-ai-config.ts", ["(?:FORGEBADGER|OPENFORGE)"]],
  ["packages/gateway/src/db/repositories/project-manager-repository.ts", ["(?:FORGEBADGER|OPENFORGE)"]],
  ["packages/web/src/components/sessions/session-handoff-export.ts", ["(?:FORGEBADGER|OPENFORGE)"]],
  ["packages/web/src/components/projects/project-manager/utils.ts", ["(?:FORGEBADGER|OPENFORGE)"]],
  ["packages/gateway/src/db/migrations/0052_rename_forgebadger_contracts.sql", [
    "openforge_user_id", "idx_integration_feishu_user_mappings_openforge_user", "'/openforge'"
  ]]
]);

export function findLegacyBrandViolations(files) {
  const violations = [];
  for (const file of files) {
    const allowedTokens = historicalSecurityAllowlist.get(file.path) ?? [];
    for (const [index, line] of file.content.split(/\r?\n/u).entries()) {
      if (!legacyBrandPattern.test(line)) continue;
      const remainder = allowedTokens.reduce((value, token) => value.split(token).join(""), line);
      if (!legacyBrandPattern.test(remainder)) continue;
      violations.push(`${file.path}:${index + 1}: ${line.trim()}`);
    }
  }
  return violations;
}

export function isBrandSurface(filePath) {
  if (filePath === "scripts/validate-forgebadger-brand.mjs") return false;
  if (/\.test\.(?:[cm]?[jt]s|tsx)$/u.test(filePath)) return false;
  if (filePath.includes("/dist/") || !isTextSurface(filePath)) return false;
  if (filePath.startsWith("packages/gateway/src/db/migrations/") && !filePath.includes("0052_")) return false;
  return ["package.json", "pnpm-lock.yaml", "README.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE", "CLAUDE.md", "AGENTS.md"].includes(filePath) ||
    filePath === ".github/workflows/ci.yml" || filePath.startsWith(".github/ISSUE_TEMPLATE/") ||
    filePath.startsWith("docs/") ||
    filePath.startsWith("packages/web/src/") ||
    filePath.startsWith("packages/gateway/src/") || filePath.startsWith("packages/cli/src/") ||
    ["packages/gateway/package.json", "packages/cli/package.json"].includes(filePath) ||
    (filePath.startsWith("scripts/") && !filePath.includes(".test."));
}

function isTextSurface(filePath) {
  return /(?:^|\/)(?:[^/]+\.)?(?:md|mdx|txt|json|ya?ml|toml|sql|[cm]?[jt]s|tsx)$/u.test(filePath) ||
    ["LICENSE", "pnpm-lock.yaml"].includes(filePath);
}

function readBrandSurfaces() {
  const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: rootDir, encoding: "utf8" });
  return output.split(/\r?\n/u).filter(Boolean).filter(isBrandSurface).filter((filePath) =>
    existsSync(path.join(rootDir, filePath))
  ).map((filePath) => ({ path: filePath, content: readFileSync(path.join(rootDir, filePath), "utf8") }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = findLegacyBrandViolations(readBrandSurfaces());
  if (violations.length > 0) {
    console.error(`ForgeBadger brand validation failed:\n${violations.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("ForgeBadger brand validation passed.");
  }
}
