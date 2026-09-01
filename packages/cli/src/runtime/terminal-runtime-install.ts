import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";

import {
  checkCliTerminalRuntime,
  runCommand,
  type CliCommandResult,
  type CliCommandRunner,
  type CliTerminalRuntimeStatus
} from "./dependency-check.js";

export interface CliTerminalRuntimeInstallPlan {
  runtime: "tmux" | "psmux";
  command: string;
  args: string[];
  displayCommand: string;
}

export interface ConfirmInstallRequest {
  runtime: "tmux" | "psmux";
  command: string;
  defaultValue: false;
}

export type CliTerminalRuntimeInstallStatus =
  | "ready"
  | "declined"
  | "non_tty"
  | "install_failed"
  | "restart_required"
  | "installer_unavailable";

export interface CliTerminalRuntimeInstallResult {
  status: CliTerminalRuntimeInstallStatus;
  runtime: CliTerminalRuntimeStatus;
  installCommand?: string;
  message?: string;
}

export interface EnsureCliTerminalRuntimeOptions {
  platform?: NodeJS.Platform;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  dependencyRunner?: CliCommandRunner;
  getUid?: () => number | undefined;
  confirmInstall?: (request: ConfirmInstallRequest) => Promise<boolean>;
  installRunner?: (
    command: string,
    args: string[],
    options: { shell: false }
  ) => Promise<CliCommandResult>;
}

export type LinuxPackageManager = "apt-get" | "dnf" | "yum" | "pacman" | "zypper" | "apk";

const LINUX_PACKAGE_MANAGER_ORDER: readonly LinuxPackageManager[] = [
  "apt-get",
  "dnf",
  "yum",
  "pacman",
  "zypper",
  "apk"
];

const INSTALL_PLANS: Partial<Record<NodeJS.Platform, CliTerminalRuntimeInstallPlan>> = {
  win32: {
    runtime: "psmux",
    command: "winget",
    args: ["install", "--id", "marlocarlo.psmux", "--exact", "--source", "winget"],
    displayCommand: "winget install --id marlocarlo.psmux --exact --source winget"
  },
  darwin: {
    runtime: "tmux",
    command: "brew",
    args: ["install", "tmux"],
    displayCommand: "brew install tmux"
  }
};

const PSMUX_UPGRADE_PLAN: CliTerminalRuntimeInstallPlan = {
  runtime: "psmux",
  command: "winget",
  args: ["upgrade", "--id", "marlocarlo.psmux", "--exact", "--source", "winget"],
  displayCommand: "winget upgrade --id marlocarlo.psmux --exact --source winget"
};

export function resolveCliTerminalRuntimeInstallPlan(
  platform: NodeJS.Platform = process.platform,
  linuxPackageManager?: LinuxPackageManager,
  operation: "install" | "upgrade" = "install",
  useSudo = true
): CliTerminalRuntimeInstallPlan | undefined {
  if (platform === "win32" && operation === "upgrade") {
    return cloneInstallPlan(PSMUX_UPGRADE_PLAN);
  }
  if (platform === "linux") {
    return linuxPackageManager
      ? createLinuxInstallPlan(linuxPackageManager, useSudo)
      : undefined;
  }
  const plan = INSTALL_PLANS[platform];
  return plan ? cloneInstallPlan(plan) : undefined;
}

export async function ensureCliTerminalRuntime(
  options: EnsureCliTerminalRuntimeOptions = {}
): Promise<CliTerminalRuntimeInstallResult> {
  const platform = options.platform ?? process.platform;
  const dependencyRunner = options.dependencyRunner ?? runCommand;
  const runtime = await checkCliTerminalRuntime({ platform, runner: dependencyRunner });
  if (runtime.supported) {
    return { status: "ready", runtime };
  }

  const resolution = await resolveInstallPlan(
    platform,
    runtime,
    dependencyRunner,
    options.getUid ?? (() => process.getuid?.())
  );
  if (!resolution.plan) {
    return {
      status: "installer_unavailable",
      runtime,
      message: resolution.message
    };
  }
  const plan = resolution.plan;
  const installCommand = plan.displayCommand;
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? process.stdin.isTTY === true;
  if (!isTTY || isCiEnvironment(env)) {
    return { status: "non_tty", runtime, installCommand };
  }

  const confirmInstall = options.confirmInstall ?? confirmTerminalRuntimeInstall;
  const accepted = await confirmInstall({
    runtime: plan.runtime,
    command: installCommand,
    defaultValue: false
  });
  if (!accepted) {
    return { status: "declined", runtime, installCommand };
  }

  const installRunner = options.installRunner ?? runInstallerCommand;
  const installResult = await installRunner(plan.command, [...plan.args], { shell: false });
  if (installResult.exitCode !== 0) {
    const detail = installResult.stderr.trim()
      || installResult.stdout.trim()
      || `installer exited with ${installResult.exitCode}`;
    return {
      status: "install_failed",
      runtime,
      installCommand,
      message: `Terminal runtime installation failed: ${detail}`
    };
  }

  const recheckedRuntime = await checkCliTerminalRuntime({ platform, runner: dependencyRunner });
  if (!recheckedRuntime.supported) {
    return {
      status: "restart_required",
      runtime: recheckedRuntime,
      installCommand,
      message: "Installation completed, but the runtime is not on PATH yet. Restart this terminal and retry."
    };
  }

  return { status: "ready", runtime: recheckedRuntime };
}

async function resolveInstallPlan(
  platform: NodeJS.Platform,
  runtime: CliTerminalRuntimeStatus,
  runner: CliCommandRunner,
  getUid: () => number | undefined
): Promise<{ plan?: CliTerminalRuntimeInstallPlan; message: string }> {
  if (platform === "win32") {
    return {
      plan: requireInstallPlan(resolveCliTerminalRuntimeInstallPlan(
        platform,
        undefined,
        runtime.mode === "psmux_outdated" ? "upgrade" : "install"
      )),
      message: "Install psmux with WinGet, then run `forgebadger doctor`."
    };
  }
  if (platform === "darwin") {
    const brewAvailable = await isCommandAvailable("brew", runner);
    return brewAvailable
      ? { plan: requireInstallPlan(resolveCliTerminalRuntimeInstallPlan(platform)), message: "" }
      : {
        message: "Homebrew was not found. Install Homebrew first, then run `brew install tmux`, or install tmux manually."
      };
  }
  if (platform !== "linux") {
    return {
      message: "Install the platform terminal multiplexer manually, then run `forgebadger doctor`."
    };
  }
  const manager = await detectLinuxPackageManager(runner);
  if (!manager) {
    return { message: "Install tmux manually with your system package manager, then run `forgebadger doctor`." };
  }
  if (getUid() === 0) {
    return {
      plan: requireInstallPlan(resolveCliTerminalRuntimeInstallPlan(platform, manager, "install", false)),
      message: ""
    };
  }
  if (!(await isCommandAvailable("sudo", runner))) {
    const rootPlan = requireInstallPlan(
      resolveCliTerminalRuntimeInstallPlan(platform, manager, "install", false)
    );
    return {
      message: `sudo is unavailable. Run as root and execute \`${rootPlan.displayCommand}\`, or install tmux manually.`
    };
  }
  return {
    plan: requireInstallPlan(resolveCliTerminalRuntimeInstallPlan(platform, manager)),
    message: ""
  };
}

function requireInstallPlan(
  plan: CliTerminalRuntimeInstallPlan | undefined
): CliTerminalRuntimeInstallPlan {
  if (!plan) throw new Error("No allowlisted terminal runtime install plan");
  return plan;
}

async function detectLinuxPackageManager(
  runner: CliCommandRunner
): Promise<LinuxPackageManager | undefined> {
  for (const manager of LINUX_PACKAGE_MANAGER_ORDER) {
    try {
      const result = await runner(manager, ["--version"]);
      if (result.exitCode === 0) return manager;
    } catch {
      // Continue through the fixed allowlist; no arbitrary command is derived from host output.
    }
  }
  return undefined;
}

async function isCommandAvailable(command: string, runner: CliCommandRunner): Promise<boolean> {
  try {
    return (await runner(command, ["--version"])).exitCode === 0;
  } catch {
    return false;
  }
}

function createLinuxInstallPlan(
  manager: LinuxPackageManager,
  useSudo: boolean
): CliTerminalRuntimeInstallPlan {
  const argsByManager: Record<LinuxPackageManager, string[]> = {
    "apt-get": ["apt-get", "install", "-y", "tmux"],
    dnf: ["dnf", "install", "-y", "tmux"],
    yum: ["yum", "install", "-y", "tmux"],
    pacman: ["pacman", "-S", "--noconfirm", "tmux"],
    zypper: ["zypper", "--non-interactive", "install", "tmux"],
    apk: ["apk", "add", "tmux"]
  };
  const managerArgs = argsByManager[manager];
  const command = useSudo ? "sudo" : manager;
  const args = useSudo ? managerArgs : managerArgs.slice(1);
  return {
    runtime: "tmux",
    command,
    args: [...args],
    displayCommand: `${command} ${args.join(" ")}`
  };
}

function cloneInstallPlan(plan: CliTerminalRuntimeInstallPlan): CliTerminalRuntimeInstallPlan {
  return { ...plan, args: [...plan.args] };
}

async function confirmTerminalRuntimeInstall(request: ConfirmInstallRequest): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await readline.question(
      `${request.runtime} is required for persistent terminals. Run \`${request.command}\`? [y/N] `
    );
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

async function runInstallerCommand(
  command: string,
  args: string[],
  _options: { shell: false }
): Promise<CliCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: "inherit" });
    child.once("error", (error) => {
      resolve({ exitCode: 127, stdout: "", stderr: error.message });
    });
    child.once("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout: "", stderr: "" });
    });
  });
}

function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}
