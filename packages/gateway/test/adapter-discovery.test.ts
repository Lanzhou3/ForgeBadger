import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  discoverAdapters,
  getAdapterLaunchStatus,
  listAdapterDefinitions
} from "../src/services/adapter-discovery.js";
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
      stdout: `${command} 1.0.0\n`,
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

  it("disables launch when the daemon is unavailable even with installed adapters", async () => {
    const runner: CommandRunner = async (command) => ({ exitCode: 0, stdout: `${command} 1.0`, stderr: "" });
    const adapters = await discoverAdapters(runner, { available: false, message: "daemon unavailable" });
    assert.ok(adapters.every((adapter) => adapter.available && !adapter.launchEnabled));
    assert.match(adapters[0]?.error ?? "", /daemon unavailable/);
  });
});

describe("getAdapterLaunchStatus", () => {
  it("probes only the requested adapter", async () => {
    const probed: string[] = [];
    const runner: CommandRunner = async (command) => {
      probed.push(command);
      return { exitCode: 0, stdout: `${command} 0.41.0\n`, stderr: "" };
    };

    const result = await getAdapterLaunchStatus("kimi", runner);

    assert.deepEqual(probed, ["kimi"]);
    assert.equal(result.available, true);
    assert.equal(result.status, "available");
    assert.equal(result.version, "kimi 0.41.0");
    assert.equal(result.launchEnabled, true);
  });

  it("reports check_failed when the probe times out", async () => {
    const runner: CommandRunner = async () => ({
      exitCode: 124,
      stdout: "",
      stderr: "Command timed out after 10000ms"
    });

    const result = await getAdapterLaunchStatus("kimi", runner);

    assert.equal(result.available, false);
    assert.equal(result.launchEnabled, false);
    assert.equal(result.status, "check_failed");
    assert.match(result.error ?? "", /timed out/);
  });

  it("reports missing when the command cannot be found", async () => {
    const runner: CommandRunner = async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "spawn kimi ENOENT"
    });

    const result = await getAdapterLaunchStatus("kimi", runner);

    assert.equal(result.available, false);
    assert.equal(result.status, "missing");
  });
});
