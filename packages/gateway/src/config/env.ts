import { z } from "zod";
import { homedir } from "node:os";
import path from "node:path";

// Accept parsed booleans so runtime wiring can safely validate an already-normalized GatewayEnv twice.
const strictEnvBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .default(false)
  .transform((value) => value === true || value === "true");

const envSchema = z.object({
  OPENFORGE_PORT: z.coerce.number().int().positive().default(3000),
  OPENFORGE_HOST: z.string().default("127.0.0.1"),
  OPENFORGE_STATE_DIR: z.string().default(path.join(homedir(), ".openforge")),
  OPENFORGE_DB_PATH: z.string().default(path.join(homedir(), ".openforge", "openforge.db")),
  OPENFORGE_JWT_SECRET: z.string().min(32),
  OPENFORGE_TMUX_PREFIX: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("of-"),
  OPENFORGE_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED: strictEnvBoolean,
  // Service token for the deepseek-harness openforge-bridge plugin's HTTP
  // callbacks. Optional: when unset, the whole /api/internal/v1/copilot-bridge
  // route group is not mounted at all — unless DSH copilot is enabled, in
  // which case an ephemeral per-boot token is generated (see start-gateway).
  OPENFORGE_COPILOT_BRIDGE_TOKEN: z.string().min(32).optional(),
  // Dispatch delivery confirmation (bridge dispatch path only): after tmux
  // send-keys, poll capture-pane until the message prefix is visible on screen.
  OPENFORGE_DISPATCH_CONFIRM_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
  OPENFORGE_DISPATCH_CONFIRM_INTERVAL_MS: z.coerce.number().int().positive().default(300),
  OPENFORGE_MASTER_KEY: z
    .string()
    .refine((value) => isValidMasterKey(value), {
      message: "OPENFORGE_MASTER_KEY must be 32 bytes or 64 hex characters"
    })
});

export type GatewayEnv = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): GatewayEnv {
  return envSchema.parse(input);
}

function isValidMasterKey(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value) || Buffer.byteLength(value, "utf8") === 32;
}
