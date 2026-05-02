import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const cliDist = path.resolve("packages/cli/dist");
const gatewayTarget = path.join(cliDist, "gateway");
const webTarget = path.join(cliDist, "web");
const webStandaloneTarget = path.join(webTarget, "standalone");
const webStandalonePackage = path.join(webStandaloneTarget, "packages", "web");
const webNextEnv = path.resolve("packages/web/next-env.d.ts");
const gatewayDist = path.resolve("packages/gateway/dist");
const cliReadme = path.resolve("packages/cli/README.md");
const cliLicense = path.resolve("packages/cli/LICENSE");
const cliDocs = path.resolve("packages/cli/docs");
const copyTreeOptions = { recursive: true, dereference: true };

const restoreWebNextEnv = await preserveFile(webNextEnv);

try {
  await rm(cliDist, { recursive: true, force: true });
  await rm(gatewayDist, { recursive: true, force: true });

  run("pnpm", ["--filter", "@openforge/gateway", "build"]);
  run("pnpm", ["--filter", "@openforge/web", "build"]);
  run("pnpm", ["--filter", "openforge", "build"]);

  await rm(gatewayTarget, { recursive: true, force: true });
  await rm(webTarget, { recursive: true, force: true });
  await mkdir(cliDist, { recursive: true });

  await cp("packages/gateway/dist", gatewayTarget, copyTreeOptions);
  await cp("packages/web/.next/standalone", webStandaloneTarget, copyTreeOptions);
  await materializePnpmAliases(path.join(webStandaloneTarget, "node_modules"));
  await mkdir(path.join(webStandalonePackage, ".next"), { recursive: true });
  await cp("packages/web/.next/static", path.join(webStandalonePackage, ".next", "static"), copyTreeOptions);
  await cp("packages/web/public", path.join(webStandalonePackage, "public"), copyTreeOptions);

  await rm(cliReadme, { recursive: true, force: true });
  await rm(cliLicense, { recursive: true, force: true });
  await rm(cliDocs, { recursive: true, force: true });
  await cp("README.md", cliReadme);
  await cp("LICENSE", cliLicense);
  await mkdir(cliDocs, { recursive: true });
  await cp("docs/README.zh-CN.md", path.join(cliDocs, "README.zh-CN.md"));
  await cp("docs/README.zh-TW.md", path.join(cliDocs, "README.zh-TW.md"));

  run("node", ["scripts/verify-npm-package.mjs"]);
} finally {
  await restoreWebNextEnv();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
  if (result.signal) {
    throw new Error(`${command} ${args.join(" ")} failed with signal ${result.signal}`);
  }
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
