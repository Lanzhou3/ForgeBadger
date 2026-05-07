import { describe, expect, it } from "vitest";

import { eventQueryInvalidations } from "./use-notifications";

describe("eventQueryInvalidations", () => {
  it("does not refetch session, project, and dashboard queries for activity stream events", () => {
    expect(
      eventQueryInvalidations({
        type: "activity_created",
        payload: {
          session_id: "session-1",
          project_id: "project-1",
        },
      })
    ).toEqual([]);
  });

  it("keeps session lifecycle events connected to session, project, dashboard, and activity queries", () => {
    expect(eventQueryInvalidations({ type: "session_status_changed" })).toEqual([
      ["sessions"],
      ["projects"],
      ["dashboard-summary"],
      ["activities"],
    ]);
  });
});
