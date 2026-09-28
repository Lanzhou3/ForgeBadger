import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import type { CommandResult, CommandRunner } from "../src/lib/dependency-check.js";
import { probeCodexPlannedConfig } from "../src/services/codex-config-probe.js";

const PLANNED_CONFIG = `model = "qwen3.8-27b"
model_provider = "aigw"

[model_providers.aigw]
name = "AIGW"
base_url = "https://api.example-gateway.com/v1"
wire_api = "chat"
experimental_bearer_token = "sk-test-secret"

[model_providers.legacy]
name = "Legacy"
base_url = "https://old.example.com/v1"
wire_api = "chat"
`;

interface CallCapture {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function makeRunner(execResults: Array<Partial<CommandResult> | "version">): {
  runner: CommandRunner;
  calls: CallCapture[];
  /** config.toml content snapshotted at each exec call (the probe home is cleaned up afterwards). */
  execConfigs: string[];
} {
  const calls: CallCapture[] = [];
  const execConfigs: string[] = [];
  let index = 0;
  const runner: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, env: options?.env ?? {} });
    const home = options?.env.CODEX_HOME;
    if (home) execConfigs.push(await readFile(`${home}/config.toml`, "utf8"));
    const spec = execResults[Math.min(index, execResults.length - 1)];
    index += 1;
    if (spec === "version") {
      return { exitCode: 0, stdout: "codex-cli 0.157.1\n", stderr: "" };
    }
    return {
      exitCode: spec.exitCode ?? 1,
      stdout: spec.stdout ?? "",
      stderr: spec.stderr ?? ""
    };
  };
  return { runner, calls, execConfigs };
}

const REMOVAL_ERROR =
  'Error loading config.toml: `wire_api = "chat"` is no longer supported.\n' +
  'How to fix: set `wire_api = "responses"` in your provider config.\n' +
  "in `model_providers.aigw.wire_api`\n";

describe("probeCodexPlannedConfig", () => {
  it("skips when Codex is not installed and never spawns exec", async () => {
    const { runner, calls } = makeRunner([{ exitCode: 127, stderr: "not found" }]);
    const outcome = await probeCodexPlannedConfig({ plannedConfigToml: PLANNED_CONFIG, runner });
    assert.equal(outcome.status, "skipped");
    assert.equal(outcome.codexVersion, undefined);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.args, ["--version"]);
  });

  it("flags the 0.157.x chat removal error and neutralizes provider endpoints", async () => {
    const { runner, calls, execConfigs } = makeRunner([
      "version",
      { exitCode: 1, stderr: REMOVAL_ERROR }
    ]);
    const outcome = await probeCodexPlannedConfig({ plannedConfigToml: PLANNED_CONFIG, runner });

    assert.equal(outcome.status, "unsupported");
    assert.equal(outcome.codexVersion, "codex-cli 0.157.1");
    assert.match(outcome.detail ?? "", /no longer supported/u);
    assert.match(outcome.detail ?? "", /model_providers\.aigw\.wire_api/u);

    // Exactly one exec probe (the removal message is conclusive — no B run).
    assert.equal(calls.length, 2);
    const execCall = calls[1]!;
    assert.equal(execCall.command, "codex");
    assert.ok(execCall.args.includes("exec"));
    const probeConfig = execConfigs[0]!;
    // Every provider endpoint is pointed at the dead local URL and no
    // credential survives into the probe home.
    assert.doesNotMatch(probeConfig, /api\.example-gateway\.com/u);
    assert.doesNotMatch(probeConfig, /old\.example\.com/u);
    assert.match(probeConfig, /base_url = "http:\/\/127\.0\.0\.1:9\/v1"/u);
    assert.doesNotMatch(probeConfig, /sk-test-secret/u);
    assert.doesNotMatch(probeConfig, /experimental_bearer_token/u);
    // The value under test is preserved.
    assert.match(probeConfig, /wire_api = "chat"/u);
  });

  it("cleans up the probe home after an unsupported verdict", async () => {
    const { runner, calls } = makeRunner([
      "version",
      { exitCode: 1, stderr: REMOVAL_ERROR }
    ]);
    await probeCodexPlannedConfig({ plannedConfigToml: PLANNED_CONFIG, runner });
    const home = calls[1]!.env.CODEX_HOME;
    assert.ok(home);
    assert.equal(existsSync(`${home!}/config.toml`), false);
  });

  it("attributes a generic config-load rejection to wire_api via the differential run", async () => {
    const calls: CallCapture[] = [];
    const homes: string[] = [];
    const configs: string[] = [];
    let index = 0;
    const runner: CommandRunner = async (command, args, options) => {
      calls.push({ command, args, env: options?.env ?? {} });
      const home = options?.env.CODEX_HOME;
      if (home) {
        homes.push(home);
        configs.push(await readFile(`${home}/config.toml`, "utf8"));
      }
      index += 1;
      if (index === 1) return { exitCode: 0, stdout: "codex-cli 0.157.1\n", stderr: "" };
      if (index === 2) return { exitCode: 1, stderr: "Error loading config.toml: invalid value for wire_api\n" };
      return { exitCode: 1, stderr: "failed to connect to 127.0.0.1:9\n" };
    };
    const outcome = await probeCodexPlannedConfig({ plannedConfigToml: PLANNED_CONFIG, runner });
    assert.equal(outcome.status, "unsupported");
    assert.match(outcome.detail ?? "", /invalid value for wire_api/u);
    assert.equal(calls.length, 3);
    // Run B reuses the same home; the overwritten plan forces responses.
    assert.equal(homes[1], homes[0]);
    assert.match(configs[1]!, /wire_api = "responses"/u);
    assert.doesNotMatch(configs[1]!, /wire_api = "chat"/u);
  });

  it("stays supported when both runs fail config load (unrelated breakage)", async () => {
    const { runner } = makeRunner([
      "version",
      { exitCode: 1, stderr: "Error loading config.toml: unknown field foo\n" },
      { exitCode: 1, stderr: "Error loading config.toml: unknown field foo\n" }
    ]);
    const outcome = await probeCodexPlannedConfig({ plannedConfigToml: PLANNED_CONFIG, runner });
    assert.equal(outcome.status, "supported");
    assert.equal(outcome.detail, undefined);
  });

  it("stays supported on plain network/auth failures after config load", async () => {
    const { runner, calls } = makeRunner([
      "version",
      { exitCode: 1, stderr: "error sending request for url (http://127.0.0.1:9/v1/responses): connection refused\n" }
    ]);
    const outcome = await probeCodexPlannedConfig({ plannedConfigToml: PLANNED_CONFIG, runner });
    assert.equal(outcome.status, "supported");
    assert.equal(calls.length, 2);
  });

  it("stays supported when the probe times out", async () => {
    const { runner } = makeRunner([
      "version",
      { exitCode: 124, stderr: "Command timed out after 10000ms" }
    ]);
    const outcome = await probeCodexPlannedConfig({ plannedConfigToml: PLANNED_CONFIG, runner });
    assert.equal(outcome.status, "supported");
  });

  it("strips ANSI/OSC codes before matching the removal error", async () => {
    const ansi = REMOVAL_ERROR
      .replace("Error loading config.toml:", "\x1b[31;1mError loading config.toml:\x1b[0m")
      .replace("no longer supported", "\x1b[1mno longer supported\x1b[0m");
    const { runner } = makeRunner([
      "version",
      { exitCode: 1, stderr: `\x1b]0;codex\x07${ansi}` }
    ]);
    const outcome = await probeCodexPlannedConfig({ plannedConfigToml: PLANNED_CONFIG, runner });
    assert.equal(outcome.status, "unsupported");
    assert.doesNotMatch(outcome.detail ?? "", /\x1b/u);
  });

  it("skips instead of blocking when the planned TOML is unparseable", async () => {
    const { runner, calls } = makeRunner(["version"]);
    const outcome = await probeCodexPlannedConfig({
      plannedConfigToml: "not [ valid toml",
      runner
    });
    assert.equal(outcome.status, "skipped");
    assert.equal(calls.length, 1);
  });
});
