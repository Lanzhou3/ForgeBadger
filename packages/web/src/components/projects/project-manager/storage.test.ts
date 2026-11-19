// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { GatewayApiError } from "@/lib/api";
import { getTranslation } from "@/lib/i18n";
import {
  projectManagerMutationMessage,
  projectManagerViewStorageKey,
  readProjectManagerViewPrefs,
  writeProjectManagerViewPrefs,
} from "./utils";

describe("Project Manager view preference storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to active status filter when empty", () => {
    const key = projectManagerViewStorageKey("project-1");
    expect(readProjectManagerViewPrefs(key)).toEqual({ statusFilter: "active" });
  });

  it("reads the ForgeBadger project preference and ignores legacy viewMode fields", () => {
    const key = projectManagerViewStorageKey("project-1");
    window.localStorage.setItem(
      key,
      JSON.stringify({ statusFilter: "in_progress", viewMode: "table" }),
    );

    expect(readProjectManagerViewPrefs(key)).toEqual({
      statusFilter: "in_progress",
    });
    expect(window.localStorage.getItem(key)).not.toBeNull();
  });

  it("writes only the ForgeBadger project statusFilter preference", () => {
    const key = projectManagerViewStorageKey("project-1");
    writeProjectManagerViewPrefs(key, { statusFilter: "all" });

    expect(window.localStorage.getItem(key)).toBe(JSON.stringify({ statusFilter: "all" }));
  });

  it("localizes known Gateway Project Manager error messages across locales", () => {
    const tZh = (key: Parameters<typeof getTranslation>[1]) => getTranslation("zh-CN", key);
    const tEn = (key: Parameters<typeof getTranslation>[1]) => getTranslation("en", key);

    const evidenceError = new GatewayApiError(
      "Marking done requires evidence references or a manual completion reason",
      400,
    );
    expect(projectManagerMutationMessage(evidenceError, "fallback", tZh)).toBe(
      "标记通过需要关联验证证据，或填写手动验收说明。",
    );
    expect(projectManagerMutationMessage(evidenceError, "fallback", tEn)).toBe(
      "Marking done requires verification evidence or a manual completion note.",
    );

    const conflictError = new GatewayApiError("STALE_TASK_REVISION", 409);
    expect(projectManagerMutationMessage(conflictError, "fallback", tZh)).toBe(
      getTranslation("zh-CN", "projects.projectManagerConflictBanner"),
    );

    const deleteBlockedError = new GatewayApiError("DELIVERY_HISTORY_REQUIRES_ARCHIVE", 409);
    expect(projectManagerMutationMessage(deleteBlockedError, "fallback", tZh)).toBe(
      "该任务已有交付记录，无法直接删除，请改为已取消。",
    );
  });
});
