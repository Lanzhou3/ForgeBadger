import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  confirmDelivery,
  confirmProgrammaticTaskConsumed,
  deliveryNeedle,
  normalizePaneText
} from "../src/services/copilot-bridge/delivery-confirm.js";
import { dispatchSessionInput } from "../src/services/copilot-bridge/bridge-service.js";
import { PROGRAMMATIC_SUBMIT_INDETERMINATE } from "../src/services/programmatic-terminal-submit.js";

describe("dispatch delivery confirmation", () => {
  it("maps any post-write submit failure to a non-retryable delivery uncertainty", async () => {
    let captureCalls = 0;
    const sessionManager = {
      async submitProgrammaticTask() {
        throw new Error(PROGRAMMATIC_SUBMIT_INDETERMINATE);
      },
      async captureHistory() {
        captureCalls += 1;
        return "";
      }
    };

    await assert.rejects(
      () => dispatchSessionInput(sessionManager as never, "session-1", "codex", "hello"),
      /BRIDGE_DELIVERY_UNCONFIRMED/
    );
    assert.equal(captureCalls, 0);
  });

  describe("normalizePaneText", () => {
    it("strips ANSI escape sequences and collapses all whitespace", () => {
      const pane = "\x1b[38;5;174m❯\x1b[39m \x1b[7mecho\x1b[0m MARKER_1\n  \x1b[2mcontinued\x1b[0m";
      assert.equal(normalizePaneText(pane), "❯echoMARKER_1continued");
    });

    it("strips OSC hyperlink sequences", () => {
      const pane = "\x1b]8;id=x;https://example.com\x1b\\link text\x1b]8;;\x1b\\ done";
      assert.equal(normalizePaneText(pane), "linktextdone");
    });

    it("removes line-wrap whitespace so a wrapped needle still matches", () => {
      const needle = deliveryNeedle("echo M3_APPROVAL_OK_1234567890");
      const wrappedPane = "❯ echo M3_APPROVAL_OK_12\n  34567890";
      assert.ok(normalizePaneText(wrappedPane).includes(needle));
    });
  });

  describe("deliveryNeedle", () => {
    it("takes the first 40 normalized characters", () => {
      const needle = deliveryNeedle(`  ${"x".repeat(100)}  `);
      assert.equal(needle, "x".repeat(40));
    });
  });

  describe("confirmDelivery", () => {
    const noSleep = () => Promise.resolve();

    it("confirms when the pane already shows the message", async () => {
      const ok = await confirmDelivery(async () => "❯ echo MARKER_A", "echoMARKER_A", {
        timeoutMs: 1000,
        intervalMs: 10,
        sleep: noSleep
      });
      assert.equal(ok, true);
    });

    it("confirms when the message appears on a later poll", async () => {
      let calls = 0;
      const ok = await confirmDelivery(
        async () => (calls++ < 2 ? "❯ " : "❯ echo MARKER_B"),
        "echoMARKER_B",
        { timeoutMs: 1000, intervalMs: 10, sleep: noSleep }
      );
      assert.equal(ok, true);
      assert.ok(calls >= 3);
    });

    it("fails after the timeout when the pane never shows the message", async () => {
      const start = Date.now();
      const ok = await confirmDelivery(async () => "modal dialog", "echoMARKER_C", {
        timeoutMs: 50,
        intervalMs: 10,
        sleep: noSleep
      });
      assert.equal(ok, false);
      assert.ok(Date.now() - start >= 50, "the full budget is consumed before giving up");
    });

    it("confirms trivially for an unidentifiable (empty) needle", async () => {
      const ok = await confirmDelivery(async () => "", "", { timeoutMs: 1, intervalMs: 1, sleep: noSleep });
      assert.equal(ok, true);
    });
  });

  describe("confirmProgrammaticTaskConsumed", () => {
    const noSleep = () => Promise.resolve();

    it("does not confirm while the task remains in the current composer", async () => {
      const staged = "› echo MARKER_A\n\nmodel · cwd";
      const ok = await confirmProgrammaticTaskConsumed(
        async () => staged,
        "codex",
        staged,
        deliveryNeedle("echo MARKER_A"),
        { timeoutMs: 20, intervalMs: 1, sleep: noSleep }
      );
      assert.equal(ok, false);
    });

    it("confirms after the composer clears even if the task remains in scrollback", async () => {
      const staged = "› echo MARKER_B\n\nmodel · cwd";
      const consumed = "echo MARKER_B\n\n› Ask Codex to do anything\n\nmodel · cwd";
      const ok = await confirmProgrammaticTaskConsumed(
        async () => consumed,
        "codex",
        staged,
        deliveryNeedle("echo MARKER_B"),
        { timeoutMs: 100, intervalMs: 1, sleep: noSleep }
      );
      assert.equal(ok, true);
    });
  });
});
