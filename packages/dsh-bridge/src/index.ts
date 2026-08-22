/**
 * @openforge/dsh-bridge package root: consumer interface re-exports.
 *
 * - `./plugin` — the openforge-bridge Cordis plugin (platform tools)
 * - `./server` — the resume-aware SDK JSON-RPC server plugin
 * - launcher — bin only (`openforge-dsh-bridge`), not a library import
 *
 * @module
 */

export { loadBridgeConfig, type BridgeConfig } from "./bridge-config.js";
export { BridgeClient, BridgeApiError, type BridgeFetch } from "./bridge-client.js";
export { createBridgeTools } from "./plugin.js";
export { ResumeAwareSdkServer } from "./server.js";
