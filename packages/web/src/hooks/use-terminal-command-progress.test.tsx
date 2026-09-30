// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import { LanguageProvider } from "@/hooks/use-language";
import { useTerminalCommandProgress } from "@/hooks/use-terminal-command-progress";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

function emitProgress(payload: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(FORGEBADGER_GATEWAY_EVENT, {
        detail: { type: "terminal_command_progress", payload }
      })
    );
  });
}

describe("useTerminalCommandProgress", () => {
  it("shows running progress for the current conversation", () => {
    const { result } = renderHook(() => useTerminalCommandProgress("conv-1"), { wrapper });
    expect(result.current).toBeNull();

    emitProgress({
      conversation_id: "conv-1",
      command: "pnpm -r typecheck",
      output_tail: "scope-a: pass\n",
      status: "running"
    });

    expect(result.current).toEqual({
      command: "pnpm -r typecheck",
      outputTail: "scope-a: pass\n",
      status: "running"
    });
  });

  it("ignores progress from other conversations and unrelated events", () => {
    const { result } = renderHook(() => useTerminalCommandProgress("conv-1"), { wrapper });

    emitProgress({
      conversation_id: "conv-2",
      command: "echo other",
      output_tail: "",
      status: "running"
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent(FORGEBADGER_GATEWAY_EVENT, {
          detail: { type: "session_status_changed", payload: { session_id: "s" } }
        })
      );
    });

    expect(result.current).toBeNull();
  });

  it("keeps a finished command visible briefly, then fades it out", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useTerminalCommandProgress("conv-1"), { wrapper });
      emitProgress({
        conversation_id: "conv-1",
        command: "echo done",
        output_tail: "done",
        status: "completed"
      });
      expect(result.current?.status).toBe("completed");

      act(() => {
        vi.advanceTimersByTime(3_999);
      });
      expect(result.current?.status).toBe("completed");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops stale progress when the conversation changes", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useTerminalCommandProgress(id),
      { initialProps: { id: "conv-1" as string | null }, wrapper }
    );
    emitProgress({
      conversation_id: "conv-1",
      command: "echo x",
      output_tail: "x",
      status: "running"
    });
    expect(result.current).not.toBeNull();

    rerender({ id: "conv-2" });
    expect(result.current).toBeNull();
  });
});
