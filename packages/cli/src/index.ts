#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runStart, type RunStartOptions } from "./commands/start.js";

export type CliCommand =
  | {
      command: "start";
      gatewayPort: number | undefined;
      webPort: number | undefined;
      host: string | undefined;
      openBrowser: boolean;
    }
  | { command: "doctor" }
  | { command: "config"; args: string[] }
  | { command: "init"; args: string[] }
  | { command: "help" };

export interface RunCliOptions {
  doctorRunner?: () => Promise<number>;
  initRunner?: (args: string[]) => Promise<number>;
  startRunner?: (command: Extract<CliCommand, { command: "start" }>) => Promise<number>;
}

export function parseCliArgs(args: string[]): CliCommand {
  const [command = "start", ...rest] = args;
  if (command === "init") {
    return { command: "init", args };
  }
  if (command === "doctor") {
    return { command: "doctor" };
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
  if (command.command === "start") {
    if (options.startRunner) {
      return options.startRunner(command);
    }
    return runStart(toRunStartOptions(command));
  }
  if (command.command === "doctor") {
    return (options.doctorRunner ?? runDoctor)();
  }
  if (command.command === "init") {
    return (options.initRunner ?? runInit)(command.args);
  }
  if (command.command === "help") {
    process.stdout.write("Usage: forgebadger [start|doctor|init|config]\n");
    return 0;
  }
  throw new Error(`Command not implemented yet: ${command.command}`);
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
