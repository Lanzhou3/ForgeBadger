// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  projectManagerViewStorageKey,
  readProjectManagerViewPrefs,
  writeProjectManagerViewPrefs,
} from "./utils";

describe("Project Manager view preference storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("reads the ForgeBadger project preference", () => {
    const key = projectManagerViewStorageKey("project-1");
    window.localStorage.setItem(key, JSON.stringify({ statusFilter: "in_progress", viewMode: "table" }));

    expect(readProjectManagerViewPrefs(key)).toEqual({
      statusFilter: "in_progress",
      viewMode: "table",
    });
    expect(window.localStorage.getItem(key)).not.toBeNull();
  });

  it("writes only the ForgeBadger project preference", () => {
    const key = projectManagerViewStorageKey("project-1");
    writeProjectManagerViewPrefs(key, { statusFilter: "all", viewMode: "queue" });

    expect(window.localStorage.getItem(key)).toBe(
      JSON.stringify({ statusFilter: "all", viewMode: "queue" })
    );
  });
});
