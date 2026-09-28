import type { AdapterId } from "./adapter-discovery.js";

/**
 * Operator opt-in for programmatic CLI control. Defaults to empty: every
 * adapter stays manual_only until the operator enables it via
 * FORGEBADGER_CLI_AUTONOMY_ADAPTERS (wired once at gateway startup).
 */
let enabledAdapters: ReadonlySet<string> = new Set();

/** @internal Test/startup wiring hook; not a per-request knob. */
export function configureCliAutonomyAdapters(adapters: Iterable<string>): void {
  enabledAdapters = new Set(adapters);
}

export function cliAutonomyAdapters(): readonly string[] {
  return [...enabledAdapters];
}

export function getAdapterAutonomy(adapter: AdapterId): {
  adapter: AdapterId; mode: "manual_only" | "supervised"; reason: string;
} {
  if (enabledAdapters.has(adapter)) {
    return { adapter, mode: "supervised", reason: "Operator enabled programmatic CLI control for this adapter" };
  }
  return { adapter, mode: "manual_only", reason: "CLI permission scope has not been verified for autonomous execution" };
}

export function assertAdapterAutonomy(adapter: AdapterId): void {
  if (!enabledAdapters.has(adapter)) {
    throw new Error(`ADAPTER_AUTONOMY_UNVERIFIED: ${adapter}`);
  }
}
