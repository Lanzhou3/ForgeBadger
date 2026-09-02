import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  observeCodexNativeAuthStatus,
  observeCodexNativeAuthStatusForUser,
  resetCodexNativeAuthStatusCache
} from "../src/services/codex-native-auth-status.js";

describe("Codex native auth observation", () => {
  it("normalizes ChatGPT and API-key methods without returning command output", async () => {
    const chatgpt = await observeCodexNativeAuthStatus({ run: async () => ({ exitCode: 0, stdout: "Logged in using ChatGPT", stderr: "" }) });
    const api = await observeCodexNativeAuthStatus({ run: async () => ({ exitCode: 0, stdout: "Logged in with API key", stderr: "" }) });
    assert.deepEqual(chatgpt, { state: "ready", method: "chatgpt" });
    assert.deepEqual(api, { state: "ready", method: "api" });
    assert.equal("stdout" in chatgpt, false);
  });

  it("normalizes missing, unauthenticated, malformed and timeout outcomes", async () => {
    assert.deepEqual(await observeCodexNativeAuthStatus({ run: async () => ({ exitCode: 1, stdout: "Not logged in", stderr: "" }) }), { state: "not_authenticated", method: "unknown" });
    assert.deepEqual(await observeCodexNativeAuthStatus({ run: async () => ({ exitCode: 1, stdout: "unexpected failure", stderr: "network error" }) }), { state: "unknown", method: "unknown" });
    assert.deepEqual(await observeCodexNativeAuthStatus({ run: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }) }), { state: "ready", method: "unknown" });
    assert.deepEqual(await observeCodexNativeAuthStatus({ run: async () => { const error = new Error("spawn codex ENOENT") as NodeJS.ErrnoException; error.code = "ENOENT"; throw error; } }), { state: "cli_missing", method: "unknown" });
    assert.deepEqual(await observeCodexNativeAuthStatus({ timeoutMs: 1, run: async (_command, _args, signal) => await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) }), { state: "unknown", method: "unknown" });
  });

  it("singleflights and briefly caches status probes per user", async () => {
    resetCodexNativeAuthStatusCache();
    let calls = 0;
    const run = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { exitCode: 0, stdout: "Logged in using ChatGPT", stderr: "" };
    };
    const [first, second] = await Promise.all([
      observeCodexNativeAuthStatusForUser("user-a", { run }),
      observeCodexNativeAuthStatusForUser("user-a", { run })
    ]);
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
    await observeCodexNativeAuthStatusForUser("user-a", { run });
    assert.equal(calls, 1);
  });

  it("passes only an allowlisted environment to the native status process", async () => {
    const previous = {
      masterKey: process.env.FORGEBADGER_MASTER_KEY,
      jwtSecret: process.env.FORGEBADGER_JWT_SECRET,
      codexHome: process.env.CODEX_HOME,
      claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
      opencodeConfigDir: process.env.OPENCODE_CONFIG_DIR,
      kimiCodeHome: process.env.KIMI_CODE_HOME
    };
    process.env.FORGEBADGER_MASTER_KEY = "must-not-reach-codex";
    process.env.FORGEBADGER_JWT_SECRET = "must-not-reach-codex";
    process.env.CODEX_HOME = "/tmp/codex-status-home";
    process.env.CLAUDE_CONFIG_DIR = "/tmp/claude-status-home";
    process.env.OPENCODE_CONFIG_DIR = "/tmp/opencode-status-home";
    process.env.KIMI_CODE_HOME = "/tmp/kimi-status-home";
    try {
      let observedEnv: NodeJS.ProcessEnv | undefined;
      const status = await observeCodexNativeAuthStatus({
        run: async (command, args, _signal, options) => {
          assert.equal(command, "codex");
          assert.deepEqual(args, ["login", "status"]);
          observedEnv = options.env;
          return { exitCode: 0, stdout: "Logged in using ChatGPT", stderr: "" };
        }
      });
      assert.deepEqual(status, { state: "ready", method: "chatgpt" });
      assert.ok(observedEnv);
      assert.equal(observedEnv.FORGEBADGER_MASTER_KEY, undefined);
      assert.equal(observedEnv.FORGEBADGER_JWT_SECRET, undefined);
      // Windows process.env exposes the PATH key with its native casing (Path),
      // so resolve it case-insensitively to stay portable across platforms.
      const observedPath = Object.entries(observedEnv).find(([key]) => key.toUpperCase() === "PATH")?.[1];
      assert.equal(observedPath, process.env.PATH);
      assert.equal(observedEnv.CODEX_HOME, "/tmp/codex-status-home");
      assert.equal(observedEnv.CLAUDE_CONFIG_DIR, "/tmp/claude-status-home");
      assert.equal(observedEnv.OPENCODE_CONFIG_DIR, "/tmp/opencode-status-home");
      assert.equal(observedEnv.KIMI_CODE_HOME, "/tmp/kimi-status-home");
    } finally {
      restoreEnv("FORGEBADGER_MASTER_KEY", previous.masterKey);
      restoreEnv("FORGEBADGER_JWT_SECRET", previous.jwtSecret);
      restoreEnv("CODEX_HOME", previous.codexHome);
      restoreEnv("CLAUDE_CONFIG_DIR", previous.claudeConfigDir);
      restoreEnv("OPENCODE_CONFIG_DIR", previous.opencodeConfigDir);
      restoreEnv("KIMI_CODE_HOME", previous.kimiCodeHome);
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
