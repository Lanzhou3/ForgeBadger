import { z } from 'zod';
import { redactAgentText } from '../agent/redaction.js';
import { adapterIds } from '../../lib/adapter-ids.js';

export const cliAdapterLabels: Record<typeof adapterIds[number], string> = {
  claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi Code', opencode: 'OpenCode', pi: 'PI', mcode: 'MiniMax Code',
};
const excerpt = (max: number) => z.object({ text: z.string().max(max * 2),
  source: z.enum(['native_final_message', 'native_tool_event', 'native_error', 'managed_verification']) });
export const cliSummarySchema = z.object({
  version: z.literal(1), runtimeEpoch: z.string().max(128),
  identityQuality: z.enum(['exact_turn', 'session_only', 'unknown']),
  nativeSessionId: z.string().max(128).optional(), turnId: z.string().max(128).optional(),
  state: z.string().max(80), observedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().optional(), endedAt: z.number().int().nonnegative().optional(),
  request: z.string().max(320).optional(), result: excerpt(600).optional(), error: excerpt(400).optional(),
  errorCategory: z.enum(['authentication', 'rate_limit', 'network', 'permission', 'context_limit', 'execution']).optional(),
  progress: z.array(excerpt(160)).max(3).default([]), verification: z.array(excerpt(160)).max(3).default([]),
  nextAction: excerpt(200).optional(),
});
export type CliSummary = z.infer<typeof cliSummarySchema>;

/** Redact the complete field BEFORE truncation; Unicode code points count once. */
export function cliText(value: unknown, max: number, singleLine = false): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  const safe = redactAgentText(normalized).trim();
  const chars = Array.from(singleLine ? safe.replace(/\s+/g, ' ') : safe);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}
export function readCliSummary(value: unknown): CliSummary | undefined {
  const parsed = cliSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export function cliError(event: Record<string, unknown>): Pick<CliSummary, 'error' | 'errorCategory'> {
  const detail = cliText(event.error_message, 400) || cliText(event.error_details, 400)
    || cliText(event.error, 400) || cliText(event.reason, 400);
  const type = typeof event.error_type === 'string' ? event.error_type : typeof event.error === 'string' ? event.error : '';
  const combined = `${type} ${detail}`;
  if (!combined.trim()) return {};
  const errorCategory: CliSummary['errorCategory'] = /auth|api.?key|401|unauthor/i.test(combined) ? 'authentication'
    : /rate.?limit|429|quota/i.test(combined) ? 'rate_limit' : /network|timeout|connect/i.test(combined) ? 'network'
    : /permission|denied|403/i.test(combined) ? 'permission' : /context|token.?limit/i.test(combined) ? 'context_limit' : 'execution';
  return { errorCategory, ...(detail ? { error: { text: detail, source: 'native_error' as const } } : {}) };
}

/** No transcript paths, reasoning, stdout or guessed test counts are retained. */
export function directCliFields(adapter: string, event: Record<string, unknown>): Partial<CliSummary> {
  const failure = event.hook_event_name === 'StopFailure';
  const result = ['claude', 'codex', 'opencode', 'pi'].includes(adapter) && event.hook_event_name === 'Stop'
    ? cliText(event.last_assistant_message, 600) : '';
  return { ...(result ? { result: { text: result, source: 'native_final_message' as const } } : {}),
    ...(failure ? cliError(event) : {}) };
}

export function toolObservation(event: Record<string, unknown>): Pick<CliSummary, 'progress' | 'verification'> {
  const name = cliText(event.tool_name, 80, true);
  if (!name) return { progress: [], verification: [] };
  const failed = event.hook_event_name === 'PostToolUseFailure';
  // A tool event proves only that this tool ran. Unknown response shapes never
  // become passing tests or whole-turn failure. Command receipts require a
  // separately validated adapter contract before enabling verification.
  return { progress: [{ text: `${failed ? '工具报告失败' : '工具已返回'}：${name}`, source: 'native_tool_event' }], verification: [] };
}
