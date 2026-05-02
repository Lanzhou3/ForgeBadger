import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nodeTestArgs = ["--test", "--import", "tsx"];
const nodeTestOptionsWithValue = new Set([
  "--test-concurrency",
  "--test-name-pattern",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-shard",
  "--test-skip-pattern",
  "--test-timeout"
]);

export async function resolveNodeTestArgs(args, cwd = process.cwd()) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const resolved = [];
  let preserveNextValue = false;

  for (const arg of normalizedArgs) {
    if (preserveNextValue) {
      resolved.push(arg);
      preserveNextValue = false;
      continue;
    }

    resolved.push(await resolveNodeTestArg(arg, cwd));
    preserveNextValue = takesFollowingValue(arg);
  }
  return resolved;
}

async function resolveNodeTestArg(arg, cwd) {
  if (arg.startsWith("-")) {
    return arg;
  }

  if (await exists(path.resolve(cwd, arg))) {
    return arg;
  }

  const testPath = path.join("test", arg);
  if (await exists(path.resolve(cwd, testPath))) {
    return testPath;
  }

  return arg;
}

function takesFollowingValue(arg) {
  if (arg.includes("=")) {
    return false;
  }
  return nodeTestOptionsWithValue.has(arg);
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isMainModule() {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  const args = await resolveNodeTestArgs(process.argv.slice(2));
  const result = spawnSync(process.execPath, [...nodeTestArgs, ...args], { stdio: "inherit" });

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  process.exit(result.status ?? 1);
}
