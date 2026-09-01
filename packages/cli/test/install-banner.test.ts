import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runInit } from "../src/commands/init.js";
import { runStart } from "../src/commands/start.js";
import {
  FORGEBADGER_TEXT_LOGO,
  renderForgeBadgerInstallBanner
} from "../src/ui/install-banner.js";

describe("ForgeBadger install banner", () => {
  it("renders a portable plain-text logo without ANSI escapes", () => {
    const output = renderForgeBadgerInstallBanner({ isTTY: false, env: {} });

    assert.match(output, /ForgeBadger/);
    assert.match(output, /Local-first control plane for AI coding CLIs/);
    assert.equal(output.includes(FORGEBADGER_TEXT_LOGO), true);
    assert.doesNotMatch(output, /\u001b\[/);
  });

  it("uses the ForgeBadger cyan accent only on a color-capable TTY", () => {
    const colorOutput = renderForgeBadgerInstallBanner({
      isTTY: true,
      env: { TERM: "xterm-256color" }
    });
    const noColorOutput = renderForgeBadgerInstallBanner({
      isTTY: true,
      env: { TERM: "xterm-256color", NO_COLOR: "1" }
    });

    assert.match(colorOutput, /\u001b\[38;2;34;211;238m/);
    assert.doesNotMatch(noColorOutput, /\u001b\[/);
  });

  it("prints the logo before start checks the terminal runtime", async () => {
    const stdout = createMemoryWriter();
    let outputSeenByRuntimeCheck = "";

    const code = await runStart({
      isTTY: false,
      env: {},
      stdout,
      stderr: createMemoryWriter(),
      ensureTerminalRuntime: async () => {
        outputSeenByRuntimeCheck = stdout.text;
        return missingPsmuxResult();
      }
    });

    assert.equal(code, 1);
    assert.equal(outputSeenByRuntimeCheck.includes(FORGEBADGER_TEXT_LOGO), true);
    assert.match(outputSeenByRuntimeCheck, /Checking operating system and terminal runtime/);
  });

  it("prints the logo before init checks the terminal runtime", async () => {
    const stdout = createMemoryWriter();
    let outputSeenByRuntimeCheck = "";

    const code = await runInit(["init"], {
      isTTY: false,
      env: {},
      stdout,
      stderr: createMemoryWriter(),
      ensureTerminalRuntime: async () => {
        outputSeenByRuntimeCheck = stdout.text;
        return missingPsmuxResult();
      }
    });

    assert.equal(code, 1);
    assert.equal(outputSeenByRuntimeCheck.includes(FORGEBADGER_TEXT_LOGO), true);
    assert.match(outputSeenByRuntimeCheck, /Checking operating system and terminal runtime/);
  });
});

function missingPsmuxResult() {
  return {
    status: "non_tty" as const,
    runtime: {
      persistence: "psmux" as const,
      mode: "psmux_missing" as const,
      supported: false,
      message: "Install psmux to enable persistent browser terminals."
    },
    installCommand: "winget install --id marlocarlo.psmux --exact --source winget"
  };
}

function createMemoryWriter() {
  return {
    text: "",
    write(chunk: string) {
      this.text += chunk;
    }
  };
}
