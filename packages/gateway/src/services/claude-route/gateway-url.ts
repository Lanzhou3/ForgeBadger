/**
 * Loopback URL of the running Gateway itself (host/port from the process
 * environment). Written into Claude Code config as ANTHROPIC_BASE_URL when a
 * provider is applied through the Claude route, and shown in the web UI.
 */
export function gatewayLoopbackUrl(env: NodeJS.ProcessEnv = process.env): string {
  const host = (env.FORGEBADGER_HOST ?? "").trim() || "127.0.0.1";
  const rawPort = Number(env.FORGEBADGER_PORT);
  const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : 3000;
  return `http://${host}:${port}`;
}
