/**
 * Schedule parsing for Copilot automations, built on croner.
 *
 * Three schedule kinds:
 *   - cron:     a cron expression (5/6/7 fields) in the automation's timezone
 *   - interval: a fixed number of minutes between runs
 *   - once:     a single ISO timestamp
 *
 * Exposes (a) validation used at create/update time and (b) a "next fire after
 * X" computation plus a stable idempotency slot key used by the scheduler. Slot
 * keys are deterministic per (kind, expression, fire time), so the
 * (user, automation, slot) unique index makes duplicate ticks no-ops.
 */
import { Cron } from "croner";

export type ScheduleKind = "cron" | "interval" | "once";

const INTERVAL_MIN_MINUTES = 5;

/** Validate a schedule expression; throws a descriptive Error when invalid. */
export function validateSchedule(kind: ScheduleKind, expression: string, timezone: string): void {
  if (kind === "cron") {
    new Cron(expression, { timezone });
    return;
  }
  if (kind === "interval") {
    const minutes = Number(expression);
    if (!Number.isFinite(minutes) || minutes < INTERVAL_MIN_MINUTES) {
      throw new Error(`Interval must be at least ${INTERVAL_MIN_MINUTES} minutes`);
    }
    return;
  }
  if (kind === "once") {
    const date = new Date(expression);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid once timestamp");
    return;
  }
  throw new Error(`Unknown schedule kind: ${kind}`);
}

/** Next fire strictly after `after`, or undefined when the schedule is exhausted (once). */
export function nextFireAfter(kind: ScheduleKind, expression: string, timezone: string, after: Date): Date | undefined {
  if (kind === "cron") {
    return new Cron(expression, { timezone }).nextRun(after) ?? undefined;
  }
  if (kind === "interval") {
    const minutes = Number(expression);
    return new Date(after.getTime() + minutes * 60_000);
  }
  if (kind === "once") {
    const fire = new Date(expression);
    return fire.getTime() > after.getTime() ? fire : undefined;
  }
  throw new Error(`Unknown schedule kind: ${kind}`);
}

/** Deterministic idempotency key for a concrete fire time. */
export function slotKey(kind: ScheduleKind, expression: string, fire: Date): string {
  if (kind === "once") return `once:${expression}`;
  return `${kind}:${expression}:${Math.floor(fire.getTime() / 1_000)}`;
}

export function formatScheduleSummary(kind: ScheduleKind, expression: string): string {
  if (kind === "cron") return `cron ${expression}`;
  if (kind === "interval") return `every ${expression} minutes`;
  return `once ${expression}`;
}
