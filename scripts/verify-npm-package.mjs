import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const cliPackageRoot = path.resolve("packages/cli");
const cliDist = path.join(cliPackageRoot, "dist");

const required = [
  "dist/index.js",
  "dist/gateway/src/index.js",
  "dist/gateway/src/db/migrations",
  "dist/web/standalone/packages/web/server.js",
  "dist/web/standalone/packages/web/public/openforge-runtime.js",
  "README.md",
  "LICENSE",
  "docs/README.zh-CN.md",
  "docs/README.zh-TW.md"
];

const forbiddenNames = new Set([
  ".env",
  ".claude",
  ".codex",
  ".opencode",
  ".openforge",
  "logs",
  "reports"
]);

const forbiddenExtensions = new Set([".db", ".sqlite", ".sqlite3", ".log"]);

let failed = false;

for (const relative of required) {
  const absolute = path.join(cliPackageRoot, relative);
  if (!existsSync(absolute)) {
    fail(`missing required artifact: packages/cli/${relative}`);
    continue;
  }
  if (relative.endsWith("/migrations") && !statSync(absolute).isDirectory()) {
    fail(`required artifact is not a directory: packages/cli/${relative}`);
  }
}

if (existsSync(cliDist)) {
  await scanForbiddenArtifacts(cliDist);
}

if (!hasAllowedFilesWhitelist()) {
  fail("packages/cli/package.json files whitelist does not match npm package artifacts");
}

process.exitCode = failed ? 1 : 0;

function fail(message) {
  console.error(message);
  failed = true;
}

async function scanForbiddenArtifacts(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    const relative = path.relative(cliPackageRoot, absolute);
    if (isForbiddenArtifact(entry.name)) {
      fail(`forbidden artifact present: packages/cli/${relative}`);
      continue;
    }
    if (entry.isDirectory()) {
      await scanForbiddenArtifacts(absolute);
    }
  }
}

function isForbiddenArtifact(name) {
  if (forbiddenNames.has(name)) {
    return true;
  }
  if (name.startsWith(".env")) {
    return true;
  }
  return forbiddenExtensions.has(path.extname(name));
}

function hasAllowedFilesWhitelist() {
  const packageJsonPath = path.join(cliPackageRoot, "package.json");
  const packageJson = JSON.parse(statSync(packageJsonPath).isFile() ? readFileSync(packageJsonPath, "utf8") : "{}");
  const expected = [
    "dist",
    "README.md",
    "LICENSE",
    "docs/README.zh-CN.md",
    "docs/README.zh-TW.md",
    "package.json"
  ];
  return JSON.stringify(packageJson.files) === JSON.stringify(expected);
}
