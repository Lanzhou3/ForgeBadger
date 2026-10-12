import type { Database } from '../../db/types.js';
import type { RunRecord, TurnInput } from './run-ledger.js';

/**
 * Shared derivation of run authorization facts. Every consumer of run identity
 * (input_json parsing), parent-chain traversal, or owner-message authorization
 * routes through these primitives so the derivation exists exactly once; call
 * sites keep their own error identity, ordering, and check frequency.
 */
export const PARENT_CHAIN_MAX_DEPTH = 8;

/** A ninth ancestry level would be entered; scope assertions fail closed on it. */
export class ParentChainDepthError extends Error {
  constructor() { super('Run parent chain exceeds depth cap'); this.name = 'ParentChainDepthError'; }
}

export function parseRunInput(row: { input_json: string }): TurnInput {
  return JSON.parse(row.input_json) as TurnInput;
}

/**
 * Iterative parent walk (nearest first), channel-run-scope's depth-8 cap. A
 * missing parent row ends the walk silently — callers that require the parent
 * detect the truncation via the last yielded input's parentRunId and throw
 * their own scope error.
 */
export function* runAncestry(db: Database, userId: string, start: TurnInput): Generator<TurnInput> {
  let current: TurnInput | undefined = start;
  for (let depth = 0; current; depth += 1) {
    if (depth >= PARENT_CHAIN_MAX_DEPTH) throw new ParentChainDepthError();
    yield current;
    if (!current.parentRunId) return;
    const row = db.prepare('SELECT input_json FROM copilot_runs WHERE user_id=? AND id=?').get(userId, current.parentRunId) as { input_json: string } | undefined;
    if (!row) return;
    current = parseRunInput(row);
  }
}

export interface RunFacts {
  run: RunRecord;
  input: TurnInput;
  /** Ancestry inputs nearest-first; truncated past the depth cap (scope
   * assertions use runAncestry directly so an over-deep chain fails closed). */
  parentChain: TurnInput[];
}

/** One run-row query, one input parse, and the (capped) ancestry projection. */
export function loadRunFacts(db: Database, userId: string, runId: string): RunFacts | undefined {
  const run = db.prepare('SELECT * FROM copilot_runs WHERE user_id=? AND id=?').get(userId, runId) as RunRecord | undefined;
  if (!run) return undefined;
  const input = parseRunInput(run);
  const parentChain: TurnInput[] = [];
  try {
    for (const ancestor of runAncestry(db, userId, input)) if (ancestor !== input) parentChain.push(ancestor);
  } catch (error) {
    if (!(error instanceof ParentChainDepthError)) throw error;
  }
  return { run, input, parentChain };
}

/**
 * The owner authorization match behind user-originated runs: the exact user
 * text must exist as an active-conversation user message of this run (or the
 * edited message it replaced). Call sites throw their own error on `false`.
 */
export function hasUserMessageAuthorization(db: Database, userId: string, conversationId: string,
  userText: string, runId: string, editMessageId?: string): boolean {
  return !!db.prepare(`SELECT m.id FROM copilot_messages m
    JOIN copilot_conversations c ON c.id=m.conversation_id AND c.user_id=m.user_id
    WHERE m.user_id=? AND m.conversation_id=? AND c.status='active' AND m.role='user' AND m.kind='text'
      AND m.content=? AND (m.run_id=? OR m.id=?) LIMIT 1`)
    .get(userId, conversationId, userText, runId, editMessageId ?? null);
}
