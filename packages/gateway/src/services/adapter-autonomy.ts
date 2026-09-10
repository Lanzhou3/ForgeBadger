import type { AdapterId } from "./adapter-discovery.js";

export function getAdapterAutonomy(adapter: AdapterId): {
  adapter: AdapterId; mode: "manual_only"; reason: string;
} {
  return { adapter, mode: "manual_only", reason: "CLI permission scope has not been verified for autonomous execution" };
}

export function assertAdapterAutonomy(adapter: AdapterId): never {
  throw new Error(`ADAPTER_AUTONOMY_UNVERIFIED: ${getAdapterAutonomy(adapter).adapter}`);
}
