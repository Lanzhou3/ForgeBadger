import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const smokeRoot = await mkdtemp(path.join(tmpdir(), "openforge-npm-smoke-"));
const packDir = path.join(smokeRoot, "pack");
const npmPrefix = path.join(smokeRoot, "npm-prefix");
const npmCache = path.join(smokeRoot, "npm-cache");
const stateDir = path.join(smokeRoot, "state");

console.log(`OpenForge npm smoke root: ${smokeRoot}`);

await mkdir(packDir, { recursive: true });
run("pnpm", ["--dir", workspaceRoot, "build:npm"]);
run("pnpm", [
  "--dir",
  workspaceRoot,
  "--filter",
  "openforge",
  "pack",
  "--pack-destination",
  packDir
]);

const tarball = await findPackedTarball(packDir);
console.log(`Packed tarball: ${tarball}`);

run("npm", [
  "install",
  "--prefix",
  npmPrefix,
  "--cache",
  npmCache,
  "--ignore-scripts=false",
  "--no-audit",
  "--no-fund",
  tarball
]);

const openforgeBin = resolveOpenForgeBin(npmPrefix);
run(openforgeBin, ["doctor"], {
  env: {
    OPENFORGE_STATE_DIR: stateDir
  }
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
      ...options.env
    },
    encoding: "utf8",
    shell: false
  });

  if (result.status !== 0 || result.signal) {
    process.stderr.write(`\nCommand failed: ${command} ${args.join(" ")}\n`);
    if (typeof result.status === "number") {
      process.stderr.write(`Exit status: ${result.status}\n`);
    }
    if (result.signal) {
      process.stderr.write(`Signal: ${result.signal}\n`);
    }
    if (result.stdout) {
      process.stderr.write("\nstdout:\n");
      process.stderr.write(result.stdout);
      if (!result.stdout.endsWith("\n")) {
        process.stderr.write("\n");
      }
    }
    if (result.stderr) {
      process.stderr.write("\nstderr:\n");
      process.stderr.write(result.stderr);
      if (!result.stderr.endsWith("\n")) {
        process.stderr.write("\n");
      }
    }
    throw new Error(`${command} ${args.join(" ")} failed`);
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

async function findPackedTarball(directory) {
  const tarballs = [];
  await collectTarballs(directory, tarballs);

  if (tarballs.length === 0) {
    throw new Error(`pnpm pack did not create a .tgz file under ${directory}`);
  }

  tarballs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return tarballs[0].filePath;
}

async function collectTarballs(directory, tarballs) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectTarballs(filePath, tarballs);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".tgz")) {
      const stats = await stat(filePath);
      tarballs.push({ filePath, mtimeMs: stats.mtimeMs });
    }
  }
}

function resolveOpenForgeBin(prefix) {
  const extension = process.platform === "win32" ? ".cmd" : "";
  const candidates = [
    path.join(prefix, process.platform === "win32" ? "" : "bin", `openforge${extension}`),
    path.join(prefix, "node_modules", ".bin", `openforge${extension}`)
  ];
  const binPath = candidates.find((candidate) => existsSync(candidate));
  if (!binPath) {
    throw new Error(`Installed openforge binary was not found at ${candidates.join(" or ")}`);
  }
  return binPath;
}
