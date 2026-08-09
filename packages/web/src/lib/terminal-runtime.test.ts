import { describe, expect, it } from "vitest";

import {
  getTerminalRuntimeSetupGuidance,
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

describe("getTerminalRuntimeSetupGuidance", () => {
  it("marks native tmux as ready without install commands", () => {
    expect(getTerminalRuntimeSetupGuidance("native_tmux", true)).toMatchObject({
      titleKey: "runtimeSetup.readyTitle",
      blocked: false,
      severity: "healthy",
      commands: [],
    });
  });

  it("returns explicit tmux install and verify commands when tmux is missing", () => {
    expect(getTerminalRuntimeSetupGuidance("tmux_missing", false)).toMatchObject({
      titleKey: "runtimeSetup.tmuxMissingTitle",
      blocked: true,
      severity: "error",
      commands: [
        { labelKey: "runtimeSetup.commandMac", command: "brew install tmux" },
        { labelKey: "runtimeSetup.commandLinux", command: "sudo apt-get install tmux" },
        { labelKey: "runtimeSetup.commandVerify", command: "tmux -V" },
      ],
    });
  });

  it("returns WSL setup commands for native Windows runtime gaps", () => {
    expect(getTerminalRuntimeSetupGuidance("wsl_required", false)).toMatchObject({
      titleKey: "runtimeSetup.wslRequiredTitle",
      blocked: true,
      severity: "error",
      commands: [
        { labelKey: "runtimeSetup.commandWindows", command: "wsl --install" },
        { labelKey: "runtimeSetup.commandLinux", command: "sudo apt-get install tmux" },
        { labelKey: "runtimeSetup.commandVerify", command: "tmux -V" },
      ],
    });
  });

  it("falls back safely when dependency status is unavailable", () => {
    expect(getTerminalRuntimeSetupGuidance(undefined)).toMatchObject({
      titleKey: "runtimeSetup.unavailableTitle",
      blocked: true,
      severity: "warning",
      commands: [],
    });
  });

  it("does not include secret-like values in setup guidance", () => {
    const serialized = JSON.stringify([
      getTerminalRuntimeSetupGuidance("native_tmux", true),
      getTerminalRuntimeSetupGuidance("wsl_required", false),
      getTerminalRuntimeSetupGuidance("tmux_missing", false),
      getTerminalRuntimeSetupGuidance(undefined),
    ]);

    expect(serialized).not.toMatch(/OPENFORGE|JWT|Bearer |attach token|sk-/i);
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
