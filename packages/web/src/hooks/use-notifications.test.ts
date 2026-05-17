import { describe, expect, it } from "vitest";

import { eventQueryInvalidations } from "./use-notifications";

describe("eventQueryInvalidations", () => {
  it("does not refetch session, project, and dashboard queries for generic activity stream events", () => {
    expect(
      eventQueryInvalidations({
        type: "activity_created",
        payload: {
          session_id: "session-1",
          project_id: "project-1",
          activity_type: "session_started",
        },
      })
    ).toEqual([]);
  });

  it("refreshes the Codex app-server activity feed for app-server activity events", () => {
    for (const activityType of [
      "codex_app_server_notification",
      "codex_app_server_initialized",
      "codex_app_server_thread_started",
      "codex_app_server_stopped",
      "codex_app_server_error",
    ]) {
      expect(
        eventQueryInvalidations({
          type: "activity_created",
          payload: {
            project_id: "project-1",
            activity_type: activityType,
          },
        })
      ).toEqual([["codex-app-server-activities"], ["codex-app-servers"]]);
    }
  });

  it("keeps session lifecycle events connected to session, project, dashboard, and activity queries", () => {
    expect(eventQueryInvalidations({ type: "session_status_changed" })).toEqual([
      ["sessions"],
      ["projects"],
      ["dashboard-summary"],
      ["activities"],
    ]);
  });

  it("refreshes Copilot conversations and active run views for Copilot run updates", () => {
    expect(
      eventQueryInvalidations({
        type: "copilot_run_updated",
        payload: {
          run_id: "run-1",
          status: "completed",
          conversation_id: "conversation-1",
        },
      })
    ).toEqual([
      ["copilot-runs"],
      ["copilot-conversations"],
      ["copilot-conversation-messages"],
    ]);
  });

  it("does not invalidate query caches for transient Copilot assistant deltas", () => {
    expect(
      eventQueryInvalidations({
        type: "copilot_run_updated",
        payload: {
          run_id: "run-1",
          status: "running",
          conversation_id: "conversation-1",
          event_type: "assistant_delta",
          delta_text: "partial"
        },
      })
    ).toEqual([]);
  });
});
