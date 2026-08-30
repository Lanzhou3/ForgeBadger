import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

const strictEnvBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .default(false)
  .transform((value) => value === true || value === "true");

const featureFlagBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .default(false)
  .transform((value) => value === true || value === "true" || value === "1");

const envSchema = z.object({
  FORGEBADGER_PORT: z.coerce.number().int().positive().default(3000),
  FORGEBADGER_HOST: z.string().default("127.0.0.1"),
  FORGEBADGER_STATE_DIR: z.string(),
  FORGEBADGER_DB_PATH: z.string(),
  FORGEBADGER_JWT_SECRET: z.string().min(32),
  FORGEBADGER_TMUX_PREFIX: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("of-"),
  FORGEBADGER_REGISTRATION: z.enum(["open", "off", "invite"]).default("open"),
  FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED: strictEnvBoolean,
  FORGEBADGER_DSH_COPILOT_ENABLED: featureFlagBoolean,
  FORGEBADGER_COPILOT_REACTIVE_ENABLED: featureFlagBoolean,
  FORGEBADGER_DSH_IDLE_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  FORGEBADGER_DSH_BRIDGE_LAUNCHER: z.string().min(1).optional(),
  FORGEBADGER_COPILOT_BRIDGE_TOKEN: z.string().min(32).optional(),
  FORGEBADGER_DISPATCH_CONFIRM_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
  FORGEBADGER_DISPATCH_CONFIRM_INTERVAL_MS: z.coerce.number().int().positive().default(300),
  FORGEBADGER_MASTER_KEY: z.string().refine((value) => isValidMasterKey(value), {
    message: "FORGEBADGER_MASTER_KEY must be 32 bytes or 64 hex characters"
  })
});

export type GatewayEnv = z.infer<typeof envSchema>;

const ENV_SUFFIXES = [
  "PORT",
  "HOST",
  "STATE_DIR",
  "DB_PATH",
  "JWT_SECRET",
  "TMUX_PREFIX",
  "REGISTRATION",
  "PROJECT_MANAGER_AUTO_DISPATCH_ENABLED",
  "DSH_COPILOT_ENABLED",
  "COPILOT_REACTIVE_ENABLED",
  "DSH_IDLE_MS",
  "DSH_BRIDGE_LAUNCHER",
  "COPILOT_BRIDGE_TOKEN",
  "DISPATCH_CONFIRM_TIMEOUT_MS",
  "DISPATCH_CONFIRM_INTERVAL_MS",
  "MASTER_KEY"
] as const;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): GatewayEnv {
  return envSchema.parse(normalizeEnvironment(input));
}

function normalizeEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalized: NodeJS.ProcessEnv = { ...input };
  for (const suffix of ENV_SUFFIXES) {
    const currentName = `FORGEBADGER_${suffix}`;
    const legacyName = `OPENFORGE_${suffix}`;
    normalized[currentName] ??= input[legacyName];
  }

  const stateSelection = resolveDefaultStateDir(input);
  normalized.FORGEBADGER_STATE_DIR ??= stateSelection.path;
  normalized.FORGEBADGER_DB_PATH ??= resolveDefaultDbPath(input, stateSelection);
  return normalized;
}

interface StateSelection {
  path: string;
  legacy: boolean;
}

function resolveDefaultStateDir(input: NodeJS.ProcessEnv): StateSelection {
  if (input.FORGEBADGER_STATE_DIR) return { path: input.FORGEBADGER_STATE_DIR, legacy: false };
  if (input.OPENFORGE_STATE_DIR) return { path: input.OPENFORGE_STATE_DIR, legacy: true };

  const currentPath = path.join(homedir(), ".forgebadger");
  const legacyPath = path.join(homedir(), ".openforge");
  if (!existsSync(currentPath) && existsSync(legacyPath)) {
    return { path: legacyPath, legacy: true };
  }
  return { path: currentPath, legacy: false };
}

function resolveDefaultDbPath(input: NodeJS.ProcessEnv, state: StateSelection): string {
  if (input.FORGEBADGER_DB_PATH) return input.FORGEBADGER_DB_PATH;
  if (input.OPENFORGE_DB_PATH) return input.OPENFORGE_DB_PATH;
  const currentPath = path.join(state.path, "forgebadger.db");
  const legacyPath = path.join(state.path, "openforge.db");
  if (state.legacy || (!existsSync(currentPath) && existsSync(legacyPath))) {
    return legacyPath;
  }
  return currentPath;
}

function isValidMasterKey(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value) || Buffer.byteLength(value, "utf8") === 32;
}
