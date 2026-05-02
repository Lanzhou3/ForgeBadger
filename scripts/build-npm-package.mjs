import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const cliDist = path.resolve("packages/cli/dist");
const gatewayTarget = path.join(cliDist, "gateway");
const webTarget = path.join(cliDist, "web");
const webStandaloneTarget = path.join(webTarget, "standalone");
const webStandalonePackage = path.join(webStandaloneTarget, "packages", "web");

run("pnpm", ["--filter", "@openforge/gateway", "build"]);
run("pnpm", ["--filter", "@openforge/web", "build"]);
run("pnpm", ["--filter", "openforge", "build"]);

await rm(gatewayTarget, { recursive: true, force: true });
await rm(webTarget, { recursive: true, force: true });
await mkdir(cliDist, { recursive: true });

await cp("packages/gateway/dist", gatewayTarget, { recursive: true });
await cp("packages/web/.next/standalone", webStandaloneTarget, { recursive: true });
await mkdir(path.join(webStandalonePackage, ".next"), { recursive: true });
await cp("packages/web/.next/static", path.join(webStandalonePackage, ".next", "static"), { recursive: true });
await cp("packages/web/public", path.join(webStandalonePackage, "public"), { recursive: true });

await cp("README.md", "packages/cli/README.md");
await cp("LICENSE", "packages/cli/LICENSE");
await mkdir("packages/cli/docs", { recursive: true });
await cp("docs/README.zh-CN.md", "packages/cli/docs/README.zh-CN.md");
await cp("docs/README.zh-TW.md", "packages/cli/docs/README.zh-TW.md");

run("node", ["scripts/verify-npm-package.mjs"]);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
  if (result.signal) {
    throw new Error(`${command} ${args.join(" ")} failed with signal ${result.signal}`);
  }
}
