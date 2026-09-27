import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homedir } from "node:os";

import { checkAdapterUpdate, checkAdapterUpdates, installAdapter, updateAdapter } from "../src/services/adapter-updates.js";
import type { AdapterId } from "../src/services/adapter-discovery.js";
import type { CommandRunner } from "../src/lib/dependency-check.js";

const publicResolver = async () => [{ address: "8.8.8.8", family: 4 }];
const versionFetcher: typeof fetch = async () => new Response(JSON.stringify({ version: "2.0.0" }));

describe("adapter updates", () => {
  it("checks all five local versions against the official npm packages", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ version: "2.0.0" }));
    };
    const runner: CommandRunner = async (command) => ({
      exitCode: command === "kimi" ? 127 : 0,
      stdout: `${command} 1.0.0`,
      stderr: command === "kimi" ? "not found" : ""
    });

    const results = await checkAdapterUpdates({ runner, fetcher, resolveHost: publicResolver });

    assert.deepEqual(results.map((result) => result.id), ["claude", "opencode", "codex", "kimi", "pi"]);
    assert.deepEqual(results.map((result) => result.state), [
      "update_available", "update_available", "update_available", "missing", "update_available"
    ]);
    assert.equal(urls.length, 4);
    assert.ok(urls.includes("https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent/latest"));
    assert.equal(results.find((result) => result.id === "pi")?.command, "pi update --self");
  });

  it("does not offer an update when the registry fails or the installed version is newer", async () => {
    const runner: CommandRunner = async () => ({ exitCode: 0, stdout: "codex-cli 3.0.0", stderr: "" });
    const current = await checkAdapterUpdate("codex", { runner, fetcher: versionFetcher, resolveHost: publicResolver });
    assert.equal(current.state, "up_to_date");

    const failed = await checkAdapterUpdate("codex", {
      runner,
      fetcher: async () => new Response("oops", { status: 503 }),
      resolveHost: publicResolver
    });
    assert.equal(failed.state, "check_failed");
    await assert.rejects(
      updateAdapter("codex", { runner, fetcher: versionFetcher, resolveHost: publicResolver }),
      { statusCode: 409 }
    );
  });

  it("stops reading an oversized registry response at the byte limit", async () => {
    let pulls = 0;
    let cancelled = false;
    const fetcher: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 2) throw new Error("Response body was read beyond the limit");
        controller.enqueue(new Uint8Array(65 * 1024));
      },
      cancel() { cancelled = true; }
    }, { highWaterMark: 0 }));
    const runner: CommandRunner = async () => ({ exitCode: 0, stdout: "codex 1.0.0", stderr: "" });

    const status = await checkAdapterUpdate("codex", { runner, fetcher, resolveHost: publicResolver });

    assert.equal(status.state, "check_failed");
    assert.equal(pulls, 2);
    assert.equal(cancelled, true);
  });

  it("compares a Homebrew OpenCode install with its formula instead of npm", async () => {
    const commands: string[] = [];
    const runner: CommandRunner = async (command, args, options) => {
      commands.push(`${command} ${args.join(" ")}`);
      if (command === "opencode") return { exitCode: 0, stdout: "1.18.31", stderr: "" };
      assert.equal(command, "brew");
      assert.equal(options?.env?.HOMEBREW_NO_AUTO_UPDATE, "1");
      assert.equal(options?.env?.FORGEBADGER_MASTER_KEY, undefined);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ formulae: [{ name: "opencode", full_name: "anomalyco/tap/opencode",
          versions: { stable: "1.18.31" } }] }),
        stderr: ""
      };
    };
    const dependencies = {
      runner,
      resolveExecutable: () => "/opt/homebrew/Cellar/opencode/1.18.31/bin/opencode",
      resolveHost: publicResolver,
      fetcher: async (url: string | URL | Request) => {
        assert.equal(String(url), "https://raw.githubusercontent.com/anomalyco/homebrew-tap/master/opencode.rb");
        return new Response('class Opencode < Formula\n  version "1.18.31"\nend');
      }
    };

    const status = await checkAdapterUpdate("opencode", dependencies);
    assert.equal(status.state, "up_to_date");
    assert.equal(status.latestSource, "homebrew");
    assert.equal(status.latestVersion, "1.18.31");
    await assert.rejects(updateAdapter("opencode", dependencies), { statusCode: 409 });
    assert.deepEqual(commands, [
      "opencode --version", "brew info --json=v2 opencode",
      "opencode --version", "brew info --json=v2 opencode"
    ]);
  });

  it("offers a Homebrew OpenCode update when the formula is newer", async () => {
    let installedVersion = "1.18.31";
    const runner: CommandRunner = async (command, args) => {
      if (command === "brew") {
        return { exitCode: 0, stdout: JSON.stringify({ formulae: [
          { name: "opencode", full_name: "anomalyco/tap/opencode", versions: { stable: "1.18.31" } }
        ] }), stderr: "" };
      }
      if (args[0] === "upgrade") {
        assert.deepEqual(args, ["upgrade", "1.18.32", "--method", "brew"]);
        installedVersion = "1.18.32";
      }
      return { exitCode: 0, stdout: installedVersion, stderr: "" };
    };
    const dependencies = {
      runner,
      resolveExecutable: () => "/opt/homebrew/Cellar/opencode/1.18.31/bin/opencode",
      resolveHost: publicResolver,
      fetcher: async () => new Response('class Opencode < Formula\n  version "1.18.32"\nend')
    };

    const status = await checkAdapterUpdate("opencode", dependencies);
    assert.equal(status.state, "update_available");
    assert.equal(status.latestSource, "homebrew");
    assert.equal(status.command, "opencode upgrade 1.18.32 --method brew");
    const result = await updateAdapter("opencode", dependencies);
    assert.equal(result.installedVersion, "1.18.32");
    assert.equal(result.versionStillBehind, false);
  });

  it("rejects an invalid Homebrew formula version before building update arguments", async () => {
    let upgrades = 0;
    const runner: CommandRunner = async (command, args) => {
      if (command === "brew") {
        return { exitCode: 0, stdout: JSON.stringify({ formulae: [
          { name: "opencode", full_name: "anomalyco/tap/opencode" }
        ] }), stderr: "" };
      }
      if (args[0] === "upgrade") upgrades += 1;
      return { exitCode: 0, stdout: "1.18.31", stderr: "" };
    };
    const dependencies = {
      runner,
      resolveExecutable: () => "/opt/homebrew/Cellar/opencode/1.18.31/bin/opencode",
      resolveHost: publicResolver,
      fetcher: async () => new Response('version "1.18.32;unexpected"')
    };

    assert.equal((await checkAdapterUpdate("opencode", dependencies)).state, "check_failed");
    await assert.rejects(updateAdapter("opencode", dependencies), { statusCode: 503 });
    assert.equal(upgrades, 0);
  });

  it("rejects a Homebrew OpenCode command that exits successfully without upgrading", async () => {
    const runner: CommandRunner = async (command) => command === "brew"
      ? { exitCode: 0, stdout: JSON.stringify({ formulae: [
        { name: "opencode", full_name: "anomalyco/tap/opencode" }
      ] }), stderr: "" }
      : { exitCode: 0, stdout: "1.18.31", stderr: "" };
    const dependencies = {
      runner,
      resolveExecutable: () => "/opt/homebrew/Cellar/opencode/1.18.31/bin/opencode",
      resolveHost: publicResolver,
      fetcher: async () => new Response('version "1.18.32"')
    };

    await assert.rejects(updateAdapter("opencode", dependencies), {
      message: "OpenCode Homebrew upgrade did not reach the target version", statusCode: 502
    });
  });

  it("runs only the official fixed command and verifies the version afterwards", async () => {
    const expected: Record<AdapterId, string[]> = {
      claude: ["update"],
      opencode: ["upgrade"],
      codex: ["update"],
      kimi: ["upgrade", "--yes"],
      pi: ["update", "--self"]
    };
    for (const id of Object.keys(expected) as AdapterId[]) {
      let installed = "1.0.0";
      const commands: Array<[string, string[]]> = [];
      const runner: CommandRunner = async (command, args) => {
        commands.push([command, args]);
        if (args[0] !== "--version") installed = "2.0.0";
        return { exitCode: 0, stdout: `${command} ${installed}`, stderr: "" };
      };

      const result = await updateAdapter(id, { runner, fetcher: versionFetcher, resolveHost: publicResolver });

      assert.deepEqual(commands[1], [id, expected[id]]);
      assert.equal(result.previousVersion, "1.0.0");
      assert.equal(result.installedVersion, "2.0.0");
      assert.equal(result.versionStillBehind, false);
    }
  });

  it("reports when a successful update leaves the old command on PATH", async () => {
    const runner: CommandRunner = async (command) => ({ exitCode: 0, stdout: `${command} 1.0.0`, stderr: "" });
    const result = await updateAdapter("claude", { runner, fetcher: versionFetcher, resolveHost: publicResolver });
    assert.equal(result.versionStillBehind, true);
  });

  it("rejects failed official commands without exposing their output", async () => {
    const runner: CommandRunner = async (_command, args) => args[0] === "--version"
      ? { exitCode: 0, stdout: "1.0.0", stderr: "" }
      : { exitCode: 1, stdout: "secret", stderr: "secret" };
    await assert.rejects(
      updateAdapter("codex", { runner, fetcher: versionFetcher, resolveHost: publicResolver }),
      { message: "Official CLI update command failed", statusCode: 502 }
    );
  });

  it("does not pass Gateway secrets to the official update subprocess", async () => {
    const previous = process.env.FORGEBADGER_MASTER_KEY;
    process.env.FORGEBADGER_MASTER_KEY = "private-test-value";
    try {
      const runner: CommandRunner = async (_command, args, options) => {
        assert.equal(options?.cwd, homedir());
        assert.equal(options?.env?.FORGEBADGER_MASTER_KEY, undefined);
        assert.equal(options?.env?.PATH, process.env.PATH);
        return { exitCode: 0, stdout: args[0] === "--version" ? "1.0.0" : "updated", stderr: "" };
      };
      await updateAdapter("codex", { runner, fetcher: versionFetcher, resolveHost: publicResolver });
    } finally {
      if (previous === undefined) delete process.env.FORGEBADGER_MASTER_KEY;
      else process.env.FORGEBADGER_MASTER_KEY = previous;
    }
  });

  it("offers and runs fixed official npm install commands for every missing CLI", async () => {
    const expected: Record<AdapterId, string[]> = {
      claude: ["install", "-g", "@anthropic-ai/claude-code"],
      opencode: ["install", "-g", "opencode-ai"],
      codex: ["install", "-g", "@openai/codex"],
      kimi: ["install", "-g", "@moonshot-ai/kimi-code"],
      pi: ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent"]
    };
    for (const id of Object.keys(expected) as AdapterId[]) {
      let installed = false;
      const commands: Array<[string, string[]]> = [];
      const runner: CommandRunner = async (command, args, options) => {
        commands.push([command, args]);
        assert.equal(options?.cwd, homedir());
        assert.equal(options?.env?.FORGEBADGER_MASTER_KEY, undefined);
        if (command === "npm" && args[0] === "install") {
          assert.equal(options?.killProcessTree, true);
          installed = true;
          return { exitCode: 0, stdout: "installed", stderr: "" };
        }
        if (command === "npm") return { exitCode: 0, stdout: "10.0.0", stderr: "" };
        return { exitCode: installed ? 0 : 127, stdout: installed ? `${command} 1.2.3` : "", stderr: "" };
      };
      const status = await checkAdapterUpdate(id, { runner, nodeVersion: "22.19.0" });
      assert.equal(status.state, "missing");
      assert.equal(status.installCommand, `npm ${expected[id].join(" ")}`);

      const result = await installAdapter(id, { runner, nodeVersion: "22.19.0" });
      assert.deepEqual(commands[3], ["npm", expected[id]]);
      assert.equal(result.commandAvailable, true);
      assert.equal(result.installedVersion, "1.2.3");
    }
  });

  it("guards Node requirements, npm availability, and already installed CLIs", async () => {
    const missing: CommandRunner = async (command) => ({
      exitCode: 127, stdout: "", stderr: command === "npm" ? "npm missing" : "CLI missing"
    });
    const oldNode = await checkAdapterUpdate("kimi", { runner: missing, nodeVersion: "22.18.0" });
    assert.equal(oldNode.installRequiresNode, "22.19.0");
    await assert.rejects(installAdapter("kimi", { runner: missing, nodeVersion: "22.18.0" }), { statusCode: 409 });
    await assert.rejects(installAdapter("codex", { runner: missing }), { statusCode: 503 });

    const installed: CommandRunner = async () => ({ exitCode: 0, stdout: "codex 1.0.0", stderr: "" });
    await assert.rejects(installAdapter("codex", { runner: installed }), { statusCode: 409 });

    const failedProbe: CommandRunner = async () => ({ exitCode: 124, stdout: "", stderr: "timeout" });
    await assert.rejects(installAdapter("codex", { runner: failedProbe }), { statusCode: 503 });
  });

  it("checks the Node command on Gateway PATH for npm-installed CLIs", async () => {
    const commands: string[] = [];
    const runner: CommandRunner = async (command) => {
      commands.push(command);
      if (command === "node") return { exitCode: 0, stdout: "v20.12.0", stderr: "" };
      return { exitCode: 127, stdout: "", stderr: "missing" };
    };
    const status = await checkAdapterUpdate("pi", { runner });
    assert.equal(status.installRequiresNode, "22.19.0");
    await assert.rejects(installAdapter("pi", { runner }), { statusCode: 409 });
    assert.deepEqual(commands, ["pi", "node", "pi", "node"]);
  });

  it("reports a successful install whose command is still absent from Gateway PATH", async () => {
    const runner: CommandRunner = async (command, args) => command === "npm"
      ? { exitCode: 0, stdout: args[0] === "--version" ? "10.0.0" : "installed", stderr: "" }
      : { exitCode: 127, stdout: "", stderr: "missing" };
    const result = await installAdapter("codex", { runner });
    assert.equal(result.commandAvailable, false);
    assert.equal(result.installedVersion, undefined);
  });

  it("blocks further updates when timed-out tree cleanup is uncertain", async () => {
    let commandsRun = 0;
    const runner: CommandRunner = async (_command, args) => {
      if (args[0] === "--version") return { exitCode: 0, stdout: "1.0.0", stderr: "" };
      commandsRun += 1;
      return { exitCode: 124, stdout: "", stderr: "cleanup uncertain", processTreeCleanupUncertain: true };
    };
    const dependencies = { runner, fetcher: versionFetcher, resolveHost: publicResolver };
    await assert.rejects(updateAdapter("codex", dependencies), { statusCode: 503 });
    await assert.rejects(updateAdapter("claude", dependencies), { statusCode: 409 });
    assert.equal(commandsRun, 1);
  });
});
