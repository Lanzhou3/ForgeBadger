/**
 * File logger for the standalone Session Server process.
 *
 * The daemon runs detached with stdio fully ignored (a piped stdout would
 * EPIPE-crash it once the spawning Gateway exits), so its diagnostics are
 * appended to `<stateDir>/logs/session-server.log` instead.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

export function resolveSessionServerLogPath(stateDir: string): string {
  return join(stateDir, "logs", "session-server.log");
}

/** Redirect console.info/warn/error to the daemon log file. Best-effort:
 *  if the log file cannot be opened, the default console stays in place. */
export function initSessionServerFileLogger(stateDir: string): void {
  try {
    mkdirSync(join(stateDir, "logs"), { recursive: true });
    const stream = createWriteStream(resolveSessionServerLogPath(stateDir), { flags: "a" });
    const write = (level: string, args: unknown[]) => {
      stream.write(`${new Date().toISOString()} [${level}] ${format(...args)}\n`);
    };
    console.info = (...args: unknown[]) => write("info", args);
    console.warn = (...args: unknown[]) => write("warn", args);
    console.error = (...args: unknown[]) => write("error", args);
  } catch {
    // Logging must never take the daemon down.
  }
}
