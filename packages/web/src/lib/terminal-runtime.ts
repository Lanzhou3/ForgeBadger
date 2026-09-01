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
  switch (mode) {
    case "native_tmux":
      return "dashboard.terminalRuntime.native";
    case "native_psmux":
      return "dashboard.terminalRuntime.nativePsmux";
    case "wsl_required":
      return "dashboard.terminalRuntime.wslRequired";
    case "tmux_missing":
      return "dashboard.terminalRuntime.tmuxMissing";
    case "psmux_missing":
      return "dashboard.terminalRuntime.psmuxMissing";
    case "psmux_outdated":
      return "dashboard.terminalRuntime.psmuxOutdated";
    default:
      return "dashboard.dependenciesHealthDescription";
  }
}

export function getTerminalRuntimeSetupGuidance(
  mode: string | undefined,
  supported?: boolean
): TerminalRuntimeSetupGuidance {
  if (mode === "native_psmux") {
    return {
      titleKey: "runtimeSetup.readyTitle",
      descriptionKey: "runtimeSetup.psmuxReadyDescription",
      commands: [],
      blocked: false,
      severity: "healthy",
    };
  }

  if (supported === true || mode === "native_tmux") {
    return {
      titleKey: "runtimeSetup.readyTitle",
      descriptionKey: "runtimeSetup.readyDescription",
      commands: [],
      blocked: false,
      severity: "healthy",
    };
  }

  if (mode === "wsl_required") {
    return {
      titleKey: "runtimeSetup.wslRequiredTitle",
      descriptionKey: "runtimeSetup.wslRequiredDescription",
      commands: [
        { labelKey: "runtimeSetup.commandWindows", command: "wsl --install" },
        { labelKey: "runtimeSetup.commandLinux", command: "sudo apt-get install tmux" },
        { labelKey: "runtimeSetup.commandVerify", command: "tmux -V" },
      ],
      blocked: true,
      severity: "error",
    };
  }

  if (mode === "tmux_missing") {
    return {
      titleKey: "runtimeSetup.tmuxMissingTitle",
      descriptionKey: "runtimeSetup.tmuxMissingDescription",
      commands: [
        { labelKey: "runtimeSetup.commandGatewayHost", command: "forgebadger start" },
      ],
      links: [
        {
          labelKey: "runtimeSetup.tmuxOfficialInstallGuide",
          href: "https://github.com/tmux/tmux/wiki/Installing",
        },
      ],
      blocked: true,
      severity: "error",
    };
  }

  if (mode === "psmux_missing") {
    return {
      titleKey: "runtimeSetup.psmuxMissingTitle",
      descriptionKey: "runtimeSetup.psmuxMissingDescription",
      commands: [
        {
          labelKey: "runtimeSetup.commandWindows",
          command: "winget install --id marlocarlo.psmux --exact --source winget",
        },
        { labelKey: "runtimeSetup.commandVerify", command: "psmux -V" },
      ],
      blocked: true,
      severity: "error",
    };
  }

  if (mode === "psmux_outdated") {
    return {
      titleKey: "runtimeSetup.psmuxOutdatedTitle",
      descriptionKey: "runtimeSetup.psmuxOutdatedDescription",
      commands: [
        {
          labelKey: "runtimeSetup.commandWindows",
          command: "winget upgrade --id marlocarlo.psmux --exact --source winget",
        },
        { labelKey: "runtimeSetup.commandVerify", command: "psmux -V" },
      ],
      blocked: true,
      severity: "error",
    };
  }

  return {
    titleKey: "runtimeSetup.unavailableTitle",
    descriptionKey: "runtimeSetup.unavailableDescription",
    commands: [],
    blocked: true,
    severity: "warning",
  };
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
    case "native_psmux":
      return {
        detailKey: "dashboard.terminalRuntime.nativePsmux",
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
    case "psmux_missing":
      return {
        detailKey: "dashboard.terminalRuntime.psmuxMissing",
        actionKey: "dashboard.runtimeRemediation.openSettings",
        href: "/settings",
        severity: "error",
      };
    case "psmux_outdated":
      return {
        detailKey: "dashboard.terminalRuntime.psmuxOutdated",
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
