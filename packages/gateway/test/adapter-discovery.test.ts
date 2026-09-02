import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { discoverAdapters, listAdapterDefinitions } from "../src/services/adapter-discovery.js";
import type { CommandRunner } from "../src/lib/dependency-check.js";

describe("adapter discovery", () => {
  it("lists Claude, OpenCode, Codex, and Kimi Code as supported adapters", () => {
    const definitions = listAdapterDefinitions();
    assert.equal(definitions.find((adapter) => adapter.id === "claude")?.supportLevel, "supported");
    assert.equal(definitions.find((adapter) => adapter.id === "opencode")?.supportLevel, "supported");
    assert.equal(definitions.find((adapter) => adapter.id === "codex")?.supportLevel, "supported");
    assert.deepEqual(definitions.find((adapter) => adapter.id === "codex")?.runtimeModes, [
      "terminal"
    ]);
    const kimi = definitions.find((adapter) => adapter.id === "kimi");
    assert.equal(kimi?.supportLevel, "supported");
    assert.equal(kimi?.label, "Kimi Code");
    assert.equal(kimi?.command, "kimi");
    assert.equal(kimi?.configDir, ".kimi-code");
    assert.deepEqual(kimi?.runtimeModes, ["terminal"]);
  });

  it("enables launch only when the supported adapter command is available", async () => {
    const runner: CommandRunner = async (command) => ({
      exitCode: command === "opencode" ? 127 : 0,
      // psmux (and tmux) carry a minimum-version gate; use a supported version.
      stdout: command === "psmux" || command === "tmux" ? `${command} 3.3.8\n` : `${command} 1.0.0\n`,
      stderr: command === "opencode" ? "not found" : ""
    });

    const adapters = await discoverAdapters(runner);
    const claude = adapters.find((adapter) => adapter.id === "claude");
    const opencode = adapters.find((adapter) => adapter.id === "opencode");
    const codex = adapters.find((adapter) => adapter.id === "codex");

    assert.equal(claude?.available, true);
    assert.equal(claude?.launchEnabled, true);
    assert.equal(opencode?.available, false);
    assert.equal(opencode?.launchEnabled, false);
    assert.equal(codex?.available, true);
    assert.equal(codex?.supportLevel, "supported");
    assert.equal(codex?.launchEnabled, true);
  });

  it("enables terminal launch on native Windows when psmux and adapter commands exist", async () => {
    const runner: CommandRunner = async (command) => ({
      exitCode: 0,
      stdout: command === "psmux" ? "tmux 3.3.8\n" : `${command} 1.0.0\n`,
      stderr: ""
    });

    const adapters = await discoverAdapters(runner, "win32");

    assert.equal(adapters.every((adapter) => adapter.available), true);
    assert.equal(adapters.every((adapter) => adapter.launchEnabled), true);
    assert.equal(adapters.every((adapter) => adapter.error === undefined), true);
  });

  it("disables terminal launch on native Windows when psmux is missing", async () => {
    const runner: CommandRunner = async (command) => ({
      exitCode: command === "psmux" ? 127 : 0,
      stdout: command === "psmux" ? "" : `${command} 1.0.0\n`,
      stderr: command === "psmux" ? "psmux not found" : ""
    });

    const adapters = await discoverAdapters(runner, "win32");

    assert.equal(adapters.every((adapter) => adapter.available), true);
    assert.equal(adapters.every((adapter) => adapter.launchEnabled === false), true);
    assert.match(adapters[0]?.error ?? "", /Install psmux/);
  });

  it("disables terminal launch when tmux is missing on Unix-like hosts", async () => {
    const runner: CommandRunner = async (command) => ({
      exitCode: command === "tmux" ? 127 : 0,
      stdout: command === "tmux" ? "" : `${command} 1.0.0\n`,
      stderr: command === "tmux" ? "tmux not found" : ""
    });

    const adapters = await discoverAdapters(runner, "linux");

    assert.equal(adapters.every((adapter) => adapter.available), true);
    assert.equal(adapters.every((adapter) => adapter.launchEnabled === false), true);
    assert.match(
      adapters.find((adapter) => adapter.id === "codex")?.error ?? "",
      /Install tmux/
    );
  });
});
