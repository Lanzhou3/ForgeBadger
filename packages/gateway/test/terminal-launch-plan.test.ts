import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createTerminalLaunchPlan,
  defaultTerminalShell,
  resolveAvailableTerminalShell,
  normalizeSessionKind,
  type TerminalShell
} from "../src/services/session-launch-plan.js";

describe("terminal session kind", () => {
  it("normalizeSessionKind returns 'terminal' for the terminal kind", () => {
    assert.equal(normalizeSessionKind("terminal"), "terminal");
  });

  it("normalizeSessionKind returns the adapter id for canonical adapters", () => {
    assert.equal(normalizeSessionKind("claude"), "claude");
    assert.equal(normalizeSessionKind("codex"), "codex");
  });

  it("normalizeSessionKind returns undefined for unknown values", () => {
    assert.equal(normalizeSessionKind("unknown"), undefined);
    assert.equal(normalizeSessionKind(""), undefined);
  });
});

describe("defaultTerminalShell", () => {
  it("prefers pwsh on win32", () => {
    assert.equal(defaultTerminalShell("win32", { ComSpec: "cmd.exe" }), "pwsh");
  });

  it("uses zsh when SHELL ends with /zsh on POSIX", () => {
    assert.equal(defaultTerminalShell("linux", { SHELL: "/bin/zsh" }), "zsh");
  });

  it("uses bash when SHELL ends with /bash on POSIX", () => {
    assert.equal(defaultTerminalShell("darwin", { SHELL: "/bin/bash" }), "bash");
  });

  it("falls back to sh when SHELL is unset on POSIX", () => {
    assert.equal(defaultTerminalShell("linux", {}), "sh");
  });
});

describe("createTerminalLaunchPlan", () => {
  it("builds a pwsh launch plan on win32 with session env", () => {
    const plan = createTerminalLaunchPlan({
      projectRoot: "C:\\repo",
      sessionId: "s-term-1",
      shell: "pwsh",
      platform: "win32",
      env: { ComSpec: "cmd.exe" }
    });
    assert.equal(plan.command, "pwsh");
    assert.deepEqual(plan.args, []);
    assert.equal(plan.cwd, "C:\\repo");
    assert.equal(plan.env.FORGEBADGER_SESSION_ID, "s-term-1");
    assert.equal(plan.credentialMode, "host_environment");
    assert.deepEqual(plan.secretEnvNames, []);
  });

  it("builds a cmd launch plan using ComSpec", () => {
    const plan = createTerminalLaunchPlan({
      projectRoot: "C:\\repo",
      sessionId: "s-2",
      shell: "cmd",
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" }
    });
    assert.equal(plan.command, "C:\\Windows\\System32\\cmd.exe");
  });

  it("builds a Windows PowerShell 5.1 launch plan", () => {
    const plan = createTerminalLaunchPlan({
      projectRoot: "C:\\repo",
      sessionId: "s-ps5",
      shell: "powershell",
      platform: "win32",
      env: { ComSpec: "cmd.exe" }
    });
    assert.equal(plan.command, "powershell.exe");
    assert.deepEqual(plan.args, []);
  });

  it("builds a bash launch plan with login flag on POSIX", () => {
    const plan = createTerminalLaunchPlan({
      projectRoot: "/repo",
      sessionId: "s-3",
      shell: "bash",
      platform: "linux",
      env: {}
    });
    assert.equal(plan.command, "bash");
    assert.deepEqual(plan.args, ["-l"]);
  });

  it("uses the platform default shell when none is specified", () => {
    const plan = createTerminalLaunchPlan({
      projectRoot: "/repo",
      sessionId: "s-4",
      platform: "linux",
      env: { SHELL: "/bin/zsh" }
    });
    assert.equal(plan.command, "zsh");
  });

  it("injects FORGEBADGER_GATEWAY_URL from env", () => {
    const plan = createTerminalLaunchPlan({
      projectRoot: "/repo",
      sessionId: "s-5",
      shell: "sh",
      platform: "linux",
      env: { FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:48731" }
    });
    assert.equal(plan.env.FORGEBADGER_GATEWAY_URL, "http://127.0.0.1:48731");
  });
});

// Availability is an external dependency; exercise preference and real fallback decisions.
it("falls back to Windows PowerShell when PowerShell 7 is absent", async () => {
  const seen: string[] = [];
  const shell = await resolveAvailableTerminalShell("win32", {}, async command => {
    seen.push(command);
    return { exitCode: command === "powershell.exe" ? 0 : 1, stdout: "", stderr: "missing" };
  });
  assert.equal(shell, "powershell");
  assert.deepEqual(seen, ["pwsh", "powershell.exe"]);
});
it("falls back to cmd when both PowerShell versions are absent", async () => {
  assert.equal(await resolveAvailableTerminalShell("win32", {}, async command => ({
    exitCode: command === "cmd.exe" ? 0 : 1, stdout: "", stderr: "missing"
  })), "cmd");
});
it("rejects launching when no supported shell is installed", async () => {
  await assert.rejects(resolveAvailableTerminalShell("win32", {}, async () => ({
    exitCode: 1, stdout: "", stderr: "missing"
  })), /TERMINAL_SHELL_UNAVAILABLE/);
});
