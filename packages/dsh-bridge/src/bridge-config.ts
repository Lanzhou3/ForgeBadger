/**
 * Environment-backed configuration for the OpenForge bridge plugin.
 *
 * The dsh runtime runs as a per-user child process of the Gateway; the Gateway
 * injects these variables at spawn time (never write them to files or logs):
 *
 * - `OPENFORGE_GATEWAY_URL` — Gateway base URL (default `http://127.0.0.1:48731`)
 * - `OPENFORGE_COPILOT_BRIDGE_TOKEN` — internal API bearer token (required)
 * - `OPENFORGE_USER_ID` — tenant id forwarded as `X-OpenForge-User-Id` (required)
 * - `OPENFORGE_BRIDGE_TIMEOUT_MS` — per-request timeout (default 15000)
 * - `OPENFORGE_BRIDGE_ENABLE_OPERATE` — "1"/"true" registers the operate tools
 *   (advance_work_item, dispatch_task_to_session); anything else (default)
 *   registers only the read-only tools. The M3 Gateway spawns with "1"; every
 *   operate call is then gated behind the approval bridge (see approval-bridge.ts).
 *
 * @module
 */

/** Resolved bridge configuration. */
export interface BridgeConfig {
  /** Gateway base URL without a trailing slash. */
  readonly gatewayUrl: string
  /** Internal API bearer token. */
  readonly token: string
  /** Tenant id for the internal API. */
  readonly userId: string
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number
  /** Whether the operate tools (advance/dispatch) are registered. */
  readonly enableOperate: boolean
}

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:48731";
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Load and validate the bridge configuration from an environment map.
 * @param env - environment source (usually `process.env`).
 * @returns the resolved configuration.
 * @throws an error naming every missing/invalid variable.
 */
export function loadBridgeConfig(env: NodeJS.ProcessEnv): BridgeConfig {
  const problems: string[] = [];

  const gatewayUrl = (env.OPENFORGE_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
  try {
    new URL(gatewayUrl);
  } catch {
    problems.push(`OPENFORGE_GATEWAY_URL is not a valid URL: ${gatewayUrl}`);
  }

  const token = env.OPENFORGE_COPILOT_BRIDGE_TOKEN ?? "";
  if (token.length === 0) {
    problems.push("OPENFORGE_COPILOT_BRIDGE_TOKEN is required (internal API bearer token)");
  }

  const userId = env.OPENFORGE_USER_ID ?? "";
  if (userId.length === 0) {
    problems.push("OPENFORGE_USER_ID is required (tenant id for the internal API)");
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const rawTimeout = env.OPENFORGE_BRIDGE_TIMEOUT_MS;
  if (rawTimeout !== undefined && rawTimeout !== "") {
    const parsed = Number(rawTimeout);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      problems.push(`OPENFORGE_BRIDGE_TIMEOUT_MS must be a positive number, got: ${rawTimeout}`);
    } else {
      timeoutMs = parsed;
    }
  }

  if (problems.length > 0) {
    throw new Error(`openforge-bridge configuration invalid:\n  - ${problems.join("\n  - ")}`);
  }
  const rawOperate = env.OPENFORGE_BRIDGE_ENABLE_OPERATE ?? "";
  const enableOperate = rawOperate === "1" || rawOperate === "true";
  return { gatewayUrl, token, userId, timeoutMs, enableOperate };
}
