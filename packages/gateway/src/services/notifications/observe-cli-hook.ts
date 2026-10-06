import type { Database } from '../../db/types.js';
import type { Session } from '../../db/repositories/session-repository.js';
import { nativePromptIdentity } from '../../db/repositories/session-notification-prompt-repository.js';
import { CliObservationRepository } from '../../db/repositories/cli-observation-repository.js';
import { cliText, directCliFields, toolObservation, type CliSummary } from './cli-observation.js';

/** Synchronous, bounded direct-field enrichment BEFORE emitEvent. No filesystem
 * reads or waits; optional enrichment failure never suppresses lifecycle. */
export function observeCliHook(db: Database, session: Session, event: Record<string, unknown>, adapter: string): CliSummary | undefined {
  if (event.agent_id !== undefined && event.agent_id !== null && event.agent_id !== '') return;
  const hook = event.hook_event_name;
  if (!['UserPromptSubmit', 'TurnStarted', 'TaskStarted', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'Notification', 'PermissionRequest'].includes(String(hook))) return;
  const records = new CliObservationRepository(db, session.userId);
  const epoch = records.runtime(session.id, session.attachToken);
  if (!epoch) return;
  const native = nativePromptIdentity(event.session_id, event.turn_id);
  const exact = Boolean(native?.turnId);
  const prior = exact ? records.find(session.id, epoch, native!.sessionId, native!.turnId!) : undefined;
  // Late tool/request events cannot rewrite the terminal summary of this round.
  if (prior?.endedAt) return ['Stop', 'StopFailure'].includes(String(hook)) ? prior : undefined;
  const now = Date.now();
  const summary: CliSummary = { version: 1, runtimeEpoch: epoch, identityQuality: exact ? 'exact_turn' : native ? 'session_only' : 'unknown',
    ...(native ? { nativeSessionId: native.sessionId, ...(native.turnId ? { turnId: native.turnId } : {}) } : {}),
    state: 'working', observedAt: now, progress: [], verification: [], ...prior };
  summary.observedAt = now;
  if (['UserPromptSubmit', 'TurnStarted', 'TaskStarted'].includes(String(hook))) {
    summary.startedAt ??= now;
    const prompt = cliText(event.prompt, 160, true);
    if (prompt && exact) summary.request = prompt;
  } else if (['PostToolUse', 'PostToolUseFailure'].includes(String(hook))) {
    if (!exact) return; // no evidence association without a causal round
    const detail = toolObservation(event);
    summary.progress = [...summary.progress, ...detail.progress].filter((p, i, all) => all.findIndex(other => other.text === p.text) === i).slice(-3);
  } else {
    summary.state = hook === 'Stop' ? 'task_completed' : hook === 'StopFailure' ? 'task_failed'
      : hook === 'PermissionRequest' ? 'permission_prompt' : cliText(event.notification_type, 80) || 'attention';
    Object.assign(summary, directCliFields(adapter, event));
    if (['Stop', 'StopFailure'].includes(String(hook))) summary.endedAt = now;
    // Remove literal echoed request paragraphs without altering the result facts.
    if (summary.result && summary.request) {
      summary.result.text = summary.result.text.split('\n').filter(line => line.trim() !== summary.request).join('\n').trim();
      if (!summary.result.text) delete summary.result;
    }
  }
  records.save(session.id, summary, !prior && ['UserPromptSubmit', 'TurnStarted', 'TaskStarted'].includes(String(hook)));
  return summary;
}
