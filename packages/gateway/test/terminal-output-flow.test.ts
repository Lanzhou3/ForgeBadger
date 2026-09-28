import assert from "node:assert/strict";
import { it } from "node:test";
import { TerminalOutputFlow } from "../src/websocket/terminal-output-flow.js";

it("delivers exit only after all queued output is rendered", () => {
  let lastSequence = 0;
  let finished = false;
  const flow = new TerminalOutputFlow({
    send: (frame) => { lastSequence = frame.payload.sequence; },
    pause() {}, fail() { assert.fail("unexpected failure"); }, highWater: 4, chunkSize: 4
  });
  flow.enqueue("terminal_output", "tail-output");
  flow.finish(() => { finished = true; });
  assert.equal(finished, false);
  flow.acknowledge(lastSequence);
  assert.equal(finished, false);
  flow.acknowledge(lastSequence);
  assert.equal(finished, false);
  flow.acknowledge(lastSequence);
  assert.equal(finished, true);
  flow.dispose();
});

it("bounds unacknowledged output, resumes in order after browser render ACK, and releases on dispose", () => {
  const frames: Array<{ type: string; payload: { data: string; sequence: number } }> = [];
  const pauses: boolean[] = [];
  const flow = new TerminalOutputFlow({ send: (frame) => frames.push(frame), pause: (paused) => pauses.push(paused), fail: () => assert.fail("unexpected overflow"), highWater: 8, chunkSize: 4 });
  flow.enqueue("terminal_history", "abcdefghijklm");
  assert.equal(frames.map((f) => f.payload.data).join(""), "abcdefgh");
  assert.equal(pauses.at(-1), true);
  flow.acknowledge(2);
  assert.equal(frames.map((f) => f.payload.data).join(""), "abcdefghijklm");
  assert.deepEqual(frames.map((f) => f.type), ["terminal_history", "terminal_output", "terminal_output", "terminal_output"]);
  flow.acknowledge(4);
  assert.equal(pauses.at(-1), false);
  assert.throws(() => flow.acknowledge(5), /ACK/);
  flow.dispose();
});

it("disconnects a stalled or overflowing consumer instead of accumulating output", async () => {
  let failures = 0;
  const flow = new TerminalOutputFlow({ send() {}, pause() {}, fail() { failures++; }, highWater: 4, chunkSize: 4, maxQueued: 8, ackTimeoutMs: 10 });
  flow.enqueue("terminal_output", "1234");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(failures, 1);
  flow.enqueue("terminal_output", "ignored");
  assert.equal(failures, 1);
  const overflow = new TerminalOutputFlow({ send() {}, pause() {}, fail() { failures++; }, maxQueued: 8 });
  overflow.enqueue("terminal_output", "123456789");
  assert.equal(failures, 2);
});

it("does not split UTF-16 surrogate pairs across output frames", () => {
  const chunks: string[] = [];
  const flow = new TerminalOutputFlow({ send: (frame) => chunks.push(frame.payload.data), pause() {}, fail() {}, chunkSize: 4 });
  flow.enqueue("terminal_output", "abc😀def");
  assert.deepEqual(chunks, ["abc", "😀de", "f"]);
  flow.dispose();
});
