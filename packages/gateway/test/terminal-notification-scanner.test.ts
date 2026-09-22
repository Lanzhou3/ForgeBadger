import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isTerminalNotification,
  TerminalNotificationScanner,
} from "../src/services/session-server/terminal-notification-scanner.js";

describe("TerminalNotificationScanner", () => {
  it("detects a bare BEL as a bell", () => {
    const scanner = new TerminalNotificationScanner();
    const events = scanner.push("prefix\x07suffix");
    assert.deepEqual(events, [{ kind: "bell" }]);
    assert.deepEqual(scanner.push("more"), []);
  });

  it("coalesces bells inside the suppression window", () => {
    const scanner = new TerminalNotificationScanner({ now: () => 1000 });
    assert.deepEqual(scanner.push("\x07"), [{ kind: "bell" }]);
    assert.deepEqual(scanner.push("\x07"), []);
    assert.deepEqual(scanner.push("\x07"), []);
  });

  it("emits a new bell after the suppression window lapses", () => {
    let clock = 1000;
    const scanner = new TerminalNotificationScanner({ now: () => clock });
    assert.deepEqual(scanner.push("\x07"), [{ kind: "bell" }]);
    clock = 2999;
    assert.deepEqual(scanner.push("\x07"), []);
    clock = 3000;
    assert.deepEqual(scanner.push("\x07"), [{ kind: "bell" }]);
  });

  it("parses a BEL-terminated OSC 9 payload", () => {
    const scanner = new TerminalNotificationScanner();
    const events = scanner.push("ok\x1b]9;Waiting for approval\x07done");
    assert.deepEqual(events, [{ kind: "osc", code: 9, text: "Waiting for approval" }]);
    assert.deepEqual(scanner.push("after"), []);
  });

  it("parses an ST-terminated OSC 9 payload", () => {
    const scanner = new TerminalNotificationScanner();
    const events = scanner.push("\x1b]9;Approval needed\x1b\\tail");
    assert.deepEqual(events, [{ kind: "osc", code: 9, text: "Approval needed" }]);
    assert.deepEqual(scanner.push("after"), []);
  });

  it("emits an empty-text OSC 9 event (terminal may have set an empty message)", () => {
    const scanner = new TerminalNotificationScanner();
    const events = scanner.push("\x1b]9;\x07");
    assert.deepEqual(events, [{ kind: "osc", code: 9, text: "" }]);
  });

  it("detects an OSC 99 payload with A and T fields", () => {
    const scanner = new TerminalNotificationScanner();
    const events = scanner.push("\x1b]99;A=Task finished;T=OpenCode\x07");
    assert.deepEqual(events, [
      { kind: "osc", code: 99, text: "A=Task finished;T=OpenCode" },
    ]);
  });

  it("ignores kitty terminal-protocol capability probes", () => {
    const scanner = new TerminalNotificationScanner();
    assert.deepEqual(scanner.push("\x1b]99;p=?\x1b\\"), []);
    assert.deepEqual(scanner.push("text"), []);
  });

  it("parses an OSC 777 notify payload and preserves semicolons in the body", () => {
    const scanner = new TerminalNotificationScanner();
    const events = scanner.push("\x1b]777;notify;Build done;All tests passed; see logs\x07");
    assert.deepEqual(events, [
      {
        kind: "osc",
        code: 777,
        title: "Build done",
        body: "All tests passed; see logs",
      },
    ]);
  });

  it("ignores OSC 777 payloads with non-notify verbs", () => {
    const scanner = new TerminalNotificationScanner();
    assert.deepEqual(scanner.push("\x1b]777;ask;Do the thing\x07"), []);
  });

  it("emits an empty-title/body event for a bare OSC 777 notify", () => {
    const scanner = new TerminalNotificationScanner();
    assert.deepEqual(scanner.push("\x1b]777;notify\x07"), [
      { kind: "osc", code: 777, title: "", body: "" },
    ]);
  });

  it("ignores unknown OSC codes", () => {
    const scanner = new TerminalNotificationScanner();
    assert.deepEqual(scanner.push("\x1b]0;window title\x07plain"), []);
    assert.deepEqual(scanner.push("\x1b]1337;Remote-Host: x\x07"), []);
  });

  it("does not treat the BEL that terminates an OSC as a bell", () => {
    const scanner = new TerminalNotificationScanner();
    const events = scanner.push("\x1b]9;Approval\x07then \x07");
    assert.deepEqual(events, [
      { kind: "osc", code: 9, text: "Approval" },
      { kind: "bell" },
    ]);
  });

  it("reassembles OSC sequences split across pushes at every boundary", () => {
    const full = "\x1b]9;Waiting for approval\x07";
    for (let splitAt = 1; splitAt < full.length; splitAt++) {
      const scanner = new TerminalNotificationScanner();
      const first = scanner.push(full.slice(0, splitAt));
      assert.deepEqual(
        first,
        [],
        `no event before terminator (split at ${splitAt})`,
      );
      const second = scanner.push(full.slice(splitAt));
      assert.deepEqual(
        second,
        [{ kind: "osc", code: 9, text: "Waiting for approval" }],
        `event after terminator (split at ${splitAt})`,
      );
      assert.deepEqual(scanner.push("after"), []);
    }
  });

  it("releases a partial OSC when an unexpected ESC aborts it", () => {
    const scanner = new TerminalNotificationScanner();
    const events = scanner.push("\x1b]9;abc\x1b[0mplain");
    assert.deepEqual(events, []);
    assert.deepEqual(scanner.push("\x07"), [{ kind: "bell" }]);
  });

  it("caps the pending OSC carry and drops oversized sequences", () => {
    const scanner = new TerminalNotificationScanner();
    const oversized = "\x1b]9;" + "x".repeat(4100) + "\x07";
    assert.deepEqual(scanner.push(oversized), []);
    // No state should leak: the next bell is a plain bell event.
    assert.deepEqual(scanner.push("\x07"), [{ kind: "bell" }]);
  });

  it("ignores plain text with no control sequences", () => {
    const scanner = new TerminalNotificationScanner();
    assert.deepEqual(scanner.push("hello world\nline 2\r\n"), []);
    assert.deepEqual(scanner.push("\x1b[31mred\x1b[0m"), []);
  });
});

describe("isTerminalNotification", () => {
  it("accepts every scanner event shape", () => {
    assert.equal(
      isTerminalNotification({ kind: "bell" }),
      true,
    );
    assert.equal(
      isTerminalNotification({ kind: "osc", code: 9, text: "" }),
      true,
    );
    assert.equal(
      isTerminalNotification({ kind: "osc", code: 99, text: "A=x" }),
      true,
    );
    assert.equal(
      isTerminalNotification({ kind: "osc", code: 777, title: "", body: "" }),
      true,
    );
  });

  it("rejects malformed payloads", () => {
    assert.equal(isTerminalNotification(null), false);
    assert.equal(isTerminalNotification({ kind: "osc", code: 5, text: "x" }), false);
    assert.equal(
      isTerminalNotification({ kind: "osc", code: 9, text: 42 } as never),
      false,
    );
    assert.equal(
      isTerminalNotification({ kind: "osc", code: 777, title: "t" } as never),
      false,
    );
    assert.equal(isTerminalNotification({ kind: "other" }), false);
  });
});
