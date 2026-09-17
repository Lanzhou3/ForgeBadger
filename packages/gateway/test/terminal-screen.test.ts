/**
 * Unit tests for TerminalScreen — the per-session headless VT emulator.
 *
 * Covers the spike conclusions that the whole P3 design rests on:
 *   - serialize() preserves SGR colors and truncates scrollback correctly
 *   - the buffer API returns the *rendered* viewport (not the raw stream)
 *   - write-callback watermark flow control pauses/resumes around the queue
 *   - a serialized snapshot replays into an identical screen (round-trip)
 */
import { describe, it } from "node:test";
import assert from "node:assert";

import xtermHeadless from "@xterm/headless";

import { TerminalScreen } from "../src/services/session-server/terminal-screen.js";

const { Terminal } = xtermHeadless;

function writeAndDrain(screen: TerminalScreen, data: string): Promise<void> {
  screen.write(data);
  return screen.whenIdle();
}

describe("TerminalScreen serialize (spike conclusions)", () => {
  it("serialize preserves SGR color sequences", async () => {
    const screen = new TerminalScreen({ cols: 80, rows: 10, scrollback: 100 });
    try {
      await writeAndDrain(screen, "hello\r\n\x1b[1;31mRED\x1b[0m plain\r\n");
      const out = screen.serializeCapture(500);
      assert.match(out, /\x1b\[[0-9;]*31[;m]/, "serialized output must keep the red SGR");
      assert.ok(out.includes("RED"));
    } finally {
      screen.dispose();
    }
  });

  it("serialize({ scrollback }) keeps only the requested tail", async () => {
    const screen = new TerminalScreen({ cols: 80, rows: 10, scrollback: 100 });
    try {
      let data = "";
      for (let i = 0; i < 200; i += 1) data += `line-${i}\r\n`;
      await writeAndDrain(screen, data);

      const full = screen.serializeSnapshot();
      assert.ok(!full.includes("line-0"), "scrollback=100 must have dropped line-0");
      assert.ok(full.includes("line-199"));

      const tail = screen.serializeCapture(50);
      assert.ok(!tail.includes("line-140"), "scrollback:50 must cut line-140");
      assert.ok(tail.includes("line-155"), "scrollback:50 must keep line-155");
      assert.ok(tail.includes("line-199"));
    } finally {
      screen.dispose();
    }
  });

  it("serialized snapshot round-trips into an identical screen", async () => {
    const screen = new TerminalScreen({ cols: 80, rows: 10, scrollback: 100 });
    try {
      await writeAndDrain(screen, "alpha\r\n\x1b[32mgreen\x1b[0m\r\nomega");
      const replay = new Terminal({ cols: 80, rows: 10, scrollback: 100, allowProposedApi: true });
      try {
        await new Promise<void>((resolve) => replay.write(screen.serializeSnapshot(), resolve));
        assert.strictEqual(replayViewport(replay), screen.renderViewport());
        // The cursor position must survive replay too: the source ended
        // mid-line right after "omega", so a write must append there.
        await new Promise<void>((resolve) => replay.write("Z", resolve));
        assert.ok(replayViewport(replay).includes("omegaZ"), "cursor must be restored after replay");
      } finally {
        replay.dispose();
      }
    } finally {
      screen.dispose();
    }
  });
});

describe("TerminalScreen rendered viewport (buffer API)", () => {
  it("returns rendered text, honoring cursor positioning escapes", async () => {
    const screen = new TerminalScreen({ cols: 80, rows: 10, scrollback: 100 });
    try {
      // Fill the screen, then place X at row 2 col 5 via absolute cursor addressing.
      let data = "";
      for (let i = 0; i < 10; i += 1) data += `row${i}-abcdefgh\r\n`;
      await writeAndDrain(screen, `${data}\x1b[2;5HX`);

      const rendered = screen.renderViewport();
      const lines = rendered.split("\n");
      assert.strictEqual(lines[1]?.[4], "X", "X must be rendered at row 2, col 5");
      assert.ok(!rendered.includes("\x1b"), "rendered viewport must not contain raw escapes");
      assert.ok(!rendered.includes("[2;5H"), "must not be the raw byte stream");
    } finally {
      screen.dispose();
    }
  });
});

describe("TerminalScreen resize", () => {
  it("tracks geometry changes", () => {
    const screen = new TerminalScreen({ cols: 80, rows: 24, scrollback: 100 });
    try {
      screen.resize(132, 43);
      assert.strictEqual(screen.cols, 132);
      assert.strictEqual(screen.rows, 43);
    } finally {
      screen.dispose();
    }
  });
});

describe("TerminalScreen write-queue flow control", () => {
  it("pauses above the high watermark and resumes after the queue drains", async () => {
    const pauses: boolean[] = [];
    const screen = new TerminalScreen({
      cols: 80,
      rows: 10,
      scrollback: 100,
      highWaterBytes: 64 * 1024,
      lowWaterBytes: 8 * 1024,
      onFlowPauseChange: (paused) => pauses.push(paused)
    });
    try {
      const chunk = "x".repeat(32 * 1024);
      for (let i = 0; i < 8; i += 1) {
        screen.write(chunk);
      }
      assert.strictEqual(pauses[0], true, "high watermark must pause the source");
      assert.strictEqual(screen.paused, true);

      await screen.whenIdle(10_000);
      assert.strictEqual(screen.paused, false, "draining below the low watermark must resume");
      assert.deepStrictEqual(pauses, [true, false]);
    } finally {
      screen.dispose();
    }
  });

  it("external pause holds compose with the watermark", async () => {
    const pauses: boolean[] = [];
    const screen = new TerminalScreen({
      cols: 80,
      rows: 10,
      scrollback: 100,
      onFlowPauseChange: (paused) => pauses.push(paused)
    });
    try {
      const release = screen.acquirePauseHold();
      assert.strictEqual(screen.paused, true);
      release();
      assert.strictEqual(screen.paused, false);
      release(); // idempotent
      assert.strictEqual(screen.paused, false);
    } finally {
      screen.dispose();
    }
  });

  it("whenIdle resolves immediately when no writes are pending", async () => {
    const screen = new TerminalScreen({ cols: 80, rows: 10, scrollback: 100 });
    try {
      await screen.whenIdle(10); // must not wait out the timeout
    } finally {
      screen.dispose();
    }
  });
});

function replayViewport(term: InstanceType<typeof Terminal>): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let y = buffer.viewportY; y < buffer.viewportY + term.rows; y += 1) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}
