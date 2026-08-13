import { createHash } from "node:crypto";

import { Cron } from "croner";

const minimumIntervalMs = 60_000;
const maximumIntervalMs = 365 * 24 * 60 * 60 * 1_000;

export type AutomationSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; intervalMs: number; anchorAt?: string | undefined }
  | { kind: "cron"; expression: string; timezone: string };

export type NormalizedAutomationSchedule = AutomationSchedule & { nextRunAt: Date };

export type AutomationScope =
  | { type: "project"; projectIds: string[] }
  | { type: "workspace" };

export interface AutomationDeliveryPlan {
  channel: "feishu";
  accountId: string;
  chatId: string;
  threadId?: string | undefined;
}

export interface AutomationDefinition {
  scope: AutomationScope;
  schedule: AutomationSchedule;
  delivery: AutomationDeliveryPlan;
  toolAuthority: string[];
}

export function normalizeAutomationSchedule(
  schedule: AutomationSchedule,
  now = new Date()
): NormalizedAutomationSchedule {
  if (schedule.kind === "at") {
    // Offset-less ISO strings change meaning with the host locale and are unsafe around DST folds.
    if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(schedule.at)) throw new Error("AUTOMATION_AT_TIMEZONE_REQUIRED");
    const at = new Date(schedule.at);
    if (!Number.isFinite(at.getTime()) || at <= now) throw new Error("AUTOMATION_AT_INVALID");
    return { kind: "at", at: at.toISOString(), nextRunAt: at };
  }

  if (schedule.kind === "every") {
    const intervalMs = Math.trunc(schedule.intervalMs);
    if (!Number.isSafeInteger(intervalMs) || intervalMs < minimumIntervalMs || intervalMs > maximumIntervalMs) {
      throw new Error("AUTOMATION_INTERVAL_INVALID");
    }
    const anchor = schedule.anchorAt ? parseAbsoluteTime(schedule.anchorAt) : now;
    const nextRunAt = nextIntervalSlot(anchor, intervalMs, now);
    return { kind: "every", intervalMs, anchorAt: anchor.toISOString(), nextRunAt };
  }

  validateTimezone(schedule.timezone);
  const expression = schedule.expression.trim();
  if (!expression || expression.length > 128) throw new Error("AUTOMATION_CRON_INVALID");
  try {
    const nextRunAt = new Cron(expression, { timezone: schedule.timezone, paused: true }).nextRun(now);
    if (!nextRunAt) throw new Error("AUTOMATION_CRON_NO_FUTURE_RUN");
    return { kind: "cron", expression, timezone: schedule.timezone, nextRunAt };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AUTOMATION_")) throw error;
    throw new Error("AUTOMATION_CRON_INVALID");
  }
}

export function nextAutomationRunAt(
  schedule: AutomationSchedule,
  previousSlot: Date
): Date | null {
  if (schedule.kind === "at") return null;
  if (schedule.kind === "every") return new Date(previousSlot.getTime() + schedule.intervalMs);
  validateTimezone(schedule.timezone);
  return new Cron(schedule.expression, { timezone: schedule.timezone, paused: true }).nextRun(previousSlot);
}

export function automationExecutionId(automationId: string, scheduledSlot: Date | string): string {
  const slot = typeof scheduledSlot === "string" ? new Date(scheduledSlot) : scheduledSlot;
  if (!Number.isFinite(slot.getTime())) throw new Error("AUTOMATION_SLOT_INVALID");
  return createHash("sha256").update(`${automationId}:${slot.toISOString()}`).digest("hex");
}

export function toStoredAutomationSchedule(schedule: NormalizedAutomationSchedule): {
  scheduleKind: string;
  scheduleExpression: string;
  timezone: string;
} {
  if (schedule.kind === "at") {
    return { scheduleKind: "at", scheduleExpression: schedule.at, timezone: "UTC" };
  }
  if (schedule.kind === "every") {
    return {
      scheduleKind: "every",
      scheduleExpression: JSON.stringify({ intervalMs: schedule.intervalMs, anchorAt: schedule.anchorAt }),
      timezone: "UTC"
    };
  }
  return { scheduleKind: "cron", scheduleExpression: schedule.expression, timezone: schedule.timezone };
}

export function fromStoredAutomationSchedule(input: {
  scheduleKind: string;
  scheduleExpression: string;
  timezone: string;
}): AutomationSchedule {
  if (input.scheduleKind === "at") return { kind: "at", at: input.scheduleExpression };
  if (input.scheduleKind === "cron") {
    return { kind: "cron", expression: input.scheduleExpression, timezone: input.timezone };
  }
  if (input.scheduleKind === "every") {
    try {
      const parsed = JSON.parse(input.scheduleExpression) as { intervalMs?: unknown; anchorAt?: unknown };
      if (typeof parsed.intervalMs !== "number") throw new Error("AUTOMATION_INTERVAL_INVALID");
      return {
        kind: "every",
        intervalMs: parsed.intervalMs,
        ...(typeof parsed.anchorAt === "string" ? { anchorAt: parsed.anchorAt } : {})
      };
    } catch {
      throw new Error("AUTOMATION_INTERVAL_INVALID");
    }
  }
  throw new Error("AUTOMATION_SCHEDULE_KIND_INVALID");
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error("AUTOMATION_TIMEZONE_INVALID");
  }
}

function parseAbsoluteTime(value: string): Date {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) throw new Error("AUTOMATION_AT_TIMEZONE_REQUIRED");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("AUTOMATION_AT_INVALID");
  return parsed;
}

function nextIntervalSlot(anchor: Date, intervalMs: number, now: Date): Date {
  if (anchor > now) return anchor;
  const elapsed = now.getTime() - anchor.getTime();
  return new Date(anchor.getTime() + (Math.floor(elapsed / intervalMs) + 1) * intervalMs);
}
