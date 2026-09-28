#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export async function buildRootEnv(options = {}) {
  const rootDir = options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dotenvPath = options.dotenvPath ?? path.join(rootDir, ".env");
  const inherited = sanitizeEnv(options.env ?? process.env);
  if (!existsSync(dotenvPath)) {
    return inherited;
  }

  const dotenv = parseEnv(await readFile(dotenvPath, "utf8"));
  return {
    ...dotenv,
    ...inherited
  };
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

export function expandShellDefaults(commandText, env) {
  return commandText.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/gu,
    (match, name, fallback) => {
      const value = env[name];
      if (value === undefined || value === "") return fallback ?? "";
      return value;
    }
  );
}

export function buildWindowsInvocation(invocation, env) {
  if (invocation.args[0] === "-lc") {
    const commandText = expandShellDefaults(invocation.args[1] ?? "", env);
    return {
      command: env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", commandText]
    };
  }

  return {
    command: invocation.command,
    args: invocation.args,
    useShell: true
  };
}

export async function runWithRootEnv(argv = process.argv.slice(2), options = {}) {
  const env = await buildRootEnv(options);
  const invocation = buildRunCommand(argv, options);
  const resolved = process.platform === "win32" ? buildWindowsInvocation(invocation, env) : invocation;

  return new Promise((resolve) => {
    const child = spawn(resolved.command, resolved.args, {
      env,
      stdio: "inherit",
      ...(resolved.useShell ? { shell: true } : {})
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

const invokedAsMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsMain) {
  runWithRootEnv().then((code) => {
    process.exitCode = code;
  });
}
