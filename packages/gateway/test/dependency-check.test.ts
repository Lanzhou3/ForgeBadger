import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkCommand, checkGateADependencies } from "../src/lib/dependency-check.js";

describe("checkCommand", () => {
  it("reports an available command with version output", async () => {
    const result = await checkCommand("tmux", ["-V"], async () => ({
      exitCode: 0,
      stdout: "tmux 3.4\n",
      stderr: ""
    }));

    assert.deepEqual(result, {
      name: "tmux",
      available: true,
      version: "tmux 3.4"
    });
  });

  it("reports an unavailable command with stderr context", async () => {
    const result = await checkCommand("claude", ["--version"], async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "command not found"
    }));

    assert.equal(result.name, "claude");
    assert.equal(result.available, false);
    assert.equal(result.error, "command not found");
  });
});

describe("checkGateADependencies", () => {
  it("checks tmux and claude commands", async () => {
    const seen: string[] = [];

    const result = await checkGateADependencies(async (command) => {
      seen.push(command);
      return {
        exitCode: 0,
        stdout: `${command} ok\n`,
        stderr: ""
      };
    });

    assert.deepEqual(seen, ["tmux", "claude"]);
    assert.equal(result.every((item) => item.available), true);
  });
});
