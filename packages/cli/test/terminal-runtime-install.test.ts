import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ensureCliTerminalRuntime,
  resolveCliTerminalRuntimeInstallPlan
} from "../src/runtime/terminal-runtime-install.js";

describe("resolveCliTerminalRuntimeInstallPlan", () => {
  it("returns the fixed allowlisted WinGet command for psmux", () => {
    const plan = resolveCliTerminalRuntimeInstallPlan("win32");

    assert.deepEqual(plan, {
      runtime: "psmux",
      command: "winget",
      args: ["install", "--id", "marlocarlo.psmux", "--exact", "--source", "winget"],
      displayCommand: "winget install --id marlocarlo.psmux --exact --source winget"
    });
  });

  it("builds Linux commands only from the detected package-manager allowlist", () => {
    assert.deepEqual(resolveCliTerminalRuntimeInstallPlan("linux", "dnf"), {
      runtime: "tmux",
      command: "sudo",
      args: ["dnf", "install", "-y", "tmux"],
      displayCommand: "sudo dnf install -y tmux"
    });
    assert.equal(resolveCliTerminalRuntimeInstallPlan("linux"), undefined);
  });
});

describe("ensureCliTerminalRuntime", () => {
  it("returns ready without prompting or installing when the platform runtime is available", async () => {
    let prompted = false;
    let installed = false;

    const result = await ensureCliTerminalRuntime({
      platform: "win32",
      isTTY: true,
      env: {},
      dependencyRunner: async (command, args) => {
        assert.equal(command, "psmux");
        assert.deepEqual(args, ["-V"]);
        return { exitCode: 0, stdout: "psmux 3.3.8\n", stderr: "" };
      },
      confirmInstall: async () => {
        prompted = true;
        return true;
      },
      installRunner: async () => {
        installed = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });

    assert.equal(result.status, "ready");
    assert.equal(result.runtime.mode, "native_psmux");
    assert.equal(prompted, false);
    assert.equal(installed, false);
  });

  it("does not prompt or install in a non-interactive terminal", async () => {
    let prompted = false;
    let installed = false;

    const result = await ensureCliTerminalRuntime({
      platform: "win32",
      isTTY: false,
      env: {},
      dependencyRunner: missingCommand,
      confirmInstall: async () => {
        prompted = true;
        return true;
      },
      installRunner: async () => {
        installed = true;
        return successfulCommand();
      }
    });

    assert.equal(result.status, "non_tty");
    assert.equal(result.installCommand, "winget install --id marlocarlo.psmux --exact --source winget");
    assert.equal(prompted, false);
    assert.equal(installed, false);
  });

  it("does not prompt or install in CI even when stdin is a TTY", async () => {
    let prompted = false;
    let installed = false;

    const result = await ensureCliTerminalRuntime({
      platform: "win32",
      isTTY: true,
      env: { CI: "true" },
      dependencyRunner: missingCommand,
      confirmInstall: async () => {
        prompted = true;
        return true;
      },
      installRunner: async () => {
        installed = true;
        return successfulCommand();
      }
    });

    assert.equal(result.status, "non_tty");
    assert.equal(prompted, false);
    assert.equal(installed, false);
  });

  it("uses No as the interactive default and does not install after refusal", async () => {
    let installed = false;

    const result = await ensureCliTerminalRuntime({
      platform: "win32",
      isTTY: true,
      env: {},
      dependencyRunner: missingCommand,
      confirmInstall: async (request) => {
        assert.equal(request.defaultValue, false);
        assert.equal(request.command, "winget install --id marlocarlo.psmux --exact --source winget");
        return false;
      },
      installRunner: async () => {
        installed = true;
        return successfulCommand();
      }
    });

    assert.equal(result.status, "declined");
    assert.equal(installed, false);
  });

  it("runs only the allowlisted installer without a shell and rechecks before returning ready", async () => {
    let dependencyChecks = 0;
    const installCalls: Array<{
      command: string;
      args: string[];
      options: { shell: false };
    }> = [];

    const result = await ensureCliTerminalRuntime({
      platform: "win32",
      isTTY: true,
      env: {},
      dependencyRunner: async (command) => {
        dependencyChecks += 1;
        return dependencyChecks === 1
          ? { exitCode: 127, stdout: "", stderr: `${command} not found` }
          : { exitCode: 0, stdout: "psmux 3.3.8\n", stderr: "" };
      },
      confirmInstall: async () => true,
      installRunner: async (command, args, options) => {
        installCalls.push({ command, args, options });
        return successfulCommand();
      }
    });

    assert.equal(result.status, "ready");
    assert.equal(dependencyChecks, 2);
    assert.deepEqual(installCalls, [{
      command: "winget",
      args: ["install", "--id", "marlocarlo.psmux", "--exact", "--source", "winget"],
      options: { shell: false }
    }]);
  });

  it("returns install_failed without claiming readiness when WinGet fails", async () => {
    let dependencyChecks = 0;

    const result = await ensureCliTerminalRuntime({
      platform: "win32",
      isTTY: true,
      env: {},
      dependencyRunner: async () => {
        dependencyChecks += 1;
        return missingCommand();
      },
      confirmInstall: async () => true,
      installRunner: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "installer failed"
      })
    });

    assert.equal(result.status, "install_failed");
    assert.match(result.message, /installer failed/);
    assert.equal(dependencyChecks, 1);
  });

  it("returns restart_required when install succeeds but the new binary is not yet discoverable", async () => {
    let dependencyChecks = 0;

    const result = await ensureCliTerminalRuntime({
      platform: "win32",
      isTTY: true,
      env: {},
      dependencyRunner: async () => {
        dependencyChecks += 1;
        return missingCommand();
      },
      confirmInstall: async () => true,
      installRunner: async () => successfulCommand()
    });

    assert.equal(result.status, "restart_required");
    assert.equal(dependencyChecks, 2);
    assert.match(result.message, /restart|terminal|PATH/i);
  });

  it("offers the fixed WinGet upgrade after detecting vulnerable psmux 3.3.7 and respects refusal", async () => {
    let installed = false;
    const result = await ensureCliTerminalRuntime({
      platform: "win32",
      isTTY: true,
      env: {},
      dependencyRunner: async () => ({ exitCode: 0, stdout: "tmux 3.3.7\n", stderr: "" }),
      confirmInstall: async (request) => {
        assert.equal(request.defaultValue, false);
        assert.equal(request.command, "winget upgrade --id marlocarlo.psmux --exact --source winget");
        return false;
      },
      installRunner: async () => {
        installed = true;
        return successfulCommand();
      }
    });

    assert.equal(result.status, "declined");
    assert.equal(result.runtime.mode, "psmux_outdated");
    assert.equal(installed, false);
  });

  it("rechecks the psmux version after an accepted upgrade", async () => {
    let checks = 0;
    const result = await ensureCliTerminalRuntime({
      platform: "win32",
      isTTY: true,
      env: {},
      dependencyRunner: async () => {
        checks += 1;
        return {
          exitCode: 0,
          stdout: checks === 1 ? "psmux 3.3.7\n" : "tmux 3.3.8\n",
          stderr: ""
        };
      },
      confirmInstall: async () => true,
      installRunner: async (_command, _args, options) => {
        assert.deepEqual(options, { shell: false });
        return successfulCommand();
      }
    });

    assert.equal(result.status, "ready");
    assert.equal(result.runtime.mode, "native_psmux");
    assert.equal(checks, 2);
  });

  it("detects the first available Linux package manager from the fixed allowlist", async () => {
    const seen: string[] = [];
    let installed = false;
    const result = await ensureCliTerminalRuntime({
      platform: "linux",
      isTTY: true,
      env: {},
      dependencyRunner: async (command) => {
        seen.push(command);
        if (command === "dnf" || command === "sudo") {
          return { exitCode: 0, stdout: `${command} available\n`, stderr: "" };
        }
        return { exitCode: 127, stdout: "", stderr: "not found" };
      },
      confirmInstall: async (request) => {
        assert.equal(request.command, "sudo dnf install -y tmux");
        return false;
      },
      installRunner: async () => {
        installed = true;
        return successfulCommand();
      }
    });

    assert.equal(result.status, "declined");
    assert.deepEqual(seen, ["tmux", "apt-get", "dnf", "sudo"]);
    assert.equal(installed, false);
  });

  it("does not execute an installer when no allowlisted Linux package manager is available", async () => {
    const seen: string[] = [];
    let prompted = false;
    let installed = false;
    const result = await ensureCliTerminalRuntime({
      platform: "linux",
      isTTY: true,
      env: {},
      dependencyRunner: async (command) => {
        seen.push(command);
        return { exitCode: 127, stdout: "", stderr: "not found" };
      },
      confirmInstall: async () => {
        prompted = true;
        return true;
      },
      installRunner: async () => {
        installed = true;
        return successfulCommand();
      }
    });

    assert.equal(result.status, "installer_unavailable");
    assert.match(result.message, /Install tmux manually/i);
    assert.deepEqual(seen, ["tmux", "apt-get", "dnf", "yum", "pacman", "zypper", "apk"]);
    assert.equal(prompted, false);
    assert.equal(installed, false);
  });

  it("does not offer Homebrew on macOS unless brew is available", async () => {
    const seen: string[] = [];
    let prompted = false;
    let installed = false;
    const result = await ensureCliTerminalRuntime({
      platform: "darwin",
      isTTY: true,
      env: {},
      dependencyRunner: async (command) => {
        seen.push(command);
        return { exitCode: 127, stdout: "", stderr: "not found" };
      },
      confirmInstall: async () => {
        prompted = true;
        return true;
      },
      installRunner: async () => {
        installed = true;
        return successfulCommand();
      }
    });

    assert.equal(result.status, "installer_unavailable");
    assert.match(result.message, /brew install tmux/);
    assert.deepEqual(seen, ["tmux", "brew"]);
    assert.equal(prompted, false);
    assert.equal(installed, false);
  });

  it("runs an allowlisted Linux package manager directly when already root", async () => {
    const installCalls: Array<{ command: string; args: string[]; options: { shell: false } }> = [];
    let tmuxChecks = 0;
    const result = await ensureCliTerminalRuntime({
      platform: "linux",
      isTTY: true,
      env: {},
      getUid: () => 0,
      dependencyRunner: async (command) => {
        if (command === "tmux") {
          tmuxChecks += 1;
          return tmuxChecks === 1
            ? { exitCode: 127, stdout: "", stderr: "not found" }
            : { exitCode: 0, stdout: "tmux 3.4\n", stderr: "" };
        }
        return command === "dnf"
          ? { exitCode: 0, stdout: "dnf 4\n", stderr: "" }
          : { exitCode: 127, stdout: "", stderr: "not found" };
      },
      confirmInstall: async (request) => {
        assert.equal(request.command, "dnf install -y tmux");
        return true;
      },
      installRunner: async (command, args, options) => {
        installCalls.push({ command, args, options });
        return successfulCommand();
      }
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(installCalls, [{
      command: "dnf",
      args: ["install", "-y", "tmux"],
      options: { shell: false }
    }]);
  });

  it("does not install on non-root Linux when sudo is unavailable", async () => {
    const seen: string[] = [];
    let prompted = false;
    let installed = false;
    const result = await ensureCliTerminalRuntime({
      platform: "linux",
      isTTY: true,
      env: {},
      getUid: () => 1000,
      dependencyRunner: async (command) => {
        seen.push(command);
        if (command === "dnf") return { exitCode: 0, stdout: "dnf 4\n", stderr: "" };
        return { exitCode: 127, stdout: "", stderr: "not found" };
      },
      confirmInstall: async () => {
        prompted = true;
        return true;
      },
      installRunner: async () => {
        installed = true;
        return successfulCommand();
      }
    });

    assert.equal(result.status, "installer_unavailable");
    assert.match(result.message, /sudo|root/i);
    assert.deepEqual(seen, ["tmux", "apt-get", "dnf", "sudo"]);
    assert.equal(prompted, false);
    assert.equal(installed, false);
  });
});

async function missingCommand() {
  return { exitCode: 127, stdout: "", stderr: "not found" };
}

function successfulCommand() {
  return { exitCode: 0, stdout: "installed\n", stderr: "" };
}
