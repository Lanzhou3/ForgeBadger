import { existsSync, lstatSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const packageArtifactRoots = ["dist", "README.md", "LICENSE", "docs"];

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

export async function verifyNpmPackage(options = {}) {
  const cliPackageRoot = path.resolve(options.cliPackageRoot ?? "packages/cli");
  const errors = [];

  for (const artifact of required) {
    await verifyRequiredArtifact(cliPackageRoot, artifact, errors);
  }

  for (const relative of packageArtifactRoots) {
    const absolute = path.join(cliPackageRoot, relative);
    if (existsSync(absolute)) {
      await scanForbiddenArtifacts(cliPackageRoot, absolute, errors);
    }
  }

  if (!hasAllowedFilesWhitelist(cliPackageRoot)) {
    errors.push("packages/cli/package.json files whitelist does not match npm package artifacts");
  }

  return { ok: errors.length === 0, errors };
}

async function verifyRequiredArtifact(cliPackageRoot, artifact, errors) {
  const absolute = path.join(cliPackageRoot, artifact.path);
  if (!existsSync(absolute)) {
    errors.push(`missing required artifact: packages/cli/${artifact.path}`);
    return;
  }
  const stats = lstatSync(absolute);
  if (stats.isSymbolicLink()) {
    errors.push(`forbidden symlink artifact present: packages/cli/${artifact.path}`);
    return;
  }
  if (artifact.type === "file" && !stats.isFile()) {
    errors.push(`required artifact is not a file: packages/cli/${artifact.path}`);
  }
  if (artifact.type === "directory" && !stats.isDirectory()) {
    errors.push(`required artifact is not a directory: packages/cli/${artifact.path}`);
  }
  if (artifact.nonEmpty && stats.isDirectory() && (await readdir(absolute)).length === 0) {
    errors.push(`required artifact directory is empty: packages/cli/${artifact.path}`);
  }
}

async function scanForbiddenArtifacts(cliPackageRoot, root, errors) {
  const rootStats = lstatSync(root);
  const rootRelative = path.relative(cliPackageRoot, root);
  if (rootStats.isSymbolicLink()) {
    errors.push(`forbidden symlink artifact present: packages/cli/${rootRelative}`);
    return;
  }
  if (isForbiddenArtifact(path.basename(root))) {
    errors.push(`forbidden artifact present: packages/cli/${rootRelative}`);
    return;
  }
  if (!rootStats.isDirectory()) {
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    const relative = path.relative(cliPackageRoot, absolute);
    if (entry.isSymbolicLink()) {
      errors.push(`forbidden symlink artifact present: packages/cli/${relative}`);
      continue;
    }
    if (isForbiddenArtifact(entry.name)) {
      errors.push(`forbidden artifact present: packages/cli/${relative}`);
      continue;
    }
    if (entry.isDirectory()) {
      await scanForbiddenArtifacts(cliPackageRoot, absolute, errors);
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

function hasAllowedFilesWhitelist(cliPackageRoot) {
  const packageJsonPath = path.join(cliPackageRoot, "package.json");
  const packageJson = JSON.parse(existsSync(packageJsonPath) && lstatSync(packageJsonPath).isFile() ? readFileSync(packageJsonPath, "utf8") : "{}");
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

function isMainModule() {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  const result = await verifyNpmPackage();
  for (const error of result.errors) {
    console.error(error);
  }
  process.exitCode = result.ok ? 0 : 1;
}
