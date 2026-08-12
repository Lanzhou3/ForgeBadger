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
