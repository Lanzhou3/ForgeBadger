import assert from "node:assert/strict";
import { test } from "node:test";

import { instrumentPowerShell, runDiagnosticCommand } from "./diagnose-windows-directory-picker.mjs";

test("keeps the last PowerShell stage and stderr when the process times out", async () => {
  const result = await runDiagnosticCommand(process.execPath, ["-e", `
    process.stderr.write("[picker-stage] opening-dialog\\n");
    process.stderr.write("diagnostic detail\\n");
    setInterval(() => {}, 1000);
  `], { timeoutMs: 300 });

  assert.equal(result.timedOut, true);
  assert.equal(result.lastStage, "opening-dialog");
  assert.match(result.stderr, /diagnostic detail/u);
});

test("records a failed child process without treating it as cancellation", async () => {
  const result = await runDiagnosticCommand(process.execPath, ["-e", `
    process.stderr.write("[picker-stage] loading-winforms\\n");
    process.stderr.write("assembly load failed\\n");
    process.exit(1);
  `]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.timedOut, false);
  assert.equal(result.lastStage, "loading-winforms");
  assert.match(result.stderr, /assembly load failed/u);
});

test("does not print a selected directory in diagnostic output", async () => {
  const output = [];
  const result = await runDiagnosticCommand(process.execPath, ["-e", `
    process.stdout.write("C:\\private-project\\n");
  `], { write: (message) => output.push(message) });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutNonEmpty, true);
  assert.doesNotMatch(JSON.stringify({ result, output }), /private-project/u);
});

test("reports an executable that cannot be started", async () => {
  const result = await runDiagnosticCommand("forgebadger-picker-missing-executable", []);
  assert.equal(result.exitCode, 127);
  assert.equal(result.timedOut, false);
  assert.equal(result.lastStage, null);
  assert.match(result.stderr, /ENOENT/u);
});

test("refuses an unknown installed script instead of running a guessed replacement", () => {
  assert.throws(() => instrumentPowerShell("Write-Output 'unknown'"), /Unsupported installed picker script/u);
});
