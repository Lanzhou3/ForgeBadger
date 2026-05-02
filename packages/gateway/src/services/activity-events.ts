import { ActivityRepository, type CreateActivityInput, type SessionActivity } from "../db/repositories/activity-repository.js";
import type { Database } from "../db/types.js";
import type { OpenForgeEventBus } from "./event-bus.js";

export interface RecordActivityOptions extends CreateActivityInput {
  db: Database;
  userId: string;
  eventBus?: OpenForgeEventBus | undefined;
}

export function recordActivity(options: RecordActivityOptions): SessionActivity {
  const activity = new ActivityRepository(options.db, options.userId).create({
    sessionId: options.sessionId,
    projectId: options.projectId,
    type: options.type,
    status: options.status,
    message: options.message,
    metadata: options.metadata
  });

  options.eventBus?.emitEvent({
    type: "activity_created",
    userId: options.userId,
    activityId: activity.id,
    ...(activity.sessionId ? { sessionId: activity.sessionId } : {}),
    ...(activity.projectId ? { projectId: activity.projectId } : {}),
    activityType: activity.type,
    status: activity.status,
    message: activity.message,
    createdAt: activity.createdAt
  });

  return activity;
}
