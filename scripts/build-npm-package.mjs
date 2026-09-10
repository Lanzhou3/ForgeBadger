import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand } from "./smoke-npm-package-runner.mjs";

const workspaceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cliDist = path.join(workspaceRoot, "packages/cli/dist");
const gatewayTarget = path.join(cliDist, "gateway");
const webTarget = path.join(cliDist, "web");
const webStandaloneTarget = path.join(webTarget, "standalone");
const webStandalonePackage = path.join(webStandaloneTarget, "packages", "web");
const webNextEnv = path.join(workspaceRoot, "packages/web/next-env.d.ts");
const gatewayDist = path.join(workspaceRoot, "packages/gateway/dist");
const cliReadme = path.join(workspaceRoot, "packages/cli/README.md");
const cliLicense = path.join(workspaceRoot, "packages/cli/LICENSE");
const cliDocs = path.join(workspaceRoot, "packages/cli/docs");
const copyTreeOptions = { recursive: true, dereference: true };
// The npm tarball does not ship the brand images, so package READMEs must
// reference them through the canonical raw GitHub URL instead of repo-relative
// paths (npmjs.com cannot resolve relative paths without a repository field,
// and the monorepo `directory` field would resolve them wrongly anyway).
const brandAssetRawBaseUrl =
  "https://raw.githubusercontent.com/Lanzhou3/ForgeBadger/main/packages/web/public/brand/";

const restoreWebNextEnv = await preserveFile(webNextEnv);

try {
  await rm(cliDist, { recursive: true, force: true });
  await rm(gatewayDist, { recursive: true, force: true });

  run("pnpm", ["--filter", "@forgebadger/gateway", "build"]);
  run("pnpm", ["--filter", "@forgebadger/web", "build"]);
  run("pnpm", ["--filter", "forgebadger", "build"]);

  await rm(gatewayTarget, { recursive: true, force: true });
  await rm(webTarget, { recursive: true, force: true });
  await mkdir(cliDist, { recursive: true });

  await cp(path.join(workspaceRoot, "packages/gateway/dist"), gatewayTarget, copyTreeOptions);
  await cp(path.join(workspaceRoot, "packages/web/.next/standalone"), webStandaloneTarget, copyTreeOptions);
  await materializePnpmAliases(path.join(webStandaloneTarget, "node_modules"));
  await removeBundledWebNativeDependencies(path.join(webStandaloneTarget, "node_modules"));
  await mkdir(path.join(webStandalonePackage, ".next"), { recursive: true });
  await cp(path.join(workspaceRoot, "packages/web/.next/static"), path.join(webStandalonePackage, ".next", "static"), copyTreeOptions);
  await cp(path.join(workspaceRoot, "packages/web/public"), path.join(webStandalonePackage, "public"), copyTreeOptions);

  await rm(cliReadme, { recursive: true, force: true });
  await rm(cliLicense, { recursive: true, force: true });
  await rm(cliDocs, { recursive: true, force: true });
  await copyReadmeForNpm(path.join(workspaceRoot, "README.md"), cliReadme);
  await cp(path.join(workspaceRoot, "LICENSE"), cliLicense);
  await mkdir(cliDocs, { recursive: true });
  await copyReadmeForNpm(path.join(workspaceRoot, "docs/README.zh-CN.md"), path.join(cliDocs, "README.zh-CN.md"));
  await copyReadmeForNpm(path.join(workspaceRoot, "docs/README.zh-TW.md"), path.join(cliDocs, "README.zh-TW.md"));

  run("node", ["scripts/verify-npm-package.mjs"]);
} finally {
  await restoreWebNextEnv();
}

async function copyReadmeForNpm(sourcePath, targetPath) {
  const content = await readFile(sourcePath, "utf8");
  const rewritten = content.replace(
    /(src=")(?:\.\.\/)*packages\/web\/public\/brand\//g,
    `$1${brandAssetRawBaseUrl}`
  );
  await writeFile(targetPath, rewritten);
}

function run(command, args) {
  runCommand(command, args, { cwd: workspaceRoot, printOutput: true });
}

async function preserveFile(filePath) {
  if (!existsSync(filePath)) {
    return async () => {
      await rm(filePath, { force: true });
    };
  }
  const original = await readFile(filePath);
  return async () => {
    await writeFile(filePath, original);
  };
}

async function materializePnpmAliases(nodeModulesDir) {
  const aliasRoot = path.join(nodeModulesDir, ".pnpm", "node_modules");
  if (!existsSync(aliasRoot)) {
    return;
  }

  const entries = await readdir(aliasRoot, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(aliasRoot, entry.name);
    if (entry.name.startsWith("@")) {
      await materializeScopedPackageAliases(source, path.join(nodeModulesDir, entry.name));
      continue;
    }
    await copyAliasIfMissing(source, path.join(nodeModulesDir, entry.name));
  }
}

async function materializeScopedPackageAliases(sourceScopeDir, targetScopeDir) {
  const entries = await readdir(sourceScopeDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(sourceScopeDir, entry.name);
    await copyAliasIfMissing(source, path.join(targetScopeDir, entry.name));
  }
}

async function copyAliasIfMissing(source, target) {
  if (existsSync(target)) {
    return;
  }
  await cp(source, target, copyTreeOptions);
}

async function removeBundledWebNativeDependencies(nodeModulesDir) {
  await rm(path.join(nodeModulesDir, "sharp"), { recursive: true, force: true });
  await rm(path.join(nodeModulesDir, "@img"), { recursive: true, force: true });

  const pnpmStore = path.join(nodeModulesDir, ".pnpm");
  if (!existsSync(pnpmStore)) {
    return;
  }

  for (const entry of await readdir(pnpmStore, { withFileTypes: true })) {
    if (entry.name.startsWith("sharp@") || entry.name.startsWith("@img+")) {
      await rm(path.join(pnpmStore, entry.name), { recursive: true, force: true });
    }
  }
  await rm(path.join(pnpmStore, "node_modules", "sharp"), { recursive: true, force: true });
  await rm(path.join(pnpmStore, "node_modules", "@img"), { recursive: true, force: true });
}
