import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CopilotAutomation,
  CopilotAutomationRun
} from "../src/db/repositories/copilot-automation-repository.js";
import {
  CopilotAutomationScheduler,
  type AutomationSchedulerRepository
} from "../src/services/copilot/automation-scheduler.js";

describe("CopilotAutomationScheduler", () => {
  it("performs bounded restart catch-up and rearms the next timer", async () => {
    const repo = new FakeRepository(makeAutomation());
    const timers: number[] = [];
    const scheduler = new CopilotAutomationScheduler(repo, {
      now: () => new Date("2026-08-12T05:00:00.000Z"),
      catchUpLimit: 2,
      setTimer: (_callback, delay) => { timers.push(delay); return delay; },
      clearTimer: () => undefined
    });

    await scheduler.start();

    assert.deepEqual(repo.slots, ["2026-08-12T01:00:00.000Z", "2026-08-12T02:00:00.000Z"]);
    assert.equal(repo.automation.nextRunAt?.toISOString(), "2026-08-12T03:00:00.000Z");
    assert.equal(timers.at(-1), 1_000);
    scheduler.stop();
  });

  it("recovers leased work, bounds concurrency, and rearms after runner failure", async () => {
    const repo = new FakeRepository({ ...makeAutomation(), nextRunAt: new Date("2026-08-12T06:00:00.000Z") });
    repo.claims = [makeRun("one"), makeRun("two"), makeRun("three")];
    let active = 0;
    let peak = 0;
    let releases = 0;
    const waiters: Array<() => void> = [];
    const scheduler = new CopilotAutomationScheduler(repo, {
      now: () => new Date("2026-08-12T05:00:00.000Z"),
      maxConcurrentRuns: 2,
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => waiters.push(resolve));
        active -= 1;
        releases += 1;
        if (releases === 1) throw new Error("expected failure");
      },
      setTimer: () => 1,
      clearTimer: () => undefined
    });

    const reconcile = scheduler.reconcile();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(peak, 2);
    waiters.splice(0).forEach((resolve) => resolve());
    await reconcile;
    assert.equal(repo.claims.length, 1);
    assert.equal(scheduler.isArmed(), true);
  });

  it("creates a stable manual run and notifies the runner", async () => {
    const repo = new FakeRepository(makeAutomation());
    const runIds: string[] = [];
    const scheduler = new CopilotAutomationScheduler(repo, {
      now: () => new Date("2026-08-12T05:00:00.000Z"),
      run: async (runId) => { runIds.push(runId); },
      setTimer: () => 1,
      clearTimer: () => undefined
    });

    const first = await scheduler.runNow(repo.automation.id);
    const duplicate = await scheduler.runNow(repo.automation.id);

    assert.equal(first.id, duplicate.id);
    assert.deepEqual(runIds, [first.id, first.id]);
  });
});

class FakeRepository implements AutomationSchedulerRepository {
  slots: string[] = [];
  claims: CopilotAutomationRun[] = [];
  private readonly runs = new Map<string, CopilotAutomationRun>();

  constructor(readonly automation: CopilotAutomation) {}

  list(): CopilotAutomation[] { return [this.automation]; }

  get(id: string): CopilotAutomation | undefined { return id === this.automation.id ? this.automation : undefined; }

  updateWithRevision(_id: string, expectedRevision: number, patch: { status?: string; nextRunAt?: Date | null }): CopilotAutomation {
    assert.equal(expectedRevision, this.automation.revision);
    Object.assign(this.automation, patch, { revision: this.automation.revision + 1 });
    return this.automation;
  }

  createOrGetRun(automationId: string, slot: string, triggerKind: string): CopilotAutomationRun {
    const key = `${automationId}:${slot}`;
    const existing = this.runs.get(key);
    if (existing) return existing;
    this.slots.push(slot);
    const run = makeRun(key, slot, triggerKind);
    this.runs.set(key, run);
    return run;
  }

  claimDueRun(): CopilotAutomationRun | undefined { return this.claims.shift(); }
}

function makeAutomation(): CopilotAutomation {
  return {
    id: "automation-1", userId: "user-1", name: "Hourly", status: "active",
    scopeType: "project", scopePolicy: { projectIds: ["project-1"] }, prompt: "report",
    scheduleKind: "every", scheduleExpression: JSON.stringify({ intervalMs: 3_600_000, anchorAt: "2026-08-12T00:00:00.000Z" }),
    timezone: "UTC", deliveryPlan: {}, authoritySnapshot: {}, revision: 1,
    nextRunAt: new Date("2026-08-12T01:00:00.000Z")
  };
}

function makeRun(id: string, scheduledSlot = "2026-08-12T05:00:00.000Z", triggerKind = "scheduled"): CopilotAutomationRun {
  return {
    id, automationId: "automation-1", executionId: id, scheduledSlot, triggerKind,
    status: "claimed", claimToken: "claim", claimExpiresAt: new Date(Date.now() + 1_000), attemptCount: 1,
    generatedContentPresent: false, outboxId: null, lastErrorCode: null
  };
}
