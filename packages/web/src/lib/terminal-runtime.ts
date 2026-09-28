import type { TranslationKey } from "@/lib/i18n";

export type TerminalRuntimeRemediationSeverity = "healthy" | "warning" | "error";

export interface TerminalRuntimeRemediation {
  detailKey: TranslationKey;
  actionKey: TranslationKey;
  href: string;
  severity: TerminalRuntimeRemediationSeverity;
}

export interface TerminalRuntimeSetupCommand {
  labelKey: TranslationKey;
  command: string;
}

export interface TerminalRuntimeSetupLink {
  labelKey: TranslationKey;
  href: string;
}

export interface TerminalRuntimeSetupGuidance {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  commands: TerminalRuntimeSetupCommand[];
  links?: TerminalRuntimeSetupLink[];
  blocked: boolean;
  severity: TerminalRuntimeRemediationSeverity;
}

export function terminalRuntimeTranslationKey(mode: string | undefined): TranslationKey {
  return mode === "ready" ? "dashboard.terminalRuntime.ready" : "dashboard.terminalRuntime.unavailable";
}

export function getTerminalRuntimeSetupGuidance(
  mode: string | undefined,
  supported?: boolean
): TerminalRuntimeSetupGuidance {
  const ready = mode === "ready" && supported === true;
  return {
    titleKey: ready ? "runtimeSetup.readyTitle" : "runtimeSetup.unavailableTitle",
    descriptionKey: ready ? "runtimeSetup.readyDescription" : "runtimeSetup.unavailableDescription",
    commands: [],
    blocked: !ready,
    severity: ready ? "healthy" : mode === "unavailable" ? "error" : "warning",
  };
}

export function getTerminalRuntimeRemediation(mode: string | undefined): TerminalRuntimeRemediation {
  return {
    detailKey: terminalRuntimeTranslationKey(mode),
    actionKey: "dashboard.runtimeRemediation.openSettings",
    href: "/settings",
    severity: mode === "ready" ? "healthy" : mode === "unavailable" ? "error" : "warning",
  };
}
