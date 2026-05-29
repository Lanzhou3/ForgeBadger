import type { TranslationKey } from "@/lib/i18n";

export type TerminalRuntimeRemediationSeverity = "healthy" | "warning" | "error";

export interface TerminalRuntimeRemediation {
  detailKey: TranslationKey;
  actionKey: TranslationKey;
  href: string;
  severity: TerminalRuntimeRemediationSeverity;
}

export function terminalRuntimeTranslationKey(mode: string | undefined): TranslationKey {
  switch (mode) {
    case "native_tmux":
      return "dashboard.terminalRuntime.native";
    case "wsl_required":
      return "dashboard.terminalRuntime.wslRequired";
    case "tmux_missing":
      return "dashboard.terminalRuntime.tmuxMissing";
    default:
      return "dashboard.dependenciesHealthDescription";
  }
}

export function getTerminalRuntimeRemediation(mode: string | undefined): TerminalRuntimeRemediation {
  switch (mode) {
    case "native_tmux":
      return {
        detailKey: "dashboard.terminalRuntime.native",
        actionKey: "dashboard.runtimeRemediation.openSettings",
        href: "/settings",
        severity: "healthy",
      };
    case "wsl_required":
      return {
        detailKey: "dashboard.terminalRuntime.wslRequired",
        actionKey: "dashboard.runtimeRemediation.openSettings",
        href: "/settings",
        severity: "error",
      };
    case "tmux_missing":
      return {
        detailKey: "dashboard.terminalRuntime.tmuxMissing",
        actionKey: "dashboard.runtimeRemediation.openSettings",
        href: "/settings",
        severity: "error",
      };
    default:
      return {
        detailKey: "dashboard.dependenciesHealthUnavailable",
        actionKey: "dashboard.runtimeRemediation.openSettings",
        href: "/settings",
        severity: "warning",
      };
  }
}
