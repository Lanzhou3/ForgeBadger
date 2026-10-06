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
// The Gateway has no foreground window. An owned, topmost dialog stays visible
// over the browser; otherwise Windows can open it behind the web console.
const WINDOWS_DIRECTORY_PICKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$owner = $null",
  "$dialog = $null",
  "try {",
  "  Add-Type -AssemblyName System.Windows.Forms",
  "  [System.Windows.Forms.Application]::EnableVisualStyles()",
  "  $owner = New-Object System.Windows.Forms.Form",
  "  $owner.TopMost = $true",
  "  $owner.ShowInTaskbar = $false",
  "  $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
  "  $owner.Width = 1",
  "  $owner.Height = 1",
  "  $owner.Opacity = 0",
  "  $owner.Show()",
  "  $owner.Activate()",
  "  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "  $dialog.Description = 'Select a project directory'",
  "  $dialog.ShowNewFolderButton = $true",
  "  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {",
  "    [Console]::WriteLine($dialog.SelectedPath)",
  "  }",
  "} catch {",
  "  [Console]::Error.WriteLine($_.Exception.Message)",
  "  exit 1",
  "} finally {",
  "  if ($null -ne $dialog) { $dialog.Dispose() }",
  "  if ($null -ne $owner) { $owner.Dispose() }",
  "}"
].join("\n");

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
  // PowerShell's encoded-command contract is UTF-16LE, independent of the
  // Windows command-line quoting rules and console code page.
  const encodedScript = Buffer.from(WINDOWS_DIRECTORY_PICKER_SCRIPT, "utf16le").toString("base64");

  const result = await runner(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodedScript],
    { timeoutMs: DIRECTORY_PICKER_TIMEOUT_MS }
  );
  return windowsResultToStatus(result);
}

function windowsResultToStatus(result: CommandResult): DirectoryPickerStatus {
  if (result.exitCode === 124) {
    throw new Error("Directory selection timed out. Please try again or enter the directory path manually.");
  }
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim() || "Please enter the directory path manually.";
    throw new Error(`Could not open the directory picker. ${reason}`);
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
