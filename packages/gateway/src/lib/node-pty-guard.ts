/**
 * node-pty 1.1.x on Windows throws "Cannot resize a pty that has already
 * exited" from inside its own event handlers: a resize requested before the
 * ConPTY attach is ready is queued in WindowsTerminal._deferreds and executed
 * on the first data event; if the pty exited in between, the deferred
 * WindowsPtyAgent.resize throws from a code path userland cannot wrap. The
 * pty is dead at that point (the session is already exiting), so the error is
 * benign: log it and keep the Gateway alive instead of letting Node treat it
 * as a fatal uncaughtException. Every other uncaught exception keeps the
 * default fatal behavior (print + exit 1).
 */
const BENIGN_PTY_RESIZE_MESSAGE = "Cannot resize a pty that has already exited";

export function isBenignNodePtyResizeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message !== BENIGN_PTY_RESIZE_MESSAGE) return false;
  return /windowsPtyAgent\.js/.test(error.stack ?? "");
}

export function installNodePtyCrashGuard(): void {
  process.on("uncaughtException", (error: unknown) => {
    if (isBenignNodePtyResizeError(error)) {
      console.error(
        "[gateway] ignoring benign node-pty deferred resize on an exited pty (terminal session already exiting)",
        error
      );
      return;
    }
    console.error("[gateway] fatal uncaught exception", error);
    process.exit(1);
  });
}
