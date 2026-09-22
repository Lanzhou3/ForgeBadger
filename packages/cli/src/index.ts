#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runBackup } from "./commands/backup.js";
import { runRestore } from "./commands/restore.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runStart, type RunStartOptions } from "./commands/start.js";
import { runUninstall, type RunUninstallOptions } from "./commands/uninstall.js";
import { resolveCliVersion } from "./runtime/version.js";

export type CliCommand =
  | {
      command: "start";
      gatewayPort: number | undefined;
      webPort: number | undefined;
      host: string | undefined;
      openBrowser: boolean;
    }
  | { command: "doctor" }
  | { command: "backup"; output: string }
  | { command: "restore"; from: string; to: string }
  | { command: "uninstall"; yes: boolean; force: boolean; backup: string | undefined }
  | { command: "version" }
  | { command: "config"; args: string[] }
  | { command: "init"; args: string[] }
  | { command: "help" };

export interface RunCliOptions {
  backupRunner?: (command: Extract<CliCommand, { command: "backup" }>) => Promise<number>;
  restoreRunner?: (command: Extract<CliCommand, { command: "restore" }>) => Promise<number>;
  doctorRunner?: () => Promise<number>;
  initRunner?: (args: string[]) => Promise<number>;
  startRunner?: (command: Extract<CliCommand, { command: "start" }>) => Promise<number>;
  uninstallRunner?: (command: Extract<CliCommand, { command: "uninstall" }>) => Promise<number>;
  versionRunner?: () => Promise<number>;
}

export function parseCliArgs(args: string[]): CliCommand {
  const [command = "start", ...rest] = args;
  if (command === "backup" || command === "restore") {
    return parseBackupArgs(command, rest);
  }
  if (command === "init") {
    return { command: "init", args };
  }
  if (command === "doctor") {
    return { command: "doctor" };
  }
  if (command === "uninstall") {
    return parseUninstallArgs(rest);
  }
  if (command === "version" || command === "--version" || command === "-v") {
    return { command: "version" };
  }
  if (command === "config") {
    return { command: "config", args: rest };
  }
  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
  }
  if (command === "start") {
    return parseStartArgs(rest);
  }
  if (isStartFlag(command)) {
    return parseStartArgs(args);
  }
  throw new Error(`Unknown command: ${command}`);
}

function parseBackupArgs(command: "backup" | "restore", args: string[]): CliCommand {
  const allowed = command === "backup" ? ["--output"] : ["--from", "--to"];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!;
    const value = args[index + 1];
    if (!allowed.includes(flag) || values.has(flag)) throw new Error("Unexpected or duplicate backup/restore option");
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
  }
  if (allowed.some((flag) => !values.has(flag))) throw new Error(`Required options: ${allowed.join(" ")}`);
  return command === "backup" ? { command, output: values.get("--output")! } : { command, from: values.get("--from")!, to: values.get("--to")! };
}

function parseUninstallArgs(args: string[]): Extract<CliCommand, { command: "uninstall" }> {
  const command: Extract<CliCommand, { command: "uninstall" }> = {
    command: "uninstall",
    yes: false,
    force: false,
    backup: undefined
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--yes") {
      command.yes = true;
      continue;
    }
    if (token === "--force") {
      command.force = true;
      continue;
    }
    if (token === "--backup") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --backup");
      if (command.backup !== undefined) throw new Error("Unexpected or duplicate uninstall option");
      command.backup = value;
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }
  return command;
}

function parseStartArgs(args: string[]): Extract<CliCommand, { command: "start" }> {
  const command: Extract<CliCommand, { command: "start" }> = {
    command: "start",
    gatewayPort: undefined,
    webPort: undefined,
    host: undefined,
    openBrowser: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--open") {
      command.openBrowser = true;
      continue;
    }
    if (token === "--gateway-port" || token === "--web-port" || token === "--host") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${token}`);
      }
      if (token === "--gateway-port") {
        command.gatewayPort = parsePort(value, token);
      }
      if (token === "--web-port") {
        command.webPort = parsePort(value, token);
      }
      if (token === "--host") {
        command.host = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }
  return command;
}

function isStartFlag(token: string): boolean {
  return token === "--open" || token === "--gateway-port" || token === "--web-port" || token === "--host";
}

function parsePort(value: string, flag: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
  return port;
}

export async function runCli(args = process.argv.slice(2), options: RunCliOptions = {}): Promise<number> {
  const command = parseCliArgs(args);
  if (command.command === "backup") return (options.backupRunner ?? runBackup)(command);
  if (command.command === "restore") return (options.restoreRunner ?? runRestore)(command);
  if (command.command === "start") {
    if (options.startRunner) {
      return options.startRunner(command);
    }
    return runStart(toRunStartOptions(command));
  }
  if (command.command === "doctor") {
    return (options.doctorRunner ?? runDoctor)();
  }
  if (command.command === "uninstall") {
    if (options.uninstallRunner) {
      return options.uninstallRunner(command);
    }
    return runUninstall(toRunUninstallOptions(command));
  }
  if (command.command === "version") {
    if (options.versionRunner) {
      return options.versionRunner();
    }
    process.stdout.write(`forgebadger ${await resolveCliVersion()}\n`);
    return 0;
  }
  if (command.command === "init") {
    return (options.initRunner ?? runInit)(command.args);
  }
  if (command.command === "help") {
    process.stdout.write("Usage: forgebadger [start|doctor|init|config|uninstall [--yes] [--force] [--backup <dir>]|backup --output <new-dir>|restore --from <backup-dir> --to <new-state-dir>|version]\n");
    return 0;
  }
  throw new Error(`Command not implemented yet: ${command.command}`);
}

function toRunUninstallOptions(command: Extract<CliCommand, { command: "uninstall" }>): RunUninstallOptions {
  const options: RunUninstallOptions = {
    yes: command.yes,
    force: command.force
  };
  if (command.backup !== undefined) {
    options.backup = command.backup;
  }
  return options;
}

function toRunStartOptions(command: Extract<CliCommand, { command: "start" }>): RunStartOptions {
  const options: RunStartOptions = {
    openBrowser: command.openBrowser
  };
  if (command.gatewayPort !== undefined) {
    options.gatewayPort = command.gatewayPort;
  }
  if (command.webPort !== undefined) {
    options.webPort = command.webPort;
  }
  if (command.host !== undefined) {
    options.host = command.host;
  }
  return options;
}

export function isMainModule(argv1 = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (!argv1) {
    return false;
  }
  return safeRealPath(path.resolve(argv1)) === safeRealPath(fileURLToPath(moduleUrl));
}

function safeRealPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

if (isMainModule()) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
