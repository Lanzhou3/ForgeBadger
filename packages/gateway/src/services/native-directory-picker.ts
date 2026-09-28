import { runCommand, type CommandResult } from "../lib/dependency-check.js";

export type DirectoryPickerStatus =
  | { supported: true; path: string; cancelled: false }
  | { supported: true; path?: undefined; cancelled: true }
  | { supported: false; reason?: string };

export interface NativeDirectoryPickerDeps {
  platform?: NodeJS.Platform;
  runner?: (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<CommandResult>;
}

const DIRECTORY_PICKER_TIMEOUT_MS = 120_000;

export function directoryPickerSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" || platform === "darwin";
}

/**
 * Opens the host OS directory-selection dialog and returns the real absolute
 * path. The browser cannot surface a real filesystem path (it masks paths as
 * `C:\fakepath\...`), so the Gateway -- which runs on the same machine as the
 * web console -- drives the native picker instead.
 *
 * - win32: PowerShell + FolderBrowserDialog (Windows Explorer-style picker)
 * - darwin: osascript `choose folder` (Finder-style picker)
 * - linux: unsupported; the web console keeps the manual path input.
 */
export async function selectNativeDirectory(
  deps: NativeDirectoryPickerDeps = {}
): Promise<DirectoryPickerStatus> {
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") return selectWindowsDirectory(deps);
  if (platform === "darwin") return selectMacDirectory(deps);
  return { supported: false, reason: "Native directory picking is not supported on this platform." };
}

async function selectWindowsDirectory(deps: NativeDirectoryPickerDeps): Promise<DirectoryPickerStatus> {
  const runner = deps.runner ?? runCommand;
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select a project directory'",
    "$dialog.ShowNewFolderButton = $true",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Output $dialog.SelectedPath",
    "}"
  ].join("; ");

  const result = await runner(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
    { timeoutMs: DIRECTORY_PICKER_TIMEOUT_MS }
  );
  return windowsResultToStatus(result);
}

function windowsResultToStatus(result: CommandResult): DirectoryPickerStatus {
  if (result.exitCode !== 0) {
    return { supported: true, cancelled: true };
  }
  const path = result.stdout.trim();
  if (path.length === 0) {
    return { supported: true, cancelled: true };
  }
  return { supported: true, path, cancelled: false };
}

async function selectMacDirectory(deps: NativeDirectoryPickerDeps): Promise<DirectoryPickerStatus> {
  const runner = deps.runner ?? runCommand;
  const result = await runner(
    "osascript",
    ["-e", 'POSIX path of (choose folder with prompt "Select a project directory")'],
    { timeoutMs: DIRECTORY_PICKER_TIMEOUT_MS }
  );
  if (result.exitCode !== 0) {
    return { supported: true, cancelled: true };
  }
  const raw = result.stdout.trim();
  if (raw.length === 0) {
    return { supported: true, cancelled: true };
  }
  const path = raw === "/" ? raw : raw.replace(/\/+$/u, "");
  return { supported: true, path, cancelled: false };
}
