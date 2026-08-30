import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProgrammaticInputControlCommand } from "../src/services/tmux.js";

describe("tmux programmatic input encoding", () => {
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
});
