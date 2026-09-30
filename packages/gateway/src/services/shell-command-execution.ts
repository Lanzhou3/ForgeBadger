/**
 * Shell command execution for Copilot: run a shell command in a terminal
 * (PTY) session on the Session Server backend and capture its exit code +
 * output.
 *
 * Two modes:
 * - `runShellCommand`: one short-lived session per command (Phase 1).
 * - `runShellCommandInSession`: run inside a long-lived "Copilot shell"
 *   session opened via `openCopilotShell` (Phase 2), retaining cwd/env and
 *   package-manager state across commands.
 *
 * Both modes hold a `SessionWriterLeases` workspace lease for the duration
 * of the command so the browser terminal for the same project goes
 * read-only with a "take over" button. If the owner takes over mid-command
 * (fence goes stale), the command is aborted with SHELL_COMMAND_USER_TAKEOVER
 * — the human always wins. In persistent mode the shell itself stays alive
 * so the owner can retry the command later.
 */
import { randomUUID } from "node:crypto";
import type { Database } from "../db/types.js";
import type { InMemorySessionManager } from "./session-manager.js";
import {
  createTerminalLaunchPlan,
  defaultTerminalShell,
  type TerminalShell
} from "./session-launch-plan.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";

export interface RunShellCommandInput {
  db: Database;
  userId: string;
  sessionManager: InMemorySessionManager;
  /** Project root the command runs in (path-based access check target). */
  projectRoot: string;
  command: string;
  timeoutMs?: number;
  /** Optional progress sink called ~every 2s with the new output tail. */
  onProgress?: (tail: string) => void | undefined;
}

export interface RunShellCommandInSessionInput extends Omit<RunShellCommandInput, "projectRoot"> {
  /** Existing persistent Copilot shell session to run in. */
  sessionId: string;
  /** The session's project id (validated against the session row). */
  projectId: string;
}

export interface ShellCommandResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  /** True when the owner took over the terminal and the command was aborted. */
  userTookOver: boolean;
  sessionId?: string | undefined;
}

export const SHELL_COMMAND_MAX_LENGTH = 4000;
export const SHELL_COMMAND_DEFAULT_TIMEOUT_MS = 300_000;
export const SHELL_COMMAND_MAX_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 250;
const STAGE_SETTLE_MS = 150;
const PROGRESS_INTERVAL_MS = 2000;
const OUTPUT_TAIL_CHARS = 2000;
/** Display name of the per-project persistent Copilot shell (no DB column;
 *  matched by name prefix so user-created terminal sessions stay private). */
export const COPILOT_SHELL_NAME = "Copilot shell";

/** Sessions with a command currently in flight (no concurrent writes). */
const inFlightCommands = new Map<string, string>();

/**
 * Execute a shell command in a temporary terminal session and return its
 * exit code + captured output. Throws on validation failures (command too
 * long, bad timeout, project access denied). A timeout returns
 * `{ timedOut: true, exitCode: null }` after killing the session.
 */
export async function runShellCommand(input: RunShellCommandInput): Promise<ShellCommandResult> {
  const command = validateCommand(input.command);
  const timeoutMs = validateTimeout(input.timeoutMs);
  const shell: TerminalShell = defaultTerminalShell();
  const sessionId = randomUUID();
  const launchPlan = createTerminalLaunchPlan({ projectRoot: input.projectRoot, sessionId, shell });

  // createSession runs assertManagedSessionAccess (path-based check) internally.
  const session = await input.sessionManager.createSession({
    userId: input.userId,
    sessionId,
    launchPlan,
    attachToken: randomUUID()
  });

  let result: ShellCommandResult;
  try {
    result = await executeCommandInTerminalSession({
      sessionManager: input.sessionManager,
      userId: input.userId,
      sessionId,
      workspace: input.projectRoot,
      command,
      sentinelStyle: shell,
      timeoutMs,
      ...(input.onProgress ? { onProgress: input.onProgress } : {})
    });
  } catch (error) {
    // The temporary session must never outlive the call, even on error.
    await safeStop(input.sessionManager, sessionId, session.runtimeSessionName);
    throw error;
  }
  await safeStop(input.sessionManager, sessionId, session.runtimeSessionName);
  return { ...result, sessionId };
}

/**
 * Execute a shell command inside an existing persistent Copilot shell.
 * The session must be terminal-kind, a Copilot shell (see COPILOT_SHELL_NAME),
 * and belong to `projectId`. The shell is left running after the command.
 */
export async function runShellCommandInSession(
  input: RunShellCommandInSessionInput
): Promise<ShellCommandResult> {
  const command = validateCommand(input.command);
  const timeoutMs = validateTimeout(input.timeoutMs);
  const session = assertCopilotShellSession(input.db, input.userId, input.sessionId);
  if (session.projectId !== input.projectId) {
    throw new Error("SHELL_SESSION_PROJECT_MISMATCH");
  }
  const shell = sentinelStyleForCommand(
    input.sessionManager.getSession(input.sessionId)?.launchPlan.command ?? ""
  );

  const result = await executeCommandInTerminalSession({
    sessionManager: input.sessionManager,
    userId: input.userId,
    sessionId: input.sessionId,
    workspace: session.workingDir,
    command,
    sentinelStyle: shell,
    timeoutMs,
    ...(input.onProgress ? { onProgress: input.onProgress } : {})
  });
  return { ...result, sessionId: input.sessionId };
}

interface CoreExecuteInput {
  sessionManager: InMemorySessionManager;
  userId: string;
  sessionId: string;
  workspace: string;
  command: string;
  /** Shell dialect used for the sentinel's exit-code expression. */
  sentinelStyle: TerminalShell;
  timeoutMs: number;
  onProgress?: (tail: string) => void | undefined;
}

async function executeCommandInTerminalSession(
  input: CoreExecuteInput
): Promise<ShellCommandResult> {
  if (inFlightCommands.has(input.sessionId)) {
    throw new Error("SHELL_COMMAND_IN_FLIGHT: another command is already running in this shell");
  }
  inFlightCommands.set(input.sessionId, input.command);

  // Acquire the workspace writer lease so the browser terminal goes read-only.
  let lease = input.sessionManager.acquireWriterLease({
    userId: input.userId,
    sessionId: input.sessionId,
    workspace: input.workspace
  });
  try {
    // Readiness: "pane alive + no in-flight command" (the in-flight check
    // above) — the persistent-shell replacement for the CLI composer check.
    const live = await input.sessionManager.hasLiveTerminal(input.sessionId);
    if (!live) {
      throw new Error("SHELL_SESSION_DEAD: the shell session has exited; reopen it");
    }

    const nonce = randomUUID().replace(/-/g, "").slice(0, 16);
    const sentinel = `__FB_DONE_${nonce}`;
    // The shell evaluates both lines; the sentinel is the last thing printed
    // so we can slice everything before it as output.
    const payload = `${input.command}\n${sentinelCommand(input.sentinelStyle, sentinel)}\n`;

    await input.sessionManager.stageProgrammaticInput(input.sessionId, payload);
    await sleep(STAGE_SETTLE_MS);
    await input.sessionManager.pressEnter(input.sessionId);

    const deadline = Date.now() + input.timeoutMs;
    let lastProgressAt = 0;
    for (;;) {
      // Renew (long commands outlive the 30s lease TTL) and check that the
      // owner hasn't taken over (fence staleness) — the human wins.
      lease = input.sessionManager.renewWriterLease(lease);
      input.sessionManager.assertWriterLeaseCurrent(lease);
      const pane = await input.sessionManager.captureHistory(input.sessionId);
      const stripped = stripAnsi(pane);
      if (stripped.includes(sentinel)) {
        const { output, exitCode } = sliceCommandOutput(stripped, sentinel, input.command);
        return { exitCode, output: output.slice(-OUTPUT_TAIL_CHARS * 4), timedOut: false, userTookOver: false };
      }
      const now = Date.now();
      if (now >= deadline) {
        break;
      }
      if (input.onProgress && now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        const { output } = sliceCommandOutput(
          stripped + "\n" + sentinel + ":PENDING",
          sentinel,
          input.command
        );
        input.onProgress(output.slice(-OUTPUT_TAIL_CHARS));
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { exitCode: null, output: "", timedOut: true, userTookOver: false };
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_WRITER_FENCE_STALE") {
      return { exitCode: null, output: "", timedOut: false, userTookOver: true };
    }
    throw error;
  } finally {
    inFlightCommands.delete(input.sessionId);
    input.sessionManager.releaseWriterLease(lease);
  }
}

function validateCommand(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) throw new Error("SHELL_COMMAND_EMPTY");
  if (trimmed.length > SHELL_COMMAND_MAX_LENGTH) {
    throw new Error(`SHELL_COMMAND_TOO_LONG: max ${SHELL_COMMAND_MAX_LENGTH} chars`);
  }
  return trimmed;
}

function validateTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? SHELL_COMMAND_DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("SHELL_COMMAND_INVALID_TIMEOUT");
  if (value > SHELL_COMMAND_MAX_TIMEOUT_MS) {
    throw new Error(`SHELL_COMMAND_TIMEOUT_EXCEEDS_MAX: max ${SHELL_COMMAND_MAX_TIMEOUT_MS}ms`);
  }
  return value;
}

/** Sentinel dialect derived from the session's shell binary. */
function sentinelStyleForCommand(command: string): TerminalShell {
  const base = command.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (base === "cmd.exe" || base === "cmd") return "cmd";
  if (process.platform === "win32") return "pwsh";
  return "sh";
}

function sentinelCommand(shell: TerminalShell, sentinel: string): string {
  switch (shell) {
    case "cmd":
      return `echo ${sentinel}:%ERRORLEVEL%`;
    case "pwsh":
    case "powershell":
      // PowerShell 5.1 and 7 share $LASTEXITCODE semantics.
      return `Write-Output ${sentinel}:$LASTEXITCODE`;
    case "bash":
    case "zsh":
    case "sh":
      return `echo ${sentinel}:$?`;
  }
}

/** Prior sentinel lines (this or earlier commands) and the command echo. */
const PRIOR_SENTINEL_LINE = /__FB_DONE_[a-f0-9]{16}:\S*[^\n]*\r?\n/g;

/**
 * Slice the output produced by one command out of the rendered pane.
 *
 * Interactive shells echo the typed command; persistent shells accumulate
 * earlier commands' sentinels in the scrollback. We therefore start the
 * output after the later of (a) the last prior sentinel line and (b) the
 * last echo of this command's first line, then end at the current sentinel.
 */
function sliceCommandOutput(
  pane: string,
  sentinel: string,
  command: string
): { output: string; exitCode: number | null } {
  const idx = pane.indexOf(sentinel);
  if (idx < 0) return { output: pane, exitCode: null };
  const before = pane.slice(0, idx);

  let start = 0;
  PRIOR_SENTINEL_LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PRIOR_SENTINEL_LINE.exec(before)) !== null) {
    start = match.index + match[0].length;
  }
  const firstLine = command.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length > 0) {
    const echoIdx = before.lastIndexOf(firstLine, idx);
    if (echoIdx >= start) {
      start = echoIdx + firstLine.length;
    }
  }
  let output = before.slice(start).replace(/^\r?\n/, "").trimEnd();

  const after = pane.slice(idx);
  const lineEnd = after.indexOf("\n");
  const sentinelLine = lineEnd < 0 ? after : after.slice(0, lineEnd);
  const colonIdx = sentinelLine.indexOf(":");
  let exitCode: number | null = null;
  if (colonIdx >= 0) {
    const parsed = parseInt(sentinelLine.slice(colonIdx + 1).trim(), 10);
    if (Number.isFinite(parsed)) exitCode = parsed;
  }
  return { output, exitCode };
}

// ---------------------------------------------------------------------------
// Persistent Copilot shell lifecycle
// ---------------------------------------------------------------------------

/**
 * Open (or reuse) the project's persistent Copilot shell. One per project:
 * a live existing Copilot shell is returned as-is; a stale row (exited or
 * lost after a daemon restart) is cleaned up and replaced.
 */
export async function openCopilotShell(
  db: Database,
  userId: string,
  sessionManager: InMemorySessionManager,
  project: { id: string; path: string }
): Promise<{ sessionId: string; reused: boolean }> {
  const repo = new SessionRepository(db, userId);
  const existing = repo
    .listByProject(project.id)
    .find((s) => s.aiTool === "terminal" && s.name === COPILOT_SHELL_NAME);

  if (existing) {
    const live = await sessionManager.hasLiveTerminal(existing.id, existing.runtimeSessionName ?? undefined);
    if (live) {
      return { sessionId: existing.id, reused: true };
    }
    // Stale row: mark it exited and fall through to a fresh shell.
    repo.updateStatus(existing.id, "exited");
  }

  const dbSession = repo.create({
    projectId: project.id,
    name: COPILOT_SHELL_NAME,
    aiTool: "terminal",
    workingDir: project.path,
    credentialMode: "host_environment"
  });
  const attachToken = randomUUID();
  repo.update(dbSession.id, { attachToken });
  const session = await sessionManager.createSession({
    userId,
    sessionId: dbSession.id,
    launchPlan: createTerminalLaunchPlan({ projectRoot: project.path, sessionId: dbSession.id }),
    attachToken
  });
  repo.update(dbSession.id, {
    status: "running",
    attachToken: session.attachToken,
    runtimeSessionName: session.runtimeSessionName,
    lastActive: new Date()
  });
  return { sessionId: dbSession.id, reused: false };
}

/** Stop a persistent Copilot shell session and mark its row exited. */
export async function closeCopilotShell(
  db: Database,
  userId: string,
  sessionManager: InMemorySessionManager,
  session: Session
): Promise<void> {
  const live = await sessionManager.hasLiveTerminal(session.id, session.runtimeSessionName ?? undefined);
  if (live) {
    await safeStop(sessionManager, session.id, session.runtimeSessionName ?? "");
  }
  new SessionRepository(db, userId).updateStatus(session.id, "exited");
}

/**
 * Resolve a session id to a persistent Copilot shell session owned by the
 * user. Terminal sessions created by the user from the console are NOT
 * Copilot shells and are rejected — Copilot only ever drives its own shells.
 */
export function assertCopilotShellSession(
  db: Database,
  userId: string,
  sessionId: string
): Session {
  const session = new SessionRepository(db, userId).getById(sessionId);
  if (!session) throw new Error("SHELL_SESSION_NOT_FOUND");
  if (session.aiTool !== "terminal" || session.name !== COPILOT_SHELL_NAME) {
    throw new Error("SHELL_SESSION_NOT_COPILOT_SHELL");
  }
  return session;
}

async function safeStop(
  manager: InMemorySessionManager,
  sessionId: string,
  runtimeName: string
): Promise<void> {
  try {
    await manager.stopSession(sessionId, runtimeName);
  } catch {
    // Best-effort cleanup; the session is temporary or already gone.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip ANSI escape sequences (CSI, OSC, etc.) for sentinel matching. */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r/g, "");
}
