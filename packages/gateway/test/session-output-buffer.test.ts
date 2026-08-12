import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SessionOutputRing,
  MAX_CHARS_PER_SESSION,
  MAX_LINES_DEFAULT
} from "../src/services/session-output-buffer.js";
import {
  InMemorySessionManager,
  MAX_BUFFERED_SESSIONS
} from "../src/services/session-manager.js";
import type { LaunchPlan } from "../src/adapters/claude.js";
import type { TmuxClient } from "../src/services/tmux.js";

describe("SessionOutputRing", () => {
  it("appends raw pty output in order", () => {
    const ring = new SessionOutputRing();
    ring.append("line one\n");
    ring.append("line two\n");

    const tail = ring.getTail();
    assert.equal(tail.output, "line one\nline two\n");
    assert.equal(tail.truncated, false);
    assert.equal(tail.lineCount, 2);
  });

  it("drops the oldest characters once the per-session cap is exceeded", () => {
    const ring = new SessionOutputRing();
    const chunkSize = 100;
    const chunks: string[] = [];
    let total = 0;
    while (total < MAX_CHARS_PER_SESSION + chunkSize * 3) {
      const chunk = `c${chunks.length.toString().padStart(8, "0")}`.padEnd(chunkSize, "x");
      chunks.push(chunk);
      total += chunk.length;
    }
    for (const chunk of chunks) {
      ring.append(chunk);
    }

    const tail = ring.getTail();
    assert.equal(tail.truncated, true);
    assert.equal(tail.output.length, MAX_CHARS_PER_SESSION);
    // The oldest chunk (head of the stream) is fully evicted.
    assert.ok(!tail.output.includes(chunks[0]!));
    // The newest chunk is preserved in the tail.
    assert.ok(tail.output.endsWith(chunks[chunks.length - 1]!));
  });

  it("returns the last N lines for getTail(maxLines)", () => {
    const ring = new SessionOutputRing();
    ring.append(Array.from({ length: 10 }, (_, index) => `line${index}`).join("\n") + "\n");

    const tail = ring.getTail(3);
    assert.equal(tail.output, "line7\nline8\nline9\n");
    assert.equal(tail.lineCount, 10);
  });

  it("defaults maxLines to MAX_LINES_DEFAULT", () => {
    const ring = new SessionOutputRing();
    const totalLines = MAX_LINES_DEFAULT + 50;
    const lines = Array.from({ length: totalLines }, (_, index) => `row${index}`).join("\n");
    ring.append(lines);

    const tail = ring.getTail();
    assert.equal(tail.output.split("\n").length, MAX_LINES_DEFAULT);
    assert.equal(tail.lineCount, totalLines);
  });

  it("reports lineCount as total lines of the buffered output", () => {
    const ring = new SessionOutputRing();
    ring.append("a\nb\nc"); // no trailing newline

    assert.equal(ring.getTail().lineCount, 3);
    assert.equal(ring.getTail(2).output, "b\nc");
  });

  it("returns empty output for an empty buffer", () => {
    const ring = new SessionOutputRing();

    assert.deepEqual(ring.getTail(), { output: "", truncated: false, lineCount: 0 });
    assert.deepEqual(ring.getTail(100), { output: "", truncated: false, lineCount: 0 });
  });
});

describe("InMemorySessionManager session output buffer", () => {
  it("no-ops appendSessionOutput when the session does not exist", () => {
    const manager = new InMemorySessionManager(fakeTmux());

    manager.appendSessionOutput("missing-session", "data\n");

    assert.equal(manager.getSessionOutput("missing-session"), undefined);
  });

  it("records and returns output for a live session", async () => {
    const manager = new InMemorySessionManager(fakeTmux());
    await manager.createSession({
      userId: "user_1",
      sessionId: "session_1",
      launchPlan: minimalLaunchPlan()
    });

    manager.appendSessionOutput("session_1", "one\n");
    manager.appendSessionOutput("session_1", "two\n");

    const ring = manager.getSessionOutput("session_1");
    assert.ok(ring);
    assert.deepEqual(ring.getTail(), {
      output: "one\ntwo\n",
      truncated: false,
      lineCount: 2
    });
  });

  it("evicts the oldest buffered session once the cap is reached", async () => {
    const manager = new InMemorySessionManager(fakeTmux());
    for (let index = 0; index <= MAX_BUFFERED_SESSIONS; index += 1) {
      const sessionId = `session_${index}`;
      await manager.createSession({
        userId: "user_1",
        sessionId,
        launchPlan: minimalLaunchPlan()
      });
      manager.appendSessionOutput(sessionId, `out${index}\n`);
    }

    // The first buffered session is evicted; the newest stays.
    assert.equal(manager.getSessionOutput("session_0"), undefined);
    assert.ok(manager.getSessionOutput(`session_${MAX_BUFFERED_SESSIONS}`));
  });

  it("removeSessionOutput drops the buffer", async () => {
    const manager = new InMemorySessionManager(fakeTmux());
    await manager.createSession({
      userId: "user_1",
      sessionId: "session_1",
      launchPlan: minimalLaunchPlan()
    });
    manager.appendSessionOutput("session_1", "hello\n");
    assert.ok(manager.getSessionOutput("session_1"));

    manager.removeSessionOutput("session_1");

    assert.equal(manager.getSessionOutput("session_1"), undefined);
  });
});

function minimalLaunchPlan(): LaunchPlan {
  return {
    command: "bash",
    args: [],
    cwd: "/tmp",
    env: { OPENFORGE_SESSION_ID: "session_1" },
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

function fakeTmux(): TmuxClient {
  return {
    async createSession() {},
    async killSession() {},
    async capturePane() {
      return "";
    },
    async listSessions() {
      return [];
    }
  };
}
