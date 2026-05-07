import { describe, expect, it } from "vitest";

import { shouldCopyTerminalSelection } from "./terminal-copy";

function keyboardEvent(options: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  return options as KeyboardEvent;
}

describe("terminal copy shortcuts", () => {
  it("copies selected terminal text for platform copy shortcuts", () => {
    expect(
      shouldCopyTerminalSelection(keyboardEvent({ key: "c", ctrlKey: true }), true)
    ).toBe(true);
    expect(
      shouldCopyTerminalSelection(keyboardEvent({ key: "C", metaKey: true }), true)
    ).toBe(true);
  });

  it("keeps terminal Ctrl+C input when no text is selected", () => {
    expect(
      shouldCopyTerminalSelection(keyboardEvent({ key: "c", ctrlKey: true }), false)
    ).toBe(false);
  });

  it("does not treat modified shortcuts as copy", () => {
    expect(
      shouldCopyTerminalSelection(
        keyboardEvent({ key: "c", ctrlKey: true, shiftKey: true }),
        true
      )
    ).toBe(false);
  });
});
