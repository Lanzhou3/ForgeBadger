/**
 * Dispatch supervisor — the deterministic completion-advance seam.
 *
 * When a task packet was delivered programmatically (details.taskPacket
 * .dispatchedAt set by session.dispatch / pm.task.execute) and the linked CLI
 * session reports task_completed / task_failed through its session hook, the
 * supervisor advances the work item exactly once: in_progress →
 * ready_for_review (completed) or blocked (failed). Acceptance stays with the
 * owner — ready_for_review still requires human judgement before done.
 *
 * Deliberately separate from the reactive loop: no LLM turn, no debounce, and
 * it only acts on grant-dispatched work items, so manual sessions and
 * permission/idle hook noise never move the board.
 */
import type { Database } from "../../db/types.js";
import { ProjectManagerRepository } from "../../db/repositories/project-manager-repository.js";
import { SessionRepository } from "../../db/repositories/session-repository.js";
import type { ForgeBadgerEvent, ForgeBadgerEventBus } from "../event-bus.js";
import { recordActivity } from "../activity-events.js";
import { findWorkItemByTaskPacketSession, readTaskPacketDetails } from "../project-manager/task-packets.js";

export interface DispatchSupervisor {
  stop(): void;
}

export function attachDispatchSupervisor(deps: { db: Database; eventBus: ForgeBadgerEventBus }): DispatchSupervisor {
  function onEvent(event: ForgeBadgerEvent): void {
    if (event.type !== "claude_notification") return;
    if (event.notificationType !== "task_completed" && event.notificationType !== "task_failed") return;
    try {
      advance(deps, event);
    } catch {
      // The supervisor must survive a failed transition (e.g. concurrent status change).
    }
  }
  deps.eventBus.on("event", onEvent);
  return {
    stop() {
      deps.eventBus.off("event", onEvent);
    }
  };
}

function advance(
  deps: { db: Database; eventBus: ForgeBadgerEventBus },
  event: Extract<ForgeBadgerEvent, { type: "claude_notification" }>
): void {
  const session = new SessionRepository(deps.db, event.userId).getById(event.sessionId);
  if (!session) return;
  const item = findWorkItemByTaskPacketSession(deps.db, event.userId, session.projectId, event.sessionId);
  if (!item || item.status !== "in_progress") return;
  if (typeof readTaskPacketDetails(item.details).dispatchedAt !== "string") return;

  const nextStatus = event.notificationType === "task_completed" ? "ready_for_review" : "blocked";
  new ProjectManagerRepository(deps.db, event.userId).updateWorkItemStatus(session.projectId, item.id, {
    status: nextStatus,
    details: {
      taskPacket: {
        ...readTaskPacketDetails(item.details),
        autoAdvancedAt: new Date().toISOString(),
        autoAdvanceReason: event.notificationType
      }
    }
  });
  recordActivity({
    db: deps.db,
    eventBus: deps.eventBus,
    userId: event.userId,
    sessionId: session.id,
    projectId: session.projectId,
    type: "pm_task_auto_advanced",
    status: nextStatus === "blocked" ? "warning" : "success",
    message: `Work item "${item.title}" advanced to ${nextStatus} (${event.notificationType})`
  });
}
