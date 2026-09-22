import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { createInstanceBackup } from "../runtime/backup.js";
import {
  inspectRuntimeConfig,
  type LoadRuntimeConfigOptions,
  type RuntimeConfigInspection
} from "../runtime/config.js";
import { assertPortAvailable } from "../runtime/ports.js";

interface OutputWriter {
  write(chunk: string): unknown;
}

export interface RunUninstallOptions {
  yes?: boolean;
  force?: boolean;
  backup?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  isTTY?: boolean;
  inspectConfig?: (options: LoadRuntimeConfigOptions) => Promise<RuntimeConfigInspection>;
  confirm?: (question: string) => Promise<boolean>;
  removeDir?: (dir: string) => Promise<void>;
  checkPort?: (host: string, port: number) => Promise<void>;
  backupRunner?: (options: { output: string } & LoadRuntimeConfigOptions) => Promise<unknown>;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
}

export async function runUninstall(options: RunUninstallOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir;
  const inspectConfig = options.inspectConfig ?? inspectRuntimeConfig;
  const inspection = await inspectConfig(toRuntimeConfigOptions(options));
  const stateDir = inspection.stateDir;

  if (!inspection.initialized && !(await isDirectory(stateDir))) {
    stdout.write(`ForgeBadger state: ${stateDir} (not initialized), nothing to uninstall.\n`);
    stdout.write("To finish uninstalling, run: npm uninstall -g forgebadger\n");
    return 0;
  }

  const guardFailure = stateDirGuardFailure(stateDir, homeDir);
  if (guardFailure) {
    stderr.write(`${guardFailure}\n`);
    return 1;
  }

  if (!options.force && !(await hasStateMarker(stateDir))) {
    stderr.write(
      `Refusing to remove ${stateDir}: no config.json or forgebadger.db found. Use --force to remove it anyway.\n`
    );
    return 1;
  }

  const checkPort = options.checkPort ?? assertPortAvailable;
  if (!options.force && inspection.initialized) {
    try {
      await checkPort(inspection.gateway.host, inspection.gateway.port);
      await checkPort(inspection.web.host, inspection.web.port);
    } catch {
      stderr.write(
        `ForgeBadger appears to be running (port ${inspection.gateway.port} or ${inspection.web.port} is in use). Stop it before uninstalling, or use --force to skip this check.\n`
      );
      return 1;
    }
  }

  if (!options.yes) {
    const isTTY = options.isTTY ?? process.stdin.isTTY === true;
    if (!isTTY) {
      stderr.write("Uninstall requires confirmation. Re-run with --yes in non-interactive mode.\n");
      return 1;
    }
    const confirm = options.confirm ?? defaultConfirm;
    const accepted = await confirm(
      `Delete ${stateDir}? This removes the database, master key, backups and runtime state. [y/N] `
    );
    if (!accepted) {
      stdout.write("Uninstall cancelled.\n");
      return 0;
    }
  }

  if (options.backup) {
    const backupRunner = options.backupRunner ?? createInstanceBackup;
    await backupRunner({ output: options.backup, ...toRuntimeConfigOptions(options) });
    stdout.write(`Backup created: ${options.backup}\n`);
  }

  const removeDir = options.removeDir ?? ((dir: string) => rm(dir, { recursive: true, force: true }));
  try {
    await removeDir(stateDir);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      stderr.write(`Unable to remove ${stateDir}: files are in use. Stop running ForgeBadger processes and try again.\n`);
      return 1;
    }
    throw error;
  }

  stdout.write(`State removed: ${stateDir}\n`);
  stdout.write("To finish uninstalling, run: npm uninstall -g forgebadger\n");
  return 0;
}

function toRuntimeConfigOptions(options: RunUninstallOptions): LoadRuntimeConfigOptions {
  const result: LoadRuntimeConfigOptions = {};
  if (options.stateDir !== undefined) result.stateDir = options.stateDir;
  if (options.env !== undefined) result.env = options.env;
  if (options.homeDir !== undefined) result.homeDir = options.homeDir;
  return result;
}

function stateDirGuardFailure(stateDir: string, homeDir: string | undefined): string | undefined {
  const resolved = path.resolve(stateDir);
  if (resolved === path.parse(resolved).root) {
    return `Refusing to remove filesystem root: ${resolved}`;
  }
  if (homeDir !== undefined && resolved === path.resolve(homeDir)) {
    return `Refusing to remove the home directory: ${resolved}`;
  }
  return undefined;
}

async function hasStateMarker(stateDir: string): Promise<boolean> {
  return (await isFile(path.join(stateDir, "config.json"))) || (await isFile(path.join(stateDir, "forgebadger.db")));
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await lstat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function defaultConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}
