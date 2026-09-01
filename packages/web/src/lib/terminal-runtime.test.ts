import { describe, expect, expectTypeOf, it } from "vitest";

import type { TerminalRuntimeStatus } from "./api";
import { translations, type Language } from "./i18n";

import {
  getTerminalRuntimeSetupGuidance,
  getTerminalRuntimeRemediation,
  terminalRuntimeTranslationKey,
} from "./terminal-runtime";

describe("terminalRuntimeTranslationKey", () => {
  it("maps known terminal runtime modes to dashboard translation keys", () => {
    expect(terminalRuntimeTranslationKey("native_tmux")).toBe("dashboard.terminalRuntime.native");
    expect(terminalRuntimeTranslationKey("native_psmux")).toBe("dashboard.terminalRuntime.nativePsmux");
    expect(terminalRuntimeTranslationKey("wsl_required")).toBe("dashboard.terminalRuntime.wslRequired");
    expect(terminalRuntimeTranslationKey("tmux_missing")).toBe("dashboard.terminalRuntime.tmuxMissing");
    expect(terminalRuntimeTranslationKey("psmux_missing")).toBe("dashboard.terminalRuntime.psmuxMissing");
    expect(terminalRuntimeTranslationKey("psmux_outdated")).toBe("dashboard.terminalRuntime.psmuxOutdated");
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

  it("marks native psmux as ready without install commands", () => {
    expect(getTerminalRuntimeSetupGuidance("native_psmux", true)).toMatchObject({
      titleKey: "runtimeSetup.readyTitle",
      descriptionKey: "runtimeSetup.psmuxReadyDescription",
      blocked: false,
      severity: "healthy",
      commands: [],
    });
  });

  it("defers tmux package-manager detection to the Gateway host", () => {
    const guidance = getTerminalRuntimeSetupGuidance("tmux_missing", false);

    expect(guidance).toMatchObject({
      titleKey: "runtimeSetup.tmuxMissingTitle",
      blocked: true,
      severity: "error",
      commands: [
        { labelKey: "runtimeSetup.commandGatewayHost", command: "forgebadger start" },
      ],
      links: [
        {
          labelKey: "runtimeSetup.tmuxOfficialInstallGuide",
          href: "https://github.com/tmux/tmux/wiki/Installing",
        },
      ],
    });
    expect(JSON.stringify(guidance)).not.toMatch(/brew install|apt-get|dnf|yum|pacman|zypper|apk/);
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

  it("returns the exact official WinGet install command when psmux is missing", () => {
    expect(getTerminalRuntimeSetupGuidance("psmux_missing", false)).toMatchObject({
      titleKey: "runtimeSetup.psmuxMissingTitle",
      descriptionKey: "runtimeSetup.psmuxMissingDescription",
      blocked: true,
      severity: "error",
      commands: [
        {
          labelKey: "runtimeSetup.commandWindows",
          command: "winget install --id marlocarlo.psmux --exact --source winget",
        },
        { labelKey: "runtimeSetup.commandVerify", command: "psmux -V" },
      ],
    });
  });

  it("returns the exact WinGet upgrade command when psmux is outdated", () => {
    expect(getTerminalRuntimeSetupGuidance("psmux_outdated", false)).toMatchObject({
      titleKey: "runtimeSetup.psmuxOutdatedTitle",
      descriptionKey: "runtimeSetup.psmuxOutdatedDescription",
      blocked: true,
      severity: "error",
      commands: [
        {
          labelKey: "runtimeSetup.commandWindows",
          command: "winget upgrade --id marlocarlo.psmux --exact --source winget",
        },
        { labelKey: "runtimeSetup.commandVerify", command: "psmux -V" },
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
      getTerminalRuntimeSetupGuidance("native_psmux", true),
      getTerminalRuntimeSetupGuidance("wsl_required", false),
      getTerminalRuntimeSetupGuidance("tmux_missing", false),
      getTerminalRuntimeSetupGuidance("psmux_missing", false),
      getTerminalRuntimeSetupGuidance("psmux_outdated", false),
      getTerminalRuntimeSetupGuidance(undefined),
    ]);

    expect(serialized).not.toMatch(
      /FORGEBADGER_(?:MASTER_KEY|JWT_SECRET)|JWT|Bearer |attach token|sk-/i
    );
  });

  it("keeps native psmux status copy free of tmux-only guidance", () => {
    const guidance = getTerminalRuntimeSetupGuidance("native_psmux", true);
    const detailKey = terminalRuntimeTranslationKey("native_psmux");
    const languages: Language[] = ["zh-CN", "zh-TW", "en"];

    for (const language of languages) {
      expect(translations[language][guidance.descriptionKey]).not.toMatch(/tmux/i);
      expect(translations[language][detailKey]).not.toMatch(/tmux/i);
    }
  });
});

describe("getTerminalRuntimeRemediation", () => {
  it.each([
    ["native_tmux", "healthy", "dashboard.terminalRuntime.native"],
    ["native_psmux", "healthy", "dashboard.terminalRuntime.nativePsmux"],
    ["wsl_required", "error", "dashboard.terminalRuntime.wslRequired"],
    ["tmux_missing", "error", "dashboard.terminalRuntime.tmuxMissing"],
    ["psmux_missing", "error", "dashboard.terminalRuntime.psmuxMissing"],
    ["psmux_outdated", "error", "dashboard.terminalRuntime.psmuxOutdated"],
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
      getTerminalRuntimeRemediation("native_psmux"),
      getTerminalRuntimeRemediation("wsl_required"),
      getTerminalRuntimeRemediation("tmux_missing"),
      getTerminalRuntimeRemediation("psmux_missing"),
      getTerminalRuntimeRemediation("psmux_outdated"),
      getTerminalRuntimeRemediation("future-mode"),
    ]);

    expect(serialized).not.toMatch(/FORGEBADGER|JWT|Bearer |attach token|sk-/i);
  });
});

describe("TerminalRuntimeStatus", () => {
  it("accepts both tmux and psmux persistence contracts", () => {
    expectTypeOf<TerminalRuntimeStatus["persistence"]>().toEqualTypeOf<"tmux" | "psmux">();

    const psmuxRuntime = {
      persistence: "psmux",
      mode: "native_psmux",
      supported: true,
      message: "psmux 3.3.8",
    } satisfies TerminalRuntimeStatus;
    const legacyWslRuntime = {
      persistence: "tmux",
      mode: "wsl_required",
      supported: false,
      message: "legacy Gateway response",
    } satisfies TerminalRuntimeStatus;

    expect(psmuxRuntime.mode).toBe("native_psmux");
    expect(legacyWslRuntime.mode).toBe("wsl_required");
  });
});
