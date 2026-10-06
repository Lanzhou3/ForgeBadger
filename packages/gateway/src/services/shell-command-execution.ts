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
 * (fence goes stale), monitoring ends and control transfers to the owner.
 * In persistent mode the shell and any running command stay alive.
 * A timeout confirms shell shutdown before reporting completion; reopening starts fresh.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "../db/types.js";
import type { InMemorySessionManager, WriterLeaseHandle } from "./session-manager.js";
import {
  createTerminalLaunchPlan,
  resolveAvailableTerminalShell,
  type TerminalShell
} from "./session-launch-plan.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";

export interface RunShellCommandInput {
  db: Database;
  userId: string;
  projectId: string;
  sessionManager: InMemorySessionManager;
  /** Project root the command runs in (path-based access check target). */
  projectRoot: string;
  command: string;
  signal?: AbortSignal | undefined;
  authorize?: (() => void) | undefined;
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
  /** True when control transferred to the owner; the command may still be running. */
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
  input.signal?.throwIfAborted();
  input.authorize?.();
  const command = validateCommand(input.command);
  const timeoutMs = validateTimeout(input.timeoutMs);
  const repo = new SessionRepository(input.db, input.userId);
  await assertNoUnconfirmedShell(repo, input.projectId, input.sessionManager);
  const shell = await resolveAvailableTerminalShell();
  const row = repo.create({ projectId: input.projectId, name: "Copilot command", aiTool: "terminal",
    workingDir: input.projectRoot, credentialMode: "host_environment" });
  const sessionId = row.id;
  let runtimeName = "";
  let transferred = false;
  let commandStarted = false;
  let creationLease: WriterLeaseHandle | undefined;
  try {
    creationLease = input.sessionManager.acquireWriterLease({ userId: input.userId, sessionId, workspace: input.projectRoot });
    input.signal?.throwIfAborted();
    input.authorize?.();
    const session = await input.sessionManager.createSession({
      userId: input.userId, sessionId,
      launchPlan: createCopilotShellLaunchPlan(input.projectRoot, sessionId, shell),
      attachToken: randomUUID()
    });
    runtimeName = session.runtimeSessionName;
    repo.update(sessionId, { status: "running", runtimeSessionName: runtimeName, attachToken: session.attachToken });
    commandStarted = true;
    const result = await executeCommandInTerminalSession({
      db: input.db, sessionManager: input.sessionManager, userId: input.userId,
      sessionId, workspace: input.projectRoot, command, sentinelStyle: shell, timeoutMs,
      signal: input.signal, authorize: input.authorize,
      initialLease: creationLease, stopAfterExecution: true,
      ...(input.onProgress ? { onProgress: input.onProgress } : {})
    });
    transferred = result.userTookOver;
    return { ...result, sessionId };
  } finally {
    runtimeName ||= input.sessionManager.getSession(sessionId)?.runtimeSessionName ?? "";
    if (!commandStarted && creationLease) {
      try {
        if (runtimeName) await stopAndConfirm(input.db, input.userId, input.sessionManager, sessionId, runtimeName, creationLease);
      } catch (error) {
        if (error instanceof Error && error.message === 'SESSION_WRITER_FENCE_STALE') transferred = true;
        else throw error;
      } finally { input.sessionManager.releaseWriterLease(creationLease); }
    }
    if (!transferred) {
      if (!runtimeName || !await input.sessionManager.hasRuntimeTerminal(runtimeName)) repo.delete(sessionId);
    }
  }
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
    db: input.db,
    sessionManager: input.sessionManager,
    userId: input.userId,
    sessionId: input.sessionId,
    workspace: session.workingDir,
    command,
    sentinelStyle: shell,
    timeoutMs,
    signal: input.signal, authorize: input.authorize,
    ...(input.onProgress ? { onProgress: input.onProgress } : {})
  });
  return { ...result, sessionId: input.sessionId };
}

interface CoreExecuteInput {
  initialLease?: WriterLeaseHandle;
  stopAfterExecution?: boolean;
  signal?: AbortSignal | undefined;
  authorize?: (() => void) | undefined;
  db: Database;
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

  let lease: WriterLeaseHandle | undefined;
  let cleanupConfirmed = true;
  let latestOutput = "";
  let scriptDir: string | undefined;
  let submissionStarted = false;
  try {
    // Acquisition can fail; the in-flight entry must still be cleared.
    lease = input.initialLease ?? input.sessionManager.acquireWriterLease({
      userId: input.userId, sessionId: input.sessionId, workspace: input.workspace
    });
    const checkpoint = () => {
      input.sessionManager.assertWriterLeaseCurrent(lease!);
      input.signal?.throwIfAborted();
      input.authorize?.();
    };
    checkpoint();
    // Readiness: "pane alive + no in-flight command" (the in-flight check
    // above) — the persistent-shell replacement for the CLI composer check.
    const live = await input.sessionManager.hasLiveTerminal(input.sessionId);
    checkpoint();
    if (!live) {
      throw new Error("SHELL_SESSION_DEAD: the shell session has exited; reopen it");
    }

    const nonce = randomUUID().replace(/-/g, "").slice(0, 16);
    const sentinel = `__FB_DONE_${nonce}`;
    const start = `__FB_START_${nonce}`;
    let payload: string;
    if (["sh", "bash", "zsh"].includes(input.sentinelStyle)) {
      // Canonical-mode shells have small line buffers. Keep the staged line
      // bounded; source a private script to retain cwd and environment state.
      scriptDir = await mkdtemp(join(tmpdir(), "fb-shell-command-"));
      const scriptPath = join(scriptDir, "command.sh");
      await writeFile(scriptPath, input.command + "\n", { mode: 0o600 });
      const quotedPath = "'" + scriptPath.replace(/'/g, "'\"'\"'") + "'";
      payload = `printf '\\n${start}\\n'; . ${quotedPath}; printf '\\n${sentinel}:%s\\n' "$?"`;
    } else {
      payload = commandPayload(input.sentinelStyle, input.command, start, sentinel);
    }
    if (["sh", "bash", "zsh"].includes(input.sentinelStyle)) {
      // Older bash/readline versions do not understand bracketed-paste frames.
      await input.sessionManager.stageShellCommand(input.sessionId, payload);
    } else {
      await input.sessionManager.stageProgrammaticInput(input.sessionId, payload);
    }
    await sleep(STAGE_SETTLE_MS);
    checkpoint();
    submissionStarted = true;
    await input.sessionManager.pressEnter(input.sessionId);

    const deadline = Date.now() + input.timeoutMs;
    let lastProgressAt = 0;
    let progressSinkFailed = false;
    for (;;) {
      // Renew (long commands outlive the 30s lease TTL) and check that the
      // owner hasn't taken over (fence staleness) — the human wins.
      lease = input.sessionManager.renewWriterLease(lease);
      input.sessionManager.assertWriterLeaseCurrent(lease);
      checkpoint();
      const pane = await input.sessionManager.captureHistory(input.sessionId);
      checkpoint();
      const stripped = stripAnsi(pane);
      const { output, exitCode } = sliceCommandOutput(stripped, sentinel, start);
      latestOutput = output.slice(-OUTPUT_TAIL_CHARS * 4);
      if (exitCode !== null) {
        if (input.stopAfterExecution) {
          cleanupConfirmed = false;
          const runtimeName = resolveRuntimeNameForCleanup(input);
          await stopAndConfirm(input.db, input.userId, input.sessionManager, input.sessionId, runtimeName, lease);
          cleanupConfirmed = true;
        }
        return { exitCode, output: output.slice(-OUTPUT_TAIL_CHARS * 4), timedOut: false, userTookOver: false };
      }
      const now = Date.now();
      if (now >= deadline) {
        break;
      }
      if (input.onProgress && now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        try {
          input.onProgress(output.slice(-OUTPUT_TAIL_CHARS));
        } catch {
          // Telemetry must never take down the shell: log a whitelisted code
          // once per command and keep polling.
          if (!progressSinkFailed) {
            progressSinkFailed = true;
            console.warn("[shell-command-execution] progress sink failed; continuing command", { code: "SHELL_PROGRESS_SINK_FAILED" });
          }
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }
    const runtimeName = resolveRuntimeNameForCleanup(input);
    cleanupConfirmed = false;
    await stopAndConfirm(input.db, input.userId, input.sessionManager, input.sessionId, runtimeName, lease);
    cleanupConfirmed = true;
    return { exitCode: null, output: latestOutput, timedOut: true, userTookOver: false };
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_WRITER_FENCE_STALE") {
      return { exitCode: null, output: latestOutput, timedOut: false, userTookOver: true };
    }
    if ((submissionStarted || (input.stopAfterExecution && lease)) && cleanupConfirmed) {
      cleanupConfirmed = false;
      const runtimeName = input.sessionManager.getSession(input.sessionId)?.runtimeSessionName
        ?? new SessionRepository(input.db, input.userId).getById(input.sessionId)?.runtimeSessionName ?? "";
      try { await stopAndConfirm(input.db, input.userId, input.sessionManager, input.sessionId, runtimeName, lease); }
      catch (stopError) {
        if (stopError instanceof Error && stopError.message === 'SESSION_WRITER_FENCE_STALE') {
          cleanupConfirmed = true;
          return { exitCode: null, output: latestOutput, timedOut: false, userTookOver: true };
        }
        throw stopError;
      }
      cleanupConfirmed = true;
    }
    throw error;
  } finally {
    try {
      if (scriptDir) await rm(scriptDir, { recursive: true, force: true });
    } finally {
      if (cleanupConfirmed) {
        inFlightCommands.delete(input.sessionId);
        if (lease) input.sessionManager.releaseWriterLease(lease);
      }
    }
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
  if (/^(pwsh|powershell)(\.exe)?$/.test(base)) return "pwsh";
  return "sh";
}

/** Copilot shells must not pause for interactive profile prompts. */
function createCopilotShellLaunchPlan(projectRoot: string, sessionId: string, shell: TerminalShell) {
  const plan = createTerminalLaunchPlan({ projectRoot, sessionId, shell });
  if (shell === "bash") plan.args = ["--noprofile", "--norc"];
  if (shell === "zsh") plan.args = ["-f"];
  if (shell === "pwsh" || shell === "powershell") plan.args = ["-NoLogo", "-NoProfile"];
  if (shell === "cmd") plan.args = ["/D"];
  return plan;
}

function commandPayload(shell: TerminalShell, command: string, start: string, sentinel: string): string {
  if (shell === "cmd") {
    return `echo ${start}\n${command}\necho ${sentinel}:%ERRORLEVEL%\n`;
  }
  if (shell === "pwsh" || shell === "powershell") {
    // Reset native exit status so a builtin cannot inherit an earlier failure.
    return `Write-Output '${start}'\n$global:LASTEXITCODE = 0\n${command}\n$__fb_ok = $?; $__fb_code = if ($__fb_ok) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }; Write-Output ''; Write-Output ("${sentinel}:" + $__fb_code)\n`;
  }
  throw new Error("SHELL_DIALECT_UNSUPPORTED");
}

/** Only an entire numeric completion line is a result; input echoes are not. */
function sliceCommandOutput(pane: string, sentinel: string, start: string): { output: string; exitCode: number | null } {
  const done = new RegExp(`(?:^|\\n)${sentinel}:(-?\\d+)(?=\\n|$)`).exec(pane);
  const before = done ? pane.slice(0, done.index) : pane;
  const begin = new RegExp(`(?:^|\\n)${start}\\n`).exec(before);
  const output = begin ? before.slice(begin.index + begin[0].length) : before;
  return { output: output.trimEnd(), exitCode: done ? Number(done[1]) : null };
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
  await assertNoUnconfirmedShell(repo, project.id, sessionManager);
  const candidates = repo.listByProject(project.id)
    .filter(s => s.aiTool === "terminal" && s.name === COPILOT_SHELL_NAME).reverse();
  for (const existing of candidates) {
    const live = await sessionManager.hasLiveTerminal(existing.id, existing.runtimeSessionName ?? undefined);
    if (live) return { sessionId: existing.id, reused: true };
    repo.updateStatus(existing.id, "exited");
  }
  const shell = await resolveAvailableTerminalShell();

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
    launchPlan: createCopilotShellLaunchPlan(project.path, dbSession.id, shell),
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
    await stopAndConfirm(db, userId, sessionManager, session.id, session.runtimeSessionName ?? sessionManager.getSession(session.id)?.runtimeSessionName ?? "");
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
  if (session.errorMessage === "SHELL_SESSION_STOP_UNCONFIRMED") throw new Error(session.errorMessage);
  if (session.aiTool !== "terminal" || session.name !== COPILOT_SHELL_NAME) {
    throw new Error("SHELL_SESSION_NOT_COPILOT_SHELL");
  }
  return session;
}

/**
 * Runtime name for cleanup paths. The in-memory entry can vanish mid-command
 * (status reconcile, concurrent delete), so fall back to the DB row — the
 * same fallback the error path uses.
 */
function resolveRuntimeNameForCleanup(input: CoreExecuteInput): string {
  return input.sessionManager.getSession(input.sessionId)?.runtimeSessionName
    ?? new SessionRepository(input.db, input.userId).getById(input.sessionId)?.runtimeSessionName ?? "";
}

async function stopAndConfirm(db: Database, userId: string, manager: InMemorySessionManager,
  sessionId: string, runtimeName: string, lease?: WriterLeaseHandle): Promise<void> {
  const repo = new SessionRepository(db, userId);
  if (lease) manager.assertWriterLeaseCurrent(lease);
  try {
    try { await manager.stopSession(sessionId, runtimeName, userId, lease); }
    catch (error) {
      if (error instanceof Error && error.message === 'SESSION_WRITER_FENCE_STALE') throw error;
      /* An already-exited process is safe only after the independent probe. */
    }
    if (!runtimeName || await manager.hasRuntimeTerminal(runtimeName)) throw new Error("runtime still alive");
    repo.update(sessionId, { status: "exited", errorMessage: null });
    inFlightCommands.delete(sessionId);
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_WRITER_FENCE_STALE') throw error;
    repo.update(sessionId, { status: "error", errorMessage: "SHELL_SESSION_STOP_UNCONFIRMED", runtimeSessionName: runtimeName });
    throw new Error("SHELL_SESSION_STOP_UNCONFIRMED: shell cleanup could not be confirmed; stop it before retrying");
  }
}

async function assertNoUnconfirmedShell(repo: SessionRepository, projectId: string,
  manager: InMemorySessionManager): Promise<void> {
  for (const row of repo.listByProject(projectId)) {
    if (row.errorMessage !== "SHELL_SESSION_STOP_UNCONFIRMED") continue;
    if (!row.runtimeSessionName || await manager.hasRuntimeTerminal(row.runtimeSessionName)) {
      throw new Error("SHELL_SESSION_STOP_UNCONFIRMED: stop the previous shell before retrying");
    }
    repo.update(row.id, { status: "exited", errorMessage: null });
    inFlightCommands.delete(row.id);
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
