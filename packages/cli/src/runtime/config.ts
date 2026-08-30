import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

const runtimeConfigSchema = z.object({
  version: z.literal(1),
  stateDir: z.string().min(1),
  dbPath: z.string().min(1),
  gateway: z.object({
    host: z.string().min(1),
    port: z.number().int().positive().max(65535)
  }),
  web: z.object({
    host: z.string().min(1),
    port: z.number().int().positive().max(65535)
  }),
  secrets: z.object({
    masterKey: z.string().regex(/^[a-f0-9]{64}$/),
    jwtSecret: z.string().min(32)
  })
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export interface LoadRuntimeConfigOptions {
  stateDir?: string;
  gatewayPort?: number;
  webPort?: number;
  host?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export async function loadOrCreateRuntimeConfig(
  options: LoadRuntimeConfigOptions = {}
): Promise<RuntimeConfig> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const stateDir = resolveStateDir(options.stateDir, homeDir, env);
  const configPath = path.join(stateDir, "config.json");

  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700).catch(() => undefined);

  if (await isExistingConfigFile(configPath)) {
    await chmod(configPath, 0o600).catch(() => undefined);
    const config = runtimeConfigSchema.parse(await readRuntimeConfigJson(configPath));
    return applyRuntimeOverrides(config, options, env, homeDir);
  }

  const config: RuntimeConfig = {
    version: 1,
    stateDir,
    dbPath: resolveDefaultDbPath(stateDir),
    gateway: { host: "127.0.0.1", port: 48731 },
    web: { host: "127.0.0.1", port: 48732 },
    secrets: {
      masterKey: randomBytes(32).toString("hex"),
      jwtSecret: randomBytes(48).toString("base64url")
    }
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await chmod(configPath, 0o600).catch(() => undefined);

  return applyRuntimeOverrides(config, options, env, homeDir);
}

export function resolveStateDir(
  stateDir: string | undefined,
  homeDir = homedir(),
  env: NodeJS.ProcessEnv = process.env
): string {
  const configuredStateDir =
    stateDir ??
    env.FORGEBADGER_STATE_DIR ??
    env.OPENFORGE_STATE_DIR ??
    chooseDefaultStateDir(homeDir);
  return path.resolve(expandHomeDir(configuredStateDir, homeDir));
}

function chooseDefaultStateDir(homeDir: string): string {
  const currentDir = path.join(homeDir, ".forgebadger");
  const legacyDir = path.join(homeDir, ".openforge");
  return !existsSync(currentDir) && existsSync(legacyDir) ? legacyDir : currentDir;
}

function resolveDefaultDbPath(stateDir: string): string {
  const legacyDbPath = path.join(stateDir, "openforge.db");
  return existsSync(legacyDbPath) ? legacyDbPath : path.join(stateDir, "forgebadger.db");
}

function expandHomeDir(filePath: string, homeDir: string): string {
  if (filePath === "~") {
    return homeDir;
  }
  if (filePath.startsWith("~/")) {
    return path.join(homeDir, filePath.slice(2));
  }
  return filePath;
}

async function isExistingConfigFile(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Runtime config must be a regular file: ${filePath}`);
    }
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function readRuntimeConfigJson(configPath: string): Promise<unknown> {
  const content = await readFile(configPath, "utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid ForgeBadger runtime config JSON: ${configPath}`, { cause: error });
  }
}

function applyRuntimeOverrides(
  config: RuntimeConfig,
  options: LoadRuntimeConfigOptions,
  env: NodeJS.ProcessEnv,
  homeDir: string
): RuntimeConfig {
  const configuredDbPath = nonEmptyEnv(env.FORGEBADGER_DB_PATH);
  return runtimeConfigSchema.parse({
    ...config,
    dbPath: configuredDbPath
      ? path.resolve(expandHomeDir(configuredDbPath, homeDir))
      : config.dbPath,
    gateway: {
      host: options.host ?? nonEmptyEnv(env.FORGEBADGER_HOST) ?? config.gateway.host,
      port: options.gatewayPort ?? parseEnvPort(env.FORGEBADGER_PORT, "FORGEBADGER_PORT") ?? config.gateway.port
    },
    web: {
      host: options.host ?? nonEmptyEnv(env.FORGEBADGER_WEB_HOST) ?? config.web.host,
      port: options.webPort ?? parseEnvPort(env.FORGEBADGER_WEB_PORT, "FORGEBADGER_WEB_PORT") ?? config.web.port
    }
  });
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseEnvPort(value: string | undefined, variableName: string): number | undefined {
  const normalized = nonEmptyEnv(value);
  if (normalized === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${variableName} must be an integer between 1 and 65535`);
  }
  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${variableName} must be an integer between 1 and 65535`);
  }
  return port;
}
