import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const identity = z.string().regex(/^[a-f0-9]{32}$/);
const resultSchema = z.object({ exitCode: z.number().int().nullable(), status: z.enum(["passed", "failed", "unknown"]), summary: z.string().max(20000) });
const stateSchema = z.object({
  version: z.literal(1), id: identity, cwd: z.string(), token: z.string().regex(/^[a-f0-9]{64}$/), endpoint: z.string(),
  phase: z.enum(["starting", "running", "finished", "uncertain"]), stopped: z.boolean(), runnerPid: z.number().int().positive().optional(), result: resultSchema.optional()
}).strict();
export type VerificationRunnerState = z.infer<typeof stateSchema>;
export interface RunnerContext { directory: string; stateFile: string; state: VerificationRunnerState }

export function runnerDirectory(cwd: string): string {
  const parent = path.dirname(cwd);
  if (!path.isAbsolute(cwd) || realpathSync(parent) !== parent) throw new Error("Verification state requires a canonical workspace parent");
  const root = path.join(parent, ".verification-state");
  const dir = path.join(root, createHash("sha256").update(cwd).digest("hex").slice(0, 32));
  for (const item of [root, dir]) {
    if (existsSync(item)) {
      const info = lstatSync(item);
      if (!info.isDirectory() || realpathSync(item) !== item) throw new Error("Verification state directory must not be a symlink");
      if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())) throw new Error("Verification state directory permissions are unsafe");
    }
  }
  return dir;
}

export function readPrivateJson(file: string): unknown {
  const info = lstatSync(file);
  if (!info.isFile() || info.size > 65536 || realpathSync(file) !== file || (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))) throw new Error("Invalid verification runtime state");
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

export function readRunnerStateFile(file: string): VerificationRunnerState {
  return stateSchema.parse(readPrivateJson(file));
}

export function readRunner(cwd: string): RunnerContext | undefined {
  const directory = runnerDirectory(cwd);
  const pointer = path.join(directory, "current.json");
  if (!existsSync(pointer)) {
    if (existsSync(path.join(directory, "lease"))) throw new Error("Verification runner lease has no verified identity");
    return undefined;
  }
  const { id } = z.object({ id: identity }).strict().parse(readPrivateJson(pointer));
  const stateFile = path.join(directory, `state-${id}.json`);
  const state = readRunnerStateFile(stateFile);
  if (state.id !== id || state.cwd !== cwd) throw new Error("Verification runner identity does not match workspace");
  return { directory, stateFile, state };
}

export function runnerMac(token: string, value: string): string { return createHmac("sha256", token).update(value).digest("hex"); }
export function authenticMac(expected: string, actual: unknown): boolean {
  return typeof actual === "string" && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}
