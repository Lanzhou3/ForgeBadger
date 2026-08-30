#!/usr/bin/env node
/**
 * ForgeBadger dsh runtime launcher: boots one DeepSeek Harness runtime process
 * composed from the packaged cordis.yml template (or `DSH_BRIDGE_CONFIG`),
 * carrying the ForgeBadger bridge plugin and the resume-aware JSON-RPC server.
 *
 * Process contract (for the M2 Gateway process manager):
 * - stdio speaks the dsh SDK JSON-RPC protocol (stdout is reserved for frames);
 * - configuration arrives via environment variables (see bridge-config.ts for
 *   the bridge set, plus `MINIMAX_API_KEY` for the LLM route);
 * - EOF on stdin, SIGTERM, or SIGINT disposes the runtime and exits.
 *
 * @module
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { boot, installFailLoud, resolveConfigPath } from "@deepseek-ai/dsh-app-boot";

import { loadBridgeConfig } from "./bridge-config.js";

const NAME = "forgebadger-dsh-bridge";

/** Default composition template shipped in this package. */
function defaultConfigPath(): string {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  return join(packageRoot, "templates", "cordis.yml");
}

async function main(): Promise<void> {
  installFailLoud(NAME);

  // Validate the bridge environment before booting: misconfiguration fails
  // loud here with every missing variable named, not at the first tool call.
  const bridgeConfig = loadBridgeConfig(process.env);
  // Default persona follows the operate gate: a read-only deployment must not
  // promise write/dispatch capabilities to the model. (Selected here, not in
  // cordis.yml — a ternary in a YAML plain scalar breaks the config parse.)
  if ((process.env.DSH_SYSTEM_PROMPT ?? "") === "") {
    process.env.DSH_SYSTEM_PROMPT = bridgeConfig.enableOperate
      ? "You are the ForgeBadger copilot. Use the ForgeBadger platform tools (list_work_items, advance_work_item, list_sessions, dispatch_task_to_session) to answer project and session questions."
      : "You are the ForgeBadger copilot. Use the ForgeBadger platform tools (list_work_items, list_sessions) to answer project and session questions. You cannot modify platform state in this deployment: if the user asks you to change or dispatch something, explain that this action is not available here and answer with the information you can read.";
  }
  // LLM credential: the Gateway injects DSH_LLM_API_KEY (decrypted in memory,
  // never persisted). MINIMAX_API_KEY is accepted as a legacy fallback so the
  // M1 spike composition keeps working unchanged.
  if ((process.env.DSH_LLM_API_KEY ?? "") === "") {
    const legacy = process.env.MINIMAX_API_KEY ?? "";
    if (legacy === "") {
      throw new Error("DSH_LLM_API_KEY is required (LLM provider credential for the copilot route)");
    }
    process.env.DSH_LLM_API_KEY = legacy;
  }

  const requested = process.env.DSH_BRIDGE_CONFIG;
  const configPath = resolveConfigPath(
    requested !== undefined && requested !== "" ? requested : defaultConfigPath(),
    undefined,
  );

  // Bare plugin names in the template resolve from this package's own
  // dependency set (the host owns the complete plugin set, not the config).
  const ctx = await boot(NAME, configPath, undefined, undefined, import.meta.url);
  let exiting = false;

  async function disposeAndExit(code: number): Promise<void> {
    if (exiting) return;
    exiting = true;
    try {
      await ctx.fiber.dispose();
    } finally {
      process.exit(code);
    }
  }

  process.stdin.on("end", () => { void disposeAndExit(0); });
  process.on("SIGTERM", () => { void disposeAndExit(0); });
  process.on("SIGINT", () => { void disposeAndExit(130); });
}

main().catch((error: unknown) => {
  process.stderr.write(`${NAME}: startup failed: ${String(error)}\n`);
  process.exit(1);
});
