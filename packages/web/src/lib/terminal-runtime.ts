import type { TranslationKey } from "@/lib/i18n";

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
