import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveWindowsShimCommand } from "../src/services/session-server/platform-adapter.js";

test("keeps official npm.cmd prefix and Node selection inside its own shim", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-npm-shim-"));
  try {
    const npmBin = join(directory, "node_modules", "npm", "bin");
    mkdirSync(npmBin, { recursive: true });
    writeFileSync(join(npmBin, "npm-cli.js"), "");
    writeFileSync(join(directory, "npm.cmd"), [
      "@ECHO OFF",
      "SET \"NODE_EXE=%~dp0\\node.exe\"",
      "SET \"NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js\"",
      "SET \"NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js\"",
      "IF EXIST \"%NPM_PREFIX_NPM_CLI_JS%\" SET \"NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%\"",
      "\"%NODE_EXE%\" \"%NPM_CLI_JS%\" %*"
    ].join("\r\n"));

    assert.equal(resolveWindowsShimCommand("npm", { PATH: directory, PATHEXT: ".CMD" }, "win32"), undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
