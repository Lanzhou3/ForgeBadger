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
  { path: "dist/web/standalone/node_modules/@swc/helpers/package.json", type: "file" },
  { path: "dist/web/standalone/packages/web/public", type: "directory", nonEmpty: true },
  { path: "dist/web/standalone/packages/web/public/forgebadger-runtime.js", type: "file" },
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
  ".forgebadger",
  "logs",
  "reports"
]);

const forbiddenFilePatterns = [
  /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/,
  /\.log$/,
  /\.(?:node|dylib|dll)$/,
  /\.so(?:\.\d+)*$/
];

const forbiddenRuntimeDependencies = new Set(["next", "react", "react-dom"]);

export async function verifyNpmPackage(options = {}) {
  const cliPackageRoot = path.resolve(options.cliPackageRoot ?? "packages/cli");
  const gatewayPackageRoot = path.resolve(options.gatewayPackageRoot ?? path.join(cliPackageRoot, "..", "gateway"));
  const packageJson = readPackageJson(cliPackageRoot);
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
  verifyReadmeBrandAssetUrls(cliPackageRoot, errors);
  verifyForbiddenRuntimeDependencies(packageJson, errors);
  verifyGatewayRuntimeDependencies(packageJson, gatewayPackageRoot, errors);

  return { ok: errors.length === 0, errors };
}

function verifyGatewayRuntimeDependencies(cliPackageJson, gatewayPackageRoot, errors) {
  if (!existsSync(path.join(gatewayPackageRoot, "package.json"))) {
    return;
  }
  const gatewayPackageJson = readPackageJson(gatewayPackageRoot);
  const cliDependencies = cliPackageJson.dependencies ?? {};
  const gatewayDependencies = gatewayPackageJson.dependencies ?? {};
  for (const [dependencyName, dependencyVersion] of Object.entries(gatewayDependencies)) {
    if (!(dependencyName in cliDependencies)) {
      errors.push(`missing Gateway runtime dependency: ${dependencyName}`);
      continue;
    }
    if (cliDependencies[dependencyName] !== dependencyVersion) {
      errors.push(`Gateway runtime dependency version mismatch: ${dependencyName}`);
    }
  }
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
  const packageJson = readPackageJson(cliPackageRoot);
  const expected = [
    "dist",
    "README.md",
    "LICENSE",
    "docs/README.zh-CN.md",
    "docs/README.zh-TW.md",
    "package.json"
  ];
  return hasSameStringItems(packageJson.files, expected);
}

function readPackageJson(cliPackageRoot) {
  const packageJsonPath = path.join(cliPackageRoot, "package.json");
  return JSON.parse(existsSync(packageJsonPath) && lstatSync(packageJsonPath).isFile() ? readFileSync(packageJsonPath, "utf8") : "{}");
}

function verifyReadmeBrandAssetUrls(cliPackageRoot, errors) {
  const readmes = ["README.md", "docs/README.zh-CN.md", "docs/README.zh-TW.md"];
  const relativeBrandAssetPattern = /src="(?:\.\.\/)*packages\/web\/public\/brand\//;
  for (const readme of readmes) {
    const absolute = path.join(cliPackageRoot, readme);
    if (!existsSync(absolute)) {
      continue;
    }
    if (relativeBrandAssetPattern.test(readFileSync(absolute, "utf8"))) {
      errors.push(
        `packages/cli/${readme} uses a relative brand asset URL; build-npm-package must rewrite it to the raw GitHub URL`
      );
    }
  }
}

function verifyForbiddenRuntimeDependencies(packageJson, errors) {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = packageJson[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      continue;
    }
    for (const dependencyName of Object.keys(dependencies)) {
      if (forbiddenRuntimeDependencies.has(dependencyName)) {
        errors.push(`forbidden runtime dependency: ${dependencyName}`);
      }
    }
  }
}

function hasSameStringItems(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((item) => actual.includes(item))
  );
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
