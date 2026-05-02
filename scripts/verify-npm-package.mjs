import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const cliPackageRoot = path.resolve("packages/cli");
const cliDist = path.join(cliPackageRoot, "dist");

const required = [
  { path: "dist/index.js", type: "file" },
  { path: "dist/gateway/src/index.js", type: "file" },
  { path: "dist/gateway/src/db/migrations", type: "directory", nonEmpty: true },
  { path: "dist/web/standalone/packages/web/server.js", type: "file" },
  { path: "dist/web/standalone/packages/web/.next/BUILD_ID", type: "file" },
  { path: "dist/web/standalone/packages/web/.next/static", type: "directory", nonEmpty: true },
  { path: "dist/web/standalone/packages/web/node_modules/next/package.json", type: "file" },
  { path: "dist/web/standalone/packages/web/public", type: "directory", nonEmpty: true },
  { path: "dist/web/standalone/packages/web/public/openforge-runtime.js", type: "file" },
  { path: "README.md", type: "file" },
  { path: "LICENSE", type: "file" },
  { path: "docs/README.zh-CN.md", type: "file" },
  { path: "docs/README.zh-TW.md", type: "file" }
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

const forbiddenFilePatterns = [
  /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/,
  /\.log$/
];

let failed = false;

for (const artifact of required) {
  const absolute = path.join(cliPackageRoot, artifact.path);
  if (!existsSync(absolute)) {
    fail(`missing required artifact: packages/cli/${artifact.path}`);
    continue;
  }
  const stats = statSync(absolute);
  if (artifact.type === "file" && !stats.isFile()) {
    fail(`required artifact is not a file: packages/cli/${artifact.path}`);
  }
  if (artifact.type === "directory" && !stats.isDirectory()) {
    fail(`required artifact is not a directory: packages/cli/${artifact.path}`);
  }
  if (artifact.nonEmpty && stats.isDirectory() && (await readdir(absolute)).length === 0) {
    fail(`required artifact directory is empty: packages/cli/${artifact.path}`);
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
    if (entry.isSymbolicLink()) {
      fail(`forbidden symlink artifact present: packages/cli/${relative}`);
      continue;
    }
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
  return forbiddenFilePatterns.some((pattern) => pattern.test(name));
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
