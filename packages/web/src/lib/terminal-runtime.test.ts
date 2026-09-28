import { describe, expect, expectTypeOf, it } from "vitest";
import type { TerminalRuntimeStatus } from "./api";
import { translations } from "./i18n";
import { getTerminalRuntimeSetupGuidance, getTerminalRuntimeRemediation, terminalRuntimeTranslationKey } from "./terminal-runtime";

describe("session server runtime", () => {
  it("uses the built-in persistence contract", () => {
    expectTypeOf<TerminalRuntimeStatus["persistence"]>().toEqualTypeOf<"session-server">();
    expectTypeOf<TerminalRuntimeStatus["mode"]>().toEqualTypeOf<"ready" | "unavailable">();
  });
  it("reports ready and unavailable without external installation instructions", () => {
    expect(getTerminalRuntimeSetupGuidance("ready", true)).toMatchObject({ blocked: false, severity: "healthy", commands: [] });
    expect(getTerminalRuntimeSetupGuidance("unavailable", false)).toMatchObject({ blocked: true, severity: "error", commands: [] });
    expect(getTerminalRuntimeRemediation("ready").severity).toBe("healthy");
    expect(getTerminalRuntimeRemediation("unavailable").severity).toBe("error");
    expect(terminalRuntimeTranslationKey("ready")).toBe("dashboard.terminalRuntime.ready");
  });
  it("does not treat missing or contradictory discovery as ready", () => {
    expect(getTerminalRuntimeSetupGuidance(undefined).blocked).toBe(true);
    expect(getTerminalRuntimeSetupGuidance("unavailable", true).blocked).toBe(true);
    expect(getTerminalRuntimeSetupGuidance("ready", false).blocked).toBe(true);
  });
  it("all runtime guidance uses built-in terminal copy", () => {
    for (const language of Object.values(translations)) {
      for (const [key, value] of Object.entries(language)) {
        if (key.startsWith("runtimeSetup.") || key.startsWith("dashboard.terminalRuntime.")) {
          expect(value).not.toMatch(/tmux|psmux|winget|WSL/i);
        }
      }
    }
  });
});
