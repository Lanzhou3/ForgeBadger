/**
 * Terminal tools for the Copilot harness — the "terminal" seam.
 *
 * - `terminal_run` executes a shell command and returns exit code + output.
 *   Without `sessionId` it uses a short-lived session per command; with
 *   `sessionId` (from `terminal_open`) it reuses the project's persistent
 *   Copilot shell, retaining cwd/env across commands.
 * - `terminal_open` opens (or reuses) the per-project persistent shell.
 * - `terminal_close` stops a persistent shell.
 *
 * All three are `operate`-risk tools routed through the platform command
 * catalog (terminal.run / terminal.open / terminal.close, effect: external),
 * so they inherit the project-level `copilot_autonomy` switch, intent/receipt
 * idempotency, and restricted-run gating automatically. While a command
 * runs, the workspace writer lease makes the browser terminal read-only;
 * the owner can take over at any time, which transfers control with
 * userTookOver=true. A persistent command may still be running.
 */
import { z } from "zod";
import type { AgentTool } from "../tool-registry.js";
import { SHELL_COMMAND_MAX_LENGTH, SHELL_COMMAND_MAX_TIMEOUT_MS } from "../../shell-command-execution.js";

const terminalRunInput = z.object({
  projectId: z.string().min(1).max(128),
  command: z.string().min(1).max(SHELL_COMMAND_MAX_LENGTH),
  timeoutMs: z.number().int().min(1).max(SHELL_COMMAND_MAX_TIMEOUT_MS).optional(),
  sessionId: z.string().min(1).max(128).optional()
}).strict();

const terminalOpenInput = z.object({
  projectId: z.string().min(1).max(128)
}).strict();

const terminalCloseInput = z.object({
  sessionId: z.string().min(1).max(128)
}).strict();

export function createTerminalTools(): AgentTool[] {
  return [
    {
      name: "terminal_run",
      description:
        "Execute a shell command in the project's working directory via a terminal session. " +
        "Returns { exitCode, output, timedOut, userTookOver, sessionId }. " +
        "Without sessionId a short-lived session is used per command. " +
        "With sessionId (from terminal_open) the command runs in the persistent shell, " +
        "which keeps cwd/env/package-manager state across commands — prefer it for " +
        "multi-step work (install then build, cd then test). " +
        "Requires project Copilot autonomy to be enabled. " +
        "Avoid commands that block on interactive input; if the user takes over the terminal " +
        "mid-command, userTookOver=true means the command may still be running; do not retry automatically. " +
        "A timeout stops the shell; reopen a persistent shell before continuing. " +
        "Output is redacted and capped; prefer focused commands over long pipelines.",
      risk: "operate",
      requiresApproval: true,
      inputSchema: terminalRunInput,
      async execute() {
        // The actual execution is delegated to the platform command catalog
        // (terminal.run) via executeAgentAction in the tool registry, which
        // applies copilot_autonomy / idempotency / restricted-run gating.
        throw new Error("terminal_run must be dispatched through the platform command catalog");
      }
    },
    {
      name: "terminal_open",
      description:
        "Open (or reuse) the project's persistent Copilot shell session and return { sessionId, reused }. " +
        "One persistent shell per project: it keeps cwd/env/package-manager state across terminal_run calls. " +
        "Pass the returned sessionId to terminal_run. Close it with terminal_close when the work is done.",
      risk: "operate",
      requiresApproval: true,
      inputSchema: terminalOpenInput,
      async execute() {
        throw new Error("terminal_open must be dispatched through the platform command catalog");
      }
    },
    {
      name: "terminal_close",
      description:
        "Stop and close a persistent Copilot shell previously opened with terminal_open. " +
        "Only accepts sessionId values returned by terminal_open.",
      risk: "operate",
      requiresApproval: true,
      inputSchema: terminalCloseInput,
      async execute() {
        throw new Error("terminal_close must be dispatched through the platform command catalog");
      }
    }
  ];
}
