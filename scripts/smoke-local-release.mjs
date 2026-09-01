#!/usr/bin/env node
import path from "node:path";
import { tmpdir } from "node:os";

const secretKeys = new Set([
  "FORGEBADGER_MASTER_KEY",
  "FORGEBADGER_JWT_SECRET",
  "OPENFORGE_MASTER_KEY",
  "OPENFORGE_JWT_SECRET",
  "OPENFORGE_ATTACH_TOKEN"
]);

export function buildSmokeEnvironment(options = {}) {
  const root = options.root ?? path.join(tmpdir(), "forgebadger-smoke");
  const gatewayPort = String(options.gatewayPort ?? 48731);
  const webPort = String(options.webPort ?? 48732);
  const masterKey = options.masterKey ?? "0".repeat(64);
  const jwtSecret = options.jwtSecret ?? "forgebadger-smoke-jwt-secret-32-chars";

  return {
    FORGEBADGER_HOST: "127.0.0.1",
    FORGEBADGER_PORT: gatewayPort,
    FORGEBADGER_WEB_HOST: "127.0.0.1",
    FORGEBADGER_WEB_PORT: webPort,
    FORGEBADGER_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
    NEXT_PUBLIC_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
    FORGEBADGER_DB_PATH: path.join(root, "forgebadger-smoke.db"),
    FORGEBADGER_MASTER_KEY: masterKey,
    FORGEBADGER_JWT_SECRET: jwtSecret,
    FORGEBADGER_TMUX_PREFIX: "fb-smoke-"
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
    web: "pnpm --dir packages/web dev",
    cleanup: [
      "Stop Gateway and Web processes",
      "Remove the disposable FORGEBADGER_DB_PATH",
      "Confirm no tmux sessions remain with the FORGEBADGER_TMUX_PREFIX"
    ],
    manualEvidence: requiredManualSmokeEvidence()
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(buildSmokeCommandPlan(), null, 2)}\n`);
}
