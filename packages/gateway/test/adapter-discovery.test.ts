import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { discoverAdapters, listAdapterDefinitions } from "../src/services/adapter-discovery.js";
import type { CommandRunner } from "../src/lib/dependency-check.js";

describe("adapter discovery", () => {
  it("lists Claude, OpenCode, and Codex as supported adapters", () => {
    const definitions = listAdapterDefinitions();
    assert.equal(definitions.find((adapter) => adapter.id === "claude")?.supportLevel, "supported");
    assert.equal(definitions.find((adapter) => adapter.id === "opencode")?.supportLevel, "supported");
    assert.equal(definitions.find((adapter) => adapter.id === "codex")?.supportLevel, "supported");
    assert.deepEqual(definitions.find((adapter) => adapter.id === "codex")?.runtimeModes, [
      "terminal",
      "app-server-stdio",
      "app-server-websocket"
    ]);
  });

  it("enables launch only when the supported adapter command is available", async () => {
    const runner: CommandRunner = async (command) => ({
      exitCode: command === "opencode" ? 127 : 0,
      stdout: command === "codex" ? "codex 1.0.0\n" : `${command} 1.0.0\n`,
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

  it("disables terminal launch on native Windows even when adapter commands exist", async () => {
    const runner: CommandRunner = async (command) => ({
      exitCode: 0,
      stdout: `${command} 1.0.0\n`,
      stderr: ""
    });

    const adapters = await discoverAdapters(runner, "win32");

    assert.equal(adapters.every((adapter) => adapter.available), true);
    assert.equal(adapters.every((adapter) => adapter.launchEnabled === false), true);
    assert.match(
      adapters.find((adapter) => adapter.id === "claude")?.error ?? "",
      /Native Windows terminals require WSL/
    );
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
