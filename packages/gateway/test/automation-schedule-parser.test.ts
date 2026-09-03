import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatScheduleSummary,
  nextFireAfter,
  slotKey,
  validateSchedule
} from "../src/services/automation/schedule-parser.js";

describe("automation schedule parser", () => {
  it("validates a 5-field cron expression", () => {
    assert.doesNotThrow(() => validateSchedule("cron", "0 9 * * *", "UTC"));
  });

  it("rejects an invalid cron expression", () => {
    assert.throws(() => validateSchedule("cron", "not a cron", "UTC"));
  });

  it("validates an interval of at least the minimum minutes", () => {
    assert.doesNotThrow(() => validateSchedule("interval", "15", "UTC"));
    assert.throws(() => validateSchedule("interval", "1", "UTC"));
    assert.throws(() => validateSchedule("interval", "abc", "UTC"));
  });

  it("validates a once timestamp and rejects a non-date", () => {
    assert.doesNotThrow(() => validateSchedule("once", "2026-01-01T09:00:00.000Z", "UTC"));
    assert.throws(() => validateSchedule("once", "garbage", "UTC"));
  });

  it("computes the next cron fire strictly after the reference", () => {
    const next = nextFireAfter("cron", "0 9 * * *", "UTC", new Date("2026-01-01T00:00:00Z"));
    assert.equal(next?.toISOString(), "2026-01-01T09:00:00.000Z");
  });

  it("computes the next interval fire as now + minutes", () => {
    const after = new Date("2026-01-01T00:00:00Z");
    const next = nextFireAfter("interval", "30", "UTC", after);
    assert.equal(next?.getTime(), after.getTime() + 30 * 60_000);
  });

  it("exhausts a once schedule whose time has passed", () => {
    const next = nextFireAfter("once", "2020-01-01T00:00:00.000Z", "UTC", new Date("2026-01-01T00:00:00Z"));
    assert.equal(next, undefined);
  });

  it("produces a stable slot key for cron and interval", () => {
    const fire = new Date("2026-01-01T09:00:00Z");
    assert.equal(slotKey("cron", "0 9 * * *", fire), `cron:0 9 * * *:${Math.floor(fire.getTime() / 1_000)}`);
    assert.equal(slotKey("interval", "30", fire), `interval:30:${Math.floor(fire.getTime() / 1_000)}`);
  });

  it("produces a once slot key independent of the fire time", () => {
    assert.equal(slotKey("once", "2026-01-01T09:00:00.000Z", new Date()), "once:2026-01-01T09:00:00.000Z");
  });

  it("formats a human summary per kind", () => {
    assert.equal(formatScheduleSummary("cron", "0 9 * * *"), "cron 0 9 * * *");
    assert.equal(formatScheduleSummary("interval", "30"), "every 30 minutes");
    assert.equal(formatScheduleSummary("once", "2026-01-01"), "once 2026-01-01");
  });
});
