import { describe, expect, it } from "vitest";

import {
  getTerminalRuntimeRemediation,
  terminalRuntimeTranslationKey,
} from "./terminal-runtime";

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

describe("getTerminalRuntimeRemediation", () => {
  it.each([
    ["native_tmux", "healthy", "dashboard.terminalRuntime.native"],
    ["wsl_required", "error", "dashboard.terminalRuntime.wslRequired"],
    ["tmux_missing", "error", "dashboard.terminalRuntime.tmuxMissing"],
    [undefined, "warning", "dashboard.dependenciesHealthUnavailable"],
    ["future-mode", "warning", "dashboard.dependenciesHealthUnavailable"],
  ] as const)("maps %s to actionable remediation metadata", (mode, severity, detailKey) => {
    expect(getTerminalRuntimeRemediation(mode)).toMatchObject({
      detailKey,
      actionKey: "dashboard.runtimeRemediation.openSettings",
      href: "/settings",
      severity,
    });
  });

  it("does not include secret-like values in remediation metadata", () => {
    const serialized = JSON.stringify([
      getTerminalRuntimeRemediation("native_tmux"),
      getTerminalRuntimeRemediation("wsl_required"),
      getTerminalRuntimeRemediation("tmux_missing"),
      getTerminalRuntimeRemediation("future-mode"),
    ]);

    expect(serialized).not.toMatch(/OPENFORGE|JWT|Bearer |attach token|sk-/i);
  });
});
