import { runWithRootEnv } from "../../../scripts/run-with-root-env.mjs";

// Keep .env handling while avoiding an intermediate pnpm native process in teardown.
process.exitCode = await runWithRootEnv([
  process.execPath,
  "node_modules/next/dist/bin/next",
  "dev",
  "--hostname", process.env.FORGEBADGER_WEB_HOST ?? "127.0.0.1",
  "--port", process.env.FORGEBADGER_WEB_PORT ?? "18333",
]);
