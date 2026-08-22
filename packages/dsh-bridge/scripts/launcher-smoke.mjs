/**
 * Launcher smoke: boot the packaged composition and answer one JSON-RPC
 * `initialize` frame, then shut down cleanly. No model request is made, so a
 * dummy MINIMAX_API_KEY suffices.
 */
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  OPENFORGE_GATEWAY_URL: "http://127.0.0.1:9", // unreachable on purpose: no call is made
  OPENFORGE_COPILOT_BRIDGE_TOKEN: "smoke-token",
  OPENFORGE_USER_ID: "smoke-user",
  MINIMAX_API_KEY: "smoke-dummy-key",
  DSH_SESSION_ROOT: "/tmp/openforge-dsh-bridge-smoke/.sessions",
  DSH_CWD: "/tmp/openforge-dsh-bridge-smoke",
};

const child = spawn(process.execPath, ["dist/launcher.js"], {
  cwd: new URL("..", import.meta.url).pathname,
  env,
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    const frame = JSON.parse(line);
    console.log("RX:", JSON.stringify(frame).slice(0, 200));
    if (frame.id === 1) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "shutdown" }) + "\n");
    }
    if (frame.id === 2) {
      console.log("SMOKE OK");
      child.stdin.end();
    }
  }
});

child.on("exit", (code) => {
  console.log("exit code:", code);
  process.exit(code === 0 ? 0 : 1);
});

child.stdin.write(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { cwd: "/tmp/openforge-dsh-bridge-smoke", provider: "minimax", model: "MiniMax-M3" },
}) + "\n");

setTimeout(() => {
  console.error("SMOKE TIMEOUT");
  child.kill("SIGKILL");
  process.exit(1);
}, 60_000);
