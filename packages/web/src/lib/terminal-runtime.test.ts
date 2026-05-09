import { describe, expect, it } from "vitest";

import { terminalRuntimeTranslationKey } from "./terminal-runtime";

describe("terminalRuntimeTranslationKey", () => {
  it("maps known terminal runtime modes to dashboard translation keys", () => {
    expect(terminalRuntimeTranslationKey("native_tmux")).toBe("dashboard.terminalRuntime.native");
    expect(terminalRuntimeTranslationKey("wsl_required")).toBe("dashboard.terminalRuntime.wslRequired");
    expect(terminalRuntimeTranslationKey("tmux_missing")).toBe("dashboard.terminalRuntime.tmuxMissing");
  });

  it("falls back to the generic dependency description for unknown modes", () => {
    expect(terminalRuntimeTranslationKey("future-mode")).toBe("dashboard.dependenciesHealthDescription");
  });
});
