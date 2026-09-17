import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";

import {
  installNodePtyCrashGuard,
  isBenignNodePtyResizeError
} from "../src/lib/node-pty-guard.js";

function ptyResizeError(stack: string): Error {
  const error = new Error("Cannot resize a pty that has already exited");
  error.stack = stack;
  return error;
}

async function runGuardProbe(body: string): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--import", "tsx", "-e", body],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => resolve({ status: null, stderr: String(error) }));
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

describe("node-pty crash guard", () => {
  it("recognizes only the deferred resize error thrown from windowsPtyAgent", () => {
    assert.equal(
      isBenignNodePtyResizeError(
        ptyResizeError(
          "Error: Cannot resize a pty that has already exited\n"
            + "    at WindowsPtyAgent.resize (node_modules/node-pty/lib/windowsPtyAgent.js:121:15)\n"
            + "    at fn.run (node_modules/node-pty/lib/windowsTerminal.js:73:28)"
        )
      ),
      true
    );
    // Same message from our own code is not a node-pty agent failure.
    assert.equal(
      isBenignNodePtyResizeError(
        ptyResizeError(
          "Error: Cannot resize a pty that has already exited\n"
            + "    at TerminalBridge.resize (src/terminals/bridge.ts:42:9)"
        )
      ),
      false
    );
    assert.equal(isBenignNodePtyResizeError(new Error("boom")), false);
    assert.equal(isBenignNodePtyResizeError("boom"), false);
    assert.equal(isBenignNodePtyResizeError(undefined), false);
  });

  it("survives the benign node-pty resize error in a real process", async () => {
    const { status, stderr } = await runGuardProbe(
      `import { installNodePtyCrashGuard } from "./src/lib/node-pty-guard.js";\n`
        + `installNodePtyCrashGuard();\n`
        + `const error = new Error("Cannot resize a pty that has already exited");\n`
        + `error.stack = "Error: Cannot resize a pty that has already exited\\n    at WindowsPtyAgent.resize (node_modules/node-pty/lib/windowsPtyAgent.js:121:15)";\n`
        + `setTimeout(() => { throw error; }, 20);\n`
        + `setTimeout(() => { console.log("SURVIVED"); process.exit(0); }, 400);\n`
    );
    assert.equal(status, 0, `process must survive the benign error (stderr: ${stderr})`);
    assert.match(stderr, /ignoring benign node-pty deferred resize/);
  }, 30_000);

  it("keeps fatal behavior for any other uncaught exception", async () => {
    const { status, stderr } = await runGuardProbe(
      `import { installNodePtyCrashGuard } from "./src/lib/node-pty-guard.js";\n`
        + `installNodePtyCrashGuard();\n`
        + `setTimeout(() => { throw new Error("real failure"); }, 20);\n`
        + `setTimeout(() => process.exit(0), 400);\n`
    );
    assert.equal(status, 1, `process must exit 1 on a real failure (stderr: ${stderr})`);
    assert.match(stderr, /fatal uncaught exception/);
  }, 30_000);
});
