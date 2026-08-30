// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  projectManagerViewStorageKey,
  readProjectManagerViewPrefs,
  writeProjectManagerViewPrefs,
} from "./utils";

describe("Project Manager view preference storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("migrates the matching legacy project preference only", () => {
    const key = projectManagerViewStorageKey("project-1");
    window.localStorage.setItem(
      "openforge:pm-view:project-1",
      JSON.stringify({ statusFilter: "in_progress", viewMode: "table" })
    );

    expect(readProjectManagerViewPrefs(key)).toEqual({
      statusFilter: "in_progress",
      viewMode: "table",
    });
    expect(window.localStorage.getItem(key)).not.toBeNull();
    expect(window.localStorage.getItem("openforge:pm-view:project-1")).toBeNull();
  });

  it("writes only the ForgeBadger project preference", () => {
    const key = projectManagerViewStorageKey("project-1");
    window.localStorage.setItem("openforge:pm-view:project-1", "legacy");

    writeProjectManagerViewPrefs(key, { statusFilter: "all", viewMode: "queue" });

    expect(window.localStorage.getItem(key)).toBe(
      JSON.stringify({ statusFilter: "all", viewMode: "queue" })
    );
    expect(window.localStorage.getItem("openforge:pm-view:project-1")).toBeNull();
  });
});
