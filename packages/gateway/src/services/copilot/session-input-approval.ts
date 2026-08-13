import { z } from "zod";

import type { CopilotPendingAction } from "../../db/repositories/copilot-repository.js";
import { SessionRepository, type Session } from "../../db/repositories/session-repository.js";
import type { Database } from "../../db/types.js";
import type { InMemorySessionManager } from "../session-manager.js";
import { redactCopilotText } from "./redaction.js";

export const copilotSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  input: z.string().max(8_000),
  submit: z.boolean().default(true)
}).strict().superRefine((value, context) => {
  if (value.input.length === 0 && !value.submit) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["input"],
      message: "Empty terminal input is valid only when submitting Enter"
    });
  }
});
const defaultTrackingDelaysMs = [1_500, 2_500, 4_000, 6_000];

export async function executeCopilotSessionInput(
  action: CopilotPendingAction,
  options: {
    db: Database;
    userId: string;
    sessionManager?: Pick<InMemorySessionManager, "sendInput" | "captureHistory">;
    trackingDelaysMs?: number[];
  }
): Promise<Record<string, unknown>> {
  // Both HTTP and Feishu approvals call this executor so terminal semantics cannot drift.
  const parsed = copilotSessionInputSchema.safeParse(action.input);
  if (!parsed.success) return approvalError("copilot_session_input_invalid", "Copilot session input payload is invalid");
  const session = new SessionRepository(options.db, options.userId).getById(parsed.data.sessionId);
  if (!session || session.status !== "running" || !session.tmuxSession) {
    return approvalError("copilot_session_input_invalid", "Copilot session input target is not a running terminal session");
  }
  if (!options.sessionManager) {
    return approvalError("copilot_session_input_unavailable", "Copilot terminal input is not available");
  }
  const shouldSubmit = parsed.data.submit !== false;
  const delays = options.trackingDelaysMs ?? defaultTrackingDelaysMs;
  const before = shouldSubmit && delays.length ? await capture(options, session) : null;
  const data = buildInput(parsed.data.input, shouldSubmit);
  await options.sessionManager.sendInput(session.id, data);
  new SessionRepository(options.db, options.userId).update(session.id, { lastActive: new Date() });
  const terminal = shouldSubmit
    ? await track(options, session, before?.text, delays)
    : await capture(options, session);
  return {
    sessionId: session.id,
    submitted: shouldSubmit,
    bytes: Buffer.byteLength(data, "utf8"),
    terminal
  };
}

async function track(
  options: Parameters<typeof executeCopilotSessionInput>[1],
  session: Session,
  previousText: string | undefined,
  delays: number[]
): Promise<Record<string, unknown>> {
  // Tracking is bounded and observational; input submission is already complete at this point.
  let latest = await capture(options, session);
  let latestText = latest.text ?? "";
  let changed = latest.available && (previousText === undefined || latestText !== previousText);
  let samples = 1;
  if (!delays.length) return { ...latest, tracking: { status: changed ? "changed" : "single_sample", samples } };
  for (const delayMs of delays) {
    await sleep(delayMs);
    const next = await capture(options, session);
    samples += 1;
    const nextText = next.text ?? "";
    const nextChanged = next.available && (previousText === undefined || nextText !== previousText);
    if (changed && next.available && nextText === latestText) {
      return { ...next, tracking: { status: "stable", samples, waitedMs: sumDelays(delays, samples - 1) } };
    }
    if (next.available) {
      latest = next;
      latestText = nextText;
      changed = changed || nextChanged;
    }
  }
  return {
    ...latest,
    tracking: { status: changed ? "changed_timeout" : "unchanged_timeout", samples, waitedMs: sumDelays(delays, delays.length) }
  };
}

async function capture(
  options: Parameters<typeof executeCopilotSessionInput>[1],
  session: Session
): Promise<{ available: boolean; text?: string; truncated?: boolean; reason?: string }> {
  if (!options.sessionManager?.captureHistory) return { available: false, reason: "terminal_history_unavailable" };
  try {
    const redacted = redactCopilotText(stripTerminalControlSequences(await options.sessionManager.captureHistory(session.id)));
    const truncated = redacted.length > 4_000;
    return { available: true, text: truncated ? redacted.slice(-4_000) : redacted, truncated };
  } catch {
    return { available: false, reason: "terminal_history_capture_failed" };
  }
}

function buildInput(input: string, submit: boolean): string {
  return !submit || input.endsWith("\n") || input.endsWith("\r") ? input : `${input}\n`;
}

function approvalError(code: string, message: string): Record<string, unknown> {
  return { error: { code, message } };
}

function stripTerminalControlSequences(text: string): string {
  return text
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/gu, "")
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)?[A-Za-z]/gu, "")
    .replace(/(^|\s)(?:\d{1,3};)*\d{1,3}m(?=\s|$)/gu, "$1")
    .replace(/\r/gu, "");
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function sumDelays(delays: number[], count: number): number {
  return delays.slice(0, count).reduce((total, delay) => total + delay, 0);
}
