#!/usr/bin/env node

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
  if (command !== "start") {
    throw new Error(`Unknown command: ${command}`);
  }

  return parseStartArgs(rest);
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

function parsePort(value: string, flag: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
  return port;
}
