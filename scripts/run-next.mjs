#!/usr/bin/env node
import { spawn } from "node:child_process";

import { buildRootEnv } from "./run-with-root-env.mjs";

const mode = process.argv[2];

if (mode !== "dev" && mode !== "start") {
  process.stderr.write("Usage: run-next <dev|start>\n");
  process.exitCode = 127;
} else {
  const env = await buildRootEnv();
  const host = env.FORGEBADGER_WEB_HOST || "127.0.0.1";
  const port = env.FORGEBADGER_WEB_PORT || "48732";
  const child = spawn("next", [mode, "-H", host, "-p", port], {
    env,
    stdio: "inherit",
    ...(process.platform === "win32" ? { shell: true } : {})
  });

  child.on("error", (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 127;
  });

  child.on("close", (code, signal) => {
    if (signal) {
      process.stderr.write(`Command terminated by ${signal}\n`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}
