import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/types.js';
import { SessionRepository, type Session } from '../db/repositories/session-repository.js';
import { ProjectRepository } from '../db/repositories/project-repository.js';
import type { InMemorySessionManager } from './session-manager.js';
import type { CommandContext } from './platform-commands/types.js';
import { PlatformNoEffectError } from './platform-commands/errors.js';
import { redactAgentText } from './agent/redaction.js';

export const stopSessionInput = z.object({ sessionId: z.string().min(1).max(128),
  observationId: z.string().uuid().optional(), expectedTitle: z.string().min(1).max(240).optional() }).strict();
export const copilotStopSessionInput = stopSessionInput.required();
const targetSchema = z.object({ observationId: z.string().uuid(), sessionId: z.string(), projectId: z.string(),
  projectName: z.string(), sessionName: z.string(), taskTitle: z.string(),
  titleSource: z.enum(['terminal_footer', 'last_prompt', 'session_name']),
  runtimeRevision: z.string(), observedAt: z.number(), terminalExcerpt: z.string(),
  executionScope: z.enum(['session_process_group', 'external_runtime_unverified']) });
export type SessionStopTarget = z.infer<typeof targetSchema>;
const OBSERVATION_TTL_MS = 15 * 60_000;

/** A process-group receipt cannot prove that a shared Codex daemon stopped. */
export function sessionExecutionScope(session: Session, manager?: InMemorySessionManager): SessionStopTarget['executionScope'] {
  if (session.aiTool !== 'codex') return 'session_process_group';
  const live = manager?.getSession(session.id);
  const args = live?.launchPlan.args ?? [];
  const separator = args.indexOf('--');
  return live?.userId === session.userId && live.runtimeSessionName === session.runtimeSessionName
    && args.slice(0, separator < 0 ? args.length : separator).includes('--no-daemon')
    ? 'session_process_group' : 'external_runtime_unverified';
}

/** Volatile activity timestamps are deliberately excluded; secrets only enter the hash. */
export function sessionRuntimeRevision(session: Session, manager?: InMemorySessionManager): string {
  const live = manager?.getSession(session.id);
  return createHash('sha256').update(JSON.stringify([session.id, session.userId, session.projectId,
    session.aiTool, session.name, session.runtimeSessionName, session.attachToken,
    live?.createdAt, live?.attachToken, live?.launchPlan.command, live?.launchPlan.args])).digest('hex');
}

export function observedTaskTitle(session: Session, output: string): Pick<SessionStopTarget, 'taskTitle' | 'titleSource'> {
  // Codex's status footer is evidence, never an instruction or a native-thread identifier.
  // Require the cwd column, so ordinary prose containing middle dots is not a title.
  if (session.aiTool === 'codex') {
    for (const line of output.split('\n').reverse()) {
      const columns = line.trim().split(/\s+·\s+/u);
      if (columns.length < 3 || !/^(?:~\/|\/|[A-Za-z]:[\\/])/u.test(columns[1]!)) continue;
      const title = cleanLabel(columns[2]!);
      if (title) return { taskTitle: title, titleSource: 'terminal_footer' };
    }
  }
  return session.lastPrompt?.trim()
    ? { taskTitle: cleanLabel(session.lastPrompt), titleSource: 'last_prompt' }
    : { taskTitle: cleanLabel(session.name), titleSource: 'session_name' };
}
function cleanLabel(value: string): string { return redactAgentText(value).replace(/[\x00-\x1f\x7f]/gu, ' ').trim().slice(0, 240); }

export function createSessionStopTarget(db: Database, session: Session, manager: InMemorySessionManager,
  observationId: unknown, output: string): SessionStopTarget | undefined {
  if (!z.string().uuid().safeParse(observationId).success) return undefined;
  return { observationId: observationId as string, sessionId: session.id, projectId: session.projectId,
    projectName: new ProjectRepository(db, session.userId).getById(session.projectId)?.name ?? '',
    sessionName: session.name, ...observedTaskTitle(session, output), observedAt: Date.now(),
    runtimeRevision: sessionRuntimeRevision(session, manager),
    terminalExcerpt: redactAgentText(output).slice(-1600), executionScope: sessionExecutionScope(session, manager) };
}

interface ObservationRow { input_json: string; result_json: string; completed_at: number; conversation_id: string }
/** The model supplies a reference, never the identity displayed on the approval card. */
export function resolveSessionStopTarget(ctx: CommandContext, input: z.infer<typeof stopSessionInput>): SessionStopTarget | undefined {
  if (!input.observationId || !input.expectedTitle) {
    if (ctx.actionOrigin?.kind === 'copilot' || input.observationId || input.expectedTitle)
      throw new PlatformNoEffectError('SESSION_STOP_OBSERVATION_REQUIRED: Read get_session_output and use its target before stopping.');
    return undefined; // Direct owner terminal controls remain compatible.
  }
  const row = ctx.db.prepare(`SELECT s.input_json,s.result_json,s.completed_at,r.conversation_id
    FROM copilot_run_steps s JOIN copilot_runs r ON r.id=s.run_id AND r.user_id=s.user_id
    WHERE s.user_id=? AND s.id=? AND s.tool_name='get_session_output' AND s.status='completed'`)
    .get(ctx.userId, input.observationId) as ObservationRow | undefined;
  if (!row || !row.completed_at || row.completed_at + OBSERVATION_TTL_MS < Date.now()) throw stale();
  if (ctx.actionOrigin?.kind === 'copilot') {
    const run = ctx.db.prepare('SELECT conversation_id FROM copilot_runs WHERE user_id=? AND id=?')
      .get(ctx.userId, ctx.actionOrigin.runId) as { conversation_id: string } | undefined;
    if (!run || run.conversation_id !== row.conversation_id) throw stale();
  }
  let result: { live?: boolean; sessionId?: string; target?: unknown }; let observedInput: { sessionId?: string };
  try { result = JSON.parse(row.result_json); observedInput = JSON.parse(row.input_json); } catch { throw stale(); }
  const parsed = targetSchema.safeParse(result?.target);
  if (!parsed.success || result.live !== true) throw stale();
  const target = parsed.data;
  if (target.observationId !== input.observationId || observedInput?.sessionId !== input.sessionId
    || result.sessionId !== input.sessionId || target.sessionId !== input.sessionId || target.taskTitle !== input.expectedTitle)
    throw new PlatformNoEffectError('SESSION_STOP_TARGET_MISMATCH: Session ID, observation and task title must refer to the same target. Read again; do not substitute another ID.');
  const session = new SessionRepository(ctx.db, ctx.userId).getById(input.sessionId);
  if (!session || target.projectId !== session.projectId || target.runtimeRevision !== sessionRuntimeRevision(session, ctx.sessionManager)
    || target.observedAt + OBSERVATION_TTL_MS < Date.now()) throw stale();
  if (sessionExecutionScope(session, ctx.sessionManager) === 'external_runtime_unverified')
    throw new PlatformNoEffectError('SESSION_EXECUTION_SCOPE_UNVERIFIED: This legacy Codex terminal may use a shared daemon. Copilot cannot stop its task safely. Close the task in its original CLI; owner terminal stop only closes the terminal and may leave the task running.');
  return target;
}

export async function assertSessionStopTargetLive(ctx: CommandContext, input: z.infer<typeof stopSessionInput>): Promise<void> {
  const target = resolveSessionStopTarget(ctx, input);
  if (!target) return;
  const snapshot = await ctx.sessionManager?.captureScreen(ctx.userId, input.sessionId);
  const session = new SessionRepository(ctx.db, ctx.userId).getById(input.sessionId);
  resolveSessionStopTarget(ctx, input); // A restart may have raced the screen read.
  if (!snapshot?.live || !session || observedTaskTitle(session, snapshot.output).taskTitle !== target.taskTitle) throw stale();
}
function stale(): PlatformNoEffectError { return new PlatformNoEffectError('SESSION_STOP_TARGET_STALE: Target changed or observation expired. Read get_session_output again and request a new approval.'); }
