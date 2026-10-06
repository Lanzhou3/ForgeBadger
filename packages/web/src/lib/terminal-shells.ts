import type { TerminalShell } from "@/lib/api";

/**
 * Preferred shell order per platform. The first *installed* shell in this
 * order is the dialog default, so a Windows box without PowerShell 7 falls
 * back to Windows PowerShell 5.1 (always present) instead of failing on the
 * pwsh probe.
 */
export function platformShellOrder(isWindows: boolean): TerminalShell[] {
  return isWindows ? ["pwsh", "powershell", "cmd"] : ["sh", "bash", "zsh"];
}

/**
 * Static default before availability is known. POSIX default is "sh", which
 * the gateway resolves to the user's $SHELL (zsh on modern macOS, bash on
 * most Linux) instead of forcing one binary.
 */
export function defaultTerminalShellForPlatform(isWindows: boolean): TerminalShell {
  return platformShellOrder(isWindows)[0] ?? "sh";
}

/**
 * Keep the current selection while it is installed; otherwise fall back to
 * the first installed shell in platform order. No-op while availability is
 * still unknown (null) so the dialog stays usable if the probe fails.
 */
export function pickAvailableShell(
  current: TerminalShell,
  order: readonly TerminalShell[],
  installed: readonly TerminalShell[] | null
): TerminalShell {
  if (!installed || installed.length === 0) return current;
  const available = new Set(installed);
  if (available.has(current)) return current;
  return order.find((candidate) => available.has(candidate)) ?? installed[0] ?? current;
}
