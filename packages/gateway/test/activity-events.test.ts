import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ActivityRepository, UserRepository } from "../src/db/repositories/index.js";
import { recordActivity } from "../src/services/activity-events.js";
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from "../src/services/event-bus.js";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("activity events", () => {
  it("records activity and emits an activity_created event", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("activity-event@example.com", "hash");
    const eventBus = new ForgeBadgerEventBus();
    const events: ForgeBadgerEvent[] = [];
    eventBus.on("event", (event) => events.push(event));

    const activity = recordActivity({
      db,
      eventBus,
      userId: user.id,
      type: "session_started",
      status: "success",
      message: "Session started"
    });

    assert.equal(new ActivityRepository(db, user.id).list().length, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "activity_created");
    if (events[0]!.type === "activity_created") {
      assert.equal(events[0]!.activityId, activity.id);
      assert.equal(events[0]!.activityType, "session_started");
    }
    db.close();
  });
});
