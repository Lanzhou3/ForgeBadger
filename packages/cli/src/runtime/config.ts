import { randomBytes } from "node:crypto";
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
}

export async function loadOrCreateRuntimeConfig(
  options: LoadRuntimeConfigOptions = {}
): Promise<RuntimeConfig> {
  const stateDir = resolveStateDir(options.stateDir);
  const configPath = path.join(stateDir, "config.json");

  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700).catch(() => undefined);

  if (await isExistingConfigFile(configPath)) {
    await chmod(configPath, 0o600).catch(() => undefined);
    const config = runtimeConfigSchema.parse(await readRuntimeConfigJson(configPath));
    return applyRuntimeOverrides(config, options);
  }

  const config: RuntimeConfig = {
    version: 1,
    stateDir,
    dbPath: path.join(stateDir, "openforge.db"),
    gateway: { host: "127.0.0.1", port: 48731 },
    web: { host: "127.0.0.1", port: 48732 },
    secrets: {
      masterKey: randomBytes(32).toString("hex"),
      jwtSecret: randomBytes(48).toString("base64url")
    }
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await chmod(configPath, 0o600).catch(() => undefined);

  return applyRuntimeOverrides(config, options);
}

export function resolveStateDir(stateDir: string | undefined, homeDir = homedir()): string {
  const configuredStateDir = stateDir ?? process.env.OPENFORGE_STATE_DIR ?? path.join(homeDir, ".openforge");
  return path.resolve(expandHomeDir(configuredStateDir, homeDir));
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
    throw new Error(`Invalid OpenForge runtime config JSON: ${configPath}`, { cause: error });
  }
}

function applyRuntimeOverrides(config: RuntimeConfig, options: LoadRuntimeConfigOptions): RuntimeConfig {
  return runtimeConfigSchema.parse({
    ...config,
    gateway: {
      host: options.host ?? config.gateway.host,
      port: options.gatewayPort ?? config.gateway.port
    },
    web: {
      host: options.host ?? config.web.host,
      port: options.webPort ?? config.web.port
    }
  });
}
