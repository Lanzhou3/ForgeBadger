import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTmuxAttachEnv } from "../src/websocket/terminal.js";

describe("buildTmuxAttachEnv", () => {
  it("clears TMUX before attaching to avoid nested tmux detection", () => {
    const env = buildTmuxAttachEnv({
      PATH: "/usr/bin",
      TMUX: "/tmp/tmux-1000/default,123,0"
    });

    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.TMUX, "");
  });
});
