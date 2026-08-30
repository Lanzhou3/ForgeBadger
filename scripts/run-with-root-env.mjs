#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export async function buildRootEnv(options = {}) {
  const rootDir = options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dotenvPath = options.dotenvPath ?? path.join(rootDir, ".env");
  const inherited = sanitizeEnv(options.env ?? process.env);
  if (!existsSync(dotenvPath)) {
    return applyLegacyAliases(inherited);
  }

  const dotenv = parseEnv(await readFile(dotenvPath, "utf8"));
  return applyLegacyAliases({
    ...dotenv,
    ...inherited
  });
}

export function applyLegacyAliases(env) {
  const normalized = { ...env };
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("OPENFORGE_") || value === undefined) continue;
    const currentName = `FORGEBADGER_${name.slice("OPENFORGE_".length)}`;
    normalized[currentName] ??= value;
  }
  return normalized;
}

export function buildRunCommand(argv, options = {}) {
  if (argv.length === 0) {
    throw new Error("Usage: run-with-root-env [--shell <command>] <command> [...args]");
  }

  if (argv[0] === "--shell") {
    const commandText = argv[1];
    if (!commandText || argv.length > 2) {
      throw new Error("Usage: run-with-root-env --shell <command>");
    }
    return {
      command: options.shell ?? process.env.SHELL ?? "sh",
      args: ["-lc", commandText]
    };
  }

  return {
    command: argv[0],
    args: argv.slice(1)
  };
}

export async function runWithRootEnv(argv = process.argv.slice(2), options = {}) {
  const env = await buildRootEnv(options);
  const invocation = buildRunCommand(argv, options);

  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      env,
      stdio: "inherit"
    });

    child.on("error", (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      resolve(127);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        process.stderr.write(`Command terminated by ${signal}\n`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function sanitizeEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter((entry) => entry[1] !== undefined)
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWithRootEnv().then((code) => {
    process.exitCode = code;
  });
}
