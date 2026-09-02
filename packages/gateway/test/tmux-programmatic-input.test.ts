import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCreateSessionArgs,
  buildProgrammaticInputControlCommand,
  createTmuxClient
} from "../src/services/tmux.js";
import { resolveTerminalMultiplexerRuntime } from "../src/services/terminal-multiplexer-runtime.js";

describe("tmux programmatic input encoding", () => {
  it("keeps explicitly supplied session variables after sanitizing the multiplexer base environment", () => {
    // Arrange / Act
    const args = buildCreateSessionArgs(
      {
        name: "of-safe-session",
        cwd: "/workspace/project",
        command: "codex",
        args: ["-m", "gpt-5"],
        env: {
          PATH: "/session/bin",
          OPENAI_API_KEY: "session-model-secret",
          FORGEBADGER_ATTACH_TOKEN: "session-attach-secret"
        }
      },
      {
        PATH: "/host/bin",
        OPENAI_API_KEY: "host-model-secret",
        FORGEBADGER_MASTER_KEY: "gateway-master-secret",
        ORDINARY_BUT_UNNEEDED: "do-not-inherit"
      }
    );

    // Assert
    assert.deepEqual(args.slice(0, 7), [
      "new-session", "-d", "-s", "of-safe-session", "-c", "/workspace/project", "-E"
    ]);
    assert.deepEqual(args.slice(args.indexOf("--")), ["--", "codex", "-m", "gpt-5"]);
    const sessionEnv = parseSessionEnvironmentArgs(args);
    assert.equal(sessionEnv.PATH, "/session/bin");
    assert.equal(sessionEnv.OPENAI_API_KEY, "session-model-secret");
    assert.equal(sessionEnv.FORGEBADGER_ATTACH_TOKEN, "session-attach-secret");
    assert.equal(sessionEnv.FORGEBADGER_MASTER_KEY, "");
    assert.equal(sessionEnv.ORDINARY_BUT_UNNEEDED, "");
    assert.equal(args.some((value) => value.includes("host-model-secret")), false);
    assert.equal(args.some((value) => value.includes("gateway-master-secret")), false);
  });

  it("copies required non-sensitive host variables into an existing multiplexer session", () => {
    // Arrange / Act
    const args = buildCreateSessionArgs(
      {
        name: "of-safe-session",
        cwd: "/workspace/project",
        command: "codex",
        args: [],
        env: {}
      },
      {
        PATH: "/host/bin",
        HOME: "/home/tester",
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        CODEX_HOME: "/home/tester/.codex-custom",
        CLAUDE_CONFIG_DIR: "/home/tester/.claude-custom",
        OPENCODE_CONFIG_DIR: "/home/tester/.config/opencode-custom",
        KIMI_CODE_HOME: "/home/tester/.kimi-code-custom",
        APP_SECRET: "must-not-leak"
      }
    );

    // Assert
    assert.ok(args.includes("PATH=/host/bin"));
    assert.ok(args.includes("HOME=/home/tester"));
    assert.ok(args.includes("LANG=en_US.UTF-8"));
    assert.ok(args.includes("LC_ALL=en_US.UTF-8"));
    assert.ok(args.includes("CODEX_HOME=/home/tester/.codex-custom"));
    assert.ok(args.includes("CLAUDE_CONFIG_DIR=/home/tester/.claude-custom"));
    assert.ok(args.includes("OPENCODE_CONFIG_DIR=/home/tester/.config/opencode-custom"));
    assert.ok(args.includes("KIMI_CODE_HOME=/home/tester/.kimi-code-custom"));
    assert.ok(args.includes("APP_SECRET="));
    assert.equal(args.some((value) => value.includes("must-not-leak")), false);
  });

  it("skips inherited variables whose names the multiplexer cannot accept", () => {
    // Arrange / Act
    const args = buildCreateSessionArgs(
      {
        name: "of-safe-session",
        cwd: "/workspace/project",
        command: "codex",
        args: [],
        env: {}
      },
      {
        PATH: "/host/bin",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        "CommonProgramFiles(x86)": "C:\\Program Files\\Common Files"
      }
    );

    // Assert
    assert.ok(args.includes("PATH=/host/bin"));
    assert.equal(args.some((value) => value.includes("ProgramFiles(x86)")), false);
    assert.equal(args.some((value) => value.includes("CommonProgramFiles(x86)")), false);
  });

  it("encodes UTF-8 and multiline input as bracketed-paste hex without plaintext", () => {
    const canary = "secret-中文\nsecond line";
    const command = buildProgrammaticInputControlCommand("of-safe-target", canary);

    assert.equal(command.includes(canary), false);
    assert.equal(command.includes("secret-"), false);
    assert.match(command, /^send-keys -t of-safe-target -H (?:[0-9a-f]{2} ?)+$/);
    assert.match(command, /1b 5b 32 30 30 7e/);
    assert.match(command, /1b 5b 32 30 31 7e$/);
    assert.equal(command.match(/send-keys/g)?.length, 1);
  });

  it("rejects a tmux target that could inject a control command", () => {
    assert.throws(
      () => buildProgrammaticInputControlCommand("target; kill-server", "hello"),
      /invalid tmux target/
    );
  });

  it("rejects task text that can terminate bracketed paste early", () => {
    assert.throws(
      () => buildProgrammaticInputControlCommand(
        "of-safe-target",
        "hello\u001b[201~\rInjected command"
      ),
      /PROGRAMMATIC_SUBMIT_UNSAFE_INPUT/
    );
  });

  it("keeps send-keys -H encoding available to the native psmux client", () => {
    const runtime = resolveTerminalMultiplexerRuntime("win32");
    const client = createTmuxClient(runtime);
    const command = buildProgrammaticInputControlCommand("of-safe-target", "中文🙂");

    assert.equal(runtime.kind, "psmux");
    assert.equal(typeof client.stageProgrammaticInput, "function");
    assert.match(command, /^send-keys -t of-safe-target -H (?:[0-9a-f]{2} ?)+$/);
    assert.equal(command.includes("中文🙂"), false);
  });
});

function parseSessionEnvironmentArgs(args: string[]): Record<string, string> {
  const separator = args.indexOf("--");
  const env: Record<string, string> = {};
  for (let index = 7; index < separator; index += 2) {
    assert.equal(args[index], "-e");
    const assignment = args[index + 1] ?? "";
    const equals = assignment.indexOf("=");
    assert.ok(equals > 0);
    env[assignment.slice(0, equals)] = assignment.slice(equals + 1);
  }
  return env;
}
