/**
 * Automation scheduler — the 60s tick that dispatches due automations.
 *
 * One in-process interval drives all users. Each due automation is claimed via
 * its run slot (unique index) so overlapping ticks / processes are idempotent.
 * The timer is `.unref()`d so it never keeps the process alive in tests, and
 * the whole tick is wrapped so a single automation's failure never aborts the
 * rest.
 */
import type { AgentStackDeps } from "../agent/agent-stack.js";
import { AutomationRepository, type Automation } from "./automation-repository.js";
import { nextFireAfter, slotKey } from "./schedule-parser.js";
import { runAutomationTurn } from "./runner.js";

const TICK_MS = 60_000;
const DEFAULT_LEASE_MS = 10 * 60_000;

export interface AutomationScheduler {
  stop(): void;
}

export function startAutomationScheduler(deps: AgentStackDeps, options?: { tickMs?: number; leaseMs?: number }): AutomationScheduler {
  const tickMs = options?.tickMs ?? TICK_MS;
  const leaseMs = options?.leaseMs ?? DEFAULT_LEASE_MS;

  const timer = setInterval(() => {
    void tick().catch(() => undefined);
  }, tickMs);
  timer.unref?.();

  async function tick(): Promise<void> {
    const now = new Date();
    const due = listDueAutomations(deps, now);
    await Promise.allSettled(due.map((automation) => dispatchDue(deps, automation, now, leaseMs)));
  }

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

async function dispatchDue(deps: AgentStackDeps, automation: Automation, now: Date, leaseMs: number): Promise<void> {
  try {
    const repo = new AutomationRepository(deps.db, automation.userId, deps.masterKey);
    repo.releaseExpiredClaims(now);
    const due = automation.nextRunAt ?? now;
    const slot = slotKey(automation.scheduleKind, automation.scheduleExpression, due);
    const run = repo.claimSlot({ automation, scheduledSlot: slot, triggerKind: "schedule", now, leaseMs });
    if (!run) return; // already claimed by another tick/process

    // Advance to the next fire before running, so a crash mid-run never
    // re-dispatches the same slot.
    const next = nextFireAfter(automation.scheduleKind, automation.scheduleExpression, automation.timezone, due);
    repo.advanceSchedule(automation.id, due, next ?? null);

    await runAutomationTurn(deps, automation, run);
  } catch {
    // A malformed automation must not abort the tick for other automations.
  }
}

/** Due automations across all users, grouped by (user, next_run_at). */
function listDueAutomations(deps: AgentStackDeps, now: Date): Automation[] {
  const rows = deps.db.prepare(`
    SELECT * FROM copilot_automations
    WHERE status = 'enabled' AND next_run_at IS NOT NULL AND next_run_at <= ?
    ORDER BY next_run_at ASC
  `).all(now.getTime()) as Array<{
    id: string;
    user_id: string;
    name: string;
    status: string;
    scope_type: string;
    scope_policy: string;
    prompt: string;
    schedule_kind: string;
    schedule_expression: string;
    timezone: string;
    delivery_plan: string;
    authority_snapshot: string;
    revision: number;
    next_run_at: number | null;
    last_run_at: number | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status as Automation["status"],
    scopeType: row.scope_type as Automation["scopeType"],
    scopePolicy: row.scope_policy,
    prompt: row.prompt,
    scheduleKind: row.schedule_kind as Automation["scheduleKind"],
    scheduleExpression: row.schedule_expression,
    timezone: row.timezone,
    deliveryPlan: row.delivery_plan,
    authoritySnapshot: row.authority_snapshot,
    revision: row.revision,
    nextRunAt: row.next_run_at !== null ? new Date(row.next_run_at) : null,
    lastRunAt: row.last_run_at !== null ? new Date(row.last_run_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }));
}
