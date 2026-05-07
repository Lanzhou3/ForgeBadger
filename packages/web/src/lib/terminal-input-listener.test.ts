import { describe, expect, it, vi } from "vitest";

import { replaceTerminalInputListener } from "./terminal-input-listener";

describe("terminal input listener lifecycle", () => {
  it("disposes the previous xterm input listener before registering a replacement", () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const ref: { current: { dispose(): void } | null } = {
      current: { dispose: firstDispose },
    };

    replaceTerminalInputListener(ref, { dispose: secondDispose });

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(ref.current).toEqual({ dispose: secondDispose });
    expect(secondDispose).not.toHaveBeenCalled();
  });

  it("clears and disposes the active listener when no replacement is provided", () => {
    const dispose = vi.fn();
    const ref: { current: { dispose(): void } | null } = {
      current: { dispose },
    };

    replaceTerminalInputListener(ref, null);

    expect(dispose).toHaveBeenCalledOnce();
    expect(ref.current).toBeNull();
  });
});
