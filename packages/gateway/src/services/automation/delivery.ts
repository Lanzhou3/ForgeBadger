/**
 * Delivery for completed automation runs.
 *
 * Results are delivered to the owner's in-app notifications (and, via the
 * runner, to the automation conversation through the turn itself). Content is
 * already redacted at the orchestrator boundary; delivery only shortens the
 * summary and points at the automation.
 */
import type { Database } from "../../db/types.js";
import { NotificationRepository } from "../../db/repositories/notification-repository.js";

export interface DeliveryPlan {
  notify: boolean;
  conversation: boolean;
}

export function parseDeliveryPlan(plan: string): DeliveryPlan {
  try {
    const parsed = JSON.parse(plan) as Partial<DeliveryPlan>;
    return {
      notify: parsed.notify !== false,
      conversation: parsed.conversation !== false
    };
  } catch {
    return { notify: true, conversation: true };
  }
}

const SUMMARY_MAX_CHARS = 240;

export function deliverAutomationResult(db: Database, userId: string, input: {
  automationId: string;
  automationName: string;
  content: string;
  notify: boolean;
}): void {
  if (!input.notify) return;
  const summary = input.content.length > SUMMARY_MAX_CHARS
    ? `${input.content.slice(0, SUMMARY_MAX_CHARS)}…`
    : input.content;
  try {
    new NotificationRepository(db, userId).create({
      type: "copilot_automation",
      titleKey: "notifications.copilotAutomationCompleted",
      message: summary,
      href: `/copilot/automations/${input.automationId}`,
      payload: {
        automation_id: input.automationId,
        automation_name: input.automationName
      }
    });
  } catch {
    // Delivery must never break the run; the content is already persisted.
  }
}
