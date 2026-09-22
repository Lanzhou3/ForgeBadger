import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createNotificationDeduper,
  defaultNotificationDeduper,
  notificationDedupeWindowMs,
} from "../src/services/notification-dedupe.js";

describe("notification dedupe", () => {
  it("passes the first observation for a session + type", () => {
    const deduper = createNotificationDeduper();
    assert.equal(
      deduper.shouldDrop("s1", "permission_prompt", "terminal", 1_000),
      false,
    );
  });

  it("drops a hook notification suppressed by an earlier hook", () => {
    const deduper = createNotificationDeduper();
    assert.equal(
      deduper.shouldDrop("s1", "permission_prompt", "hook", 1_000),
      false,
    );
    deduper.record("s1", "permission_prompt", "hook", 1_000);
    assert.equal(
      deduper.shouldDrop("s1", "permission_prompt", "hook", 2_000),
      true,
    );
  });

  it("drops a terminal notification suppressed by any earlier entry", () => {
    const deduper = createNotificationDeduper();
    deduper.record("s1", "permission_prompt", "hook", 1_000);
    assert.equal(
      deduper.shouldDrop("s1", "permission_prompt", "terminal", 2_000),
      true,
    );

    const terminalFirst = createNotificationDeduper();
    terminalFirst.record("s1", "permission_prompt", "terminal", 1_000);
    assert.equal(
      terminalFirst.shouldDrop("s1", "permission_prompt", "terminal", 2_000),
      true,
    );
  });

  it("never lets a terminal observation suppress a hook", () => {
    const deduper = createNotificationDeduper();
    deduper.record("s1", "task_completed", "terminal", 1_000);
    assert.equal(
      deduper.shouldDrop("s1", "task_completed", "hook", 2_000),
      false,
    );
  });

  it("expires observations after the window", () => {
    const deduper = createNotificationDeduper();
    deduper.record("s1", "task_completed", "hook", 1_000);
    assert.equal(
      deduper.shouldDrop("s1", "task_completed", "terminal", 1_000 + notificationDedupeWindowMs - 1),
      true,
    );
    assert.equal(
      deduper.shouldDrop("s1", "task_completed", "terminal", 1_000 + notificationDedupeWindowMs + 1),
      false,
    );
  });

  it("supports a custom window", () => {
    const deduper = createNotificationDeduper({ windowMs: 5_000 });
    deduper.record("s1", "task_failed", "terminal", 0);
    assert.equal(deduper.shouldDrop("s1", "task_failed", "terminal", 4_999), true);
    assert.equal(deduper.shouldDrop("s1", "task_failed", "terminal", 5_001), false);
  });

  it("maps the legacy attention type to the permission_prompt bucket", () => {
    const deduper = createNotificationDeduper();
    deduper.record("s1", "attention", "terminal", 1_000);
    assert.equal(
      deduper.shouldDrop("s1", "permission_prompt", "terminal", 2_000),
      true,
    );
  });

  it("keeps buckets for different types independent", () => {
    const deduper = createNotificationDeduper();
    deduper.record("s1", "permission_prompt", "terminal", 1_000);
    assert.equal(
      deduper.shouldDrop("s1", "task_completed", "terminal", 2_000),
      false,
    );
  });

  it("keeps buckets for different sessions independent", () => {
    const deduper = createNotificationDeduper();
    deduper.record("s1", "permission_prompt", "terminal", 1_000);
    assert.equal(
      deduper.shouldDrop("s2", "permission_prompt", "terminal", 2_000),
      false,
    );
  });

  it("evicts expired entries so the store stays bounded", () => {
    const deduper = createNotificationDeduper({ windowMs: 1_000 });
    for (let i = 0; i < 50; i++) {
      deduper.record(`s${i}`, "task_completed", "terminal", i);
    }
    // All entries above are expired at nowMs=100_000; recording evicts them.
    deduper.record("s100", "task_completed", "hook", 100_000);
    assert.equal(
      deduper.shouldDrop("s100", "task_completed", "terminal", 101_000),
      true,
    );
  });

  it("exposes a process-wide default deduper", () => {
    assert.equal(
      typeof defaultNotificationDeduper.shouldDrop,
      "function",
    );
    assert.equal(
      typeof defaultNotificationDeduper.record,
      "function",
    );
  });
});
