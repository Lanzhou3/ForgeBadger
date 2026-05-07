#!/usr/bin/env node
import path from "node:path";
import { tmpdir } from "node:os";

const secretKeys = new Set([
  "OPENFORGE_MASTER_KEY",
  "OPENFORGE_JWT_SECRET"
]);

export function buildSmokeEnvironment(options = {}) {
  const root = options.root ?? path.join(tmpdir(), "openforge-smoke");
  const gatewayPort = String(options.gatewayPort ?? 48731);
  const webPort = String(options.webPort ?? 48732);
  const masterKey = options.masterKey ?? "0".repeat(64);
  const jwtSecret = options.jwtSecret ?? "openforge-smoke-jwt-secret-32-chars";

  return {
    OPENFORGE_HOST: "127.0.0.1",
    OPENFORGE_PORT: gatewayPort,
    OPENFORGE_WEB_HOST: "127.0.0.1",
    OPENFORGE_WEB_PORT: webPort,
    OPENFORGE_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
    NEXT_PUBLIC_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
    OPENFORGE_DB_PATH: path.join(root, "openforge-smoke.db"),
    OPENFORGE_MASTER_KEY: masterKey,
    OPENFORGE_JWT_SECRET: jwtSecret,
    OPENFORGE_TMUX_PREFIX: "of-smoke-"
  };
}

export function redactSmokeEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      secretKeys.has(key) ? "[redacted]" : value
    ])
  );
}

export function requiredManualSmokeEvidence() {
  return [
    "browser-terminal-attach",
    "browser-terminal-input-output",
    "browser-terminal-resize",
    "browser-terminal-refresh-reconnect",
    "session-stop",
    "gateway-web-restart-recovery",
    "real-claude-permission-prompt"
  ];
}

export function buildSmokeCommandPlan(env = buildSmokeEnvironment()) {
  return {
    environment: redactSmokeEnvironment(env),
    gateway: "pnpm --dir packages/gateway dev",
    web: "pnpm --dir packages/web exec next dev --hostname 127.0.0.1 --port 48732",
    cleanup: [
      "Stop Gateway and Web processes",
      "Remove the disposable OPENFORGE_DB_PATH",
      "Confirm no tmux sessions remain with the OPENFORGE_TMUX_PREFIX"
    ],
    manualEvidence: requiredManualSmokeEvidence()
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(buildSmokeCommandPlan(), null, 2)}\n`);
}
