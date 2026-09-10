import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { expandUserPath } from "../lib/user-path.js";

const strictEnvBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .default(false)
  .transform((value) => value === true || value === "true");

const envSchema = z.object({
  FORGEBADGER_PORT: z.coerce.number().int().positive().default(3000),
  FORGEBADGER_HOST: z.string().default("127.0.0.1"),
  FORGEBADGER_STATE_DIR: z.string(),
  FORGEBADGER_DB_PATH: z.string(),
  FORGEBADGER_JWT_SECRET: z.string().min(32),
  FORGEBADGER_SESSION_PREFIX: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("fb-"),
  FORGEBADGER_REGISTRATION: z.enum(["open", "off", "invite"]).default("open"),
  FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED: strictEnvBoolean,
  FORGEBADGER_MASTER_KEY: z.string().refine((value) => isValidMasterKey(value), {
    message: "FORGEBADGER_MASTER_KEY must be 32 bytes or 64 hex characters"
  }),
  FORGEBADGER_SESSION_SERVER_IPC_PATH: z.string().optional()
}).superRefine((env, ctx) => {
  // A custom IPC endpoint must stay inside the state directory (which the
  // Session Server locks down to 0700) so the socket inherits the same
  // access control. POSIX-only: Windows uses named pipes without a path.
  const ipcPath = env.FORGEBADGER_SESSION_SERVER_IPC_PATH;
  if (!ipcPath || process.platform === "win32") return;
  const relative = path.relative(env.FORGEBADGER_STATE_DIR, ipcPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FORGEBADGER_SESSION_SERVER_IPC_PATH"],
      message: "FORGEBADGER_SESSION_SERVER_IPC_PATH must resolve to a file inside FORGEBADGER_STATE_DIR"
    });
  }
});

export type GatewayEnv = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): GatewayEnv {
  return envSchema.parse(normalizeEnvironment(input));
}

function normalizeEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalized: NodeJS.ProcessEnv = { ...input };
  const stateDir = path.resolve(
    expandUserPath(input.FORGEBADGER_STATE_DIR ?? path.join(homedir(), ".forgebadger"))
  );
  normalized.FORGEBADGER_STATE_DIR = stateDir;
  normalized.FORGEBADGER_DB_PATH = path.resolve(
    expandUserPath(input.FORGEBADGER_DB_PATH ?? path.join(stateDir, "forgebadger.db"))
  );
  if (input.FORGEBADGER_SESSION_SERVER_IPC_PATH) {
    normalized.FORGEBADGER_SESSION_SERVER_IPC_PATH = path.resolve(
      expandUserPath(input.FORGEBADGER_SESSION_SERVER_IPC_PATH)
    );
  }
  return normalized;
}

function isValidMasterKey(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value) || Buffer.byteLength(value, "utf8") === 32;
}
