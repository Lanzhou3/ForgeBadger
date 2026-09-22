import { describe, expect, it } from "vitest";

import type { Project, Session } from "@/lib/api";
import {
  collectSessionCliTools,
  filterBoardSessions,
  formatColumnStats,
  formatSessionRelativeTime,
  groupSessionsIntoColumns,
  isRecentlyCreated,
  parseSessionTimestamp,
  pickSessionTitle,
  resolveSessionPrompt,
  sortSessionsForColumn,
  UNLINKED_COLUMN_KEY,
} from "./session-board-utils";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    status: "running",
    name: "session-one",
    projectId: "p1",
    projectName: "Project One",
    aiTool: "claude",
    ...overrides,
  };
}

function makeProject(id: string, name: string): Project {
  return { id, name, path: `/tmp/${id}` };
}

function isoMinutesAgo(minutes: number, from = Date.parse("2026-09-13T12:00:00.000Z")): string {
  return new Date(from - minutes * 60_000).toISOString();
}

describe("parseSessionTimestamp", () => {
  it("accepts ISO strings and epoch numbers", () => {
    expect(parseSessionTimestamp("2026-09-13T12:00:00.000Z")).toBe(
      Date.parse("2026-09-13T12:00:00.000Z")
    );
    expect(parseSessionTimestamp(1720000000000)).toBe(1720000000000);
  });

  it("rejects invalid and empty values", () => {
    expect(parseSessionTimestamp("not-a-date")).toBeNull();
    expect(parseSessionTimestamp("")).toBeNull();
    expect(parseSessionTimestamp(null)).toBeNull();
    expect(parseSessionTimestamp(undefined)).toBeNull();
    expect(parseSessionTimestamp(0)).toBeNull();
    expect(parseSessionTimestamp(Number.NaN)).toBeNull();
  });
});

describe("filterBoardSessions", () => {
  const sessions = [
    makeSession({ id: "a", name: "fix login bug", aiTool: "claude", status: "running" }),
    makeSession({ id: "b", name: "docs", aiTool: "codex", status: "stopped" }),
    makeSession({
      id: "c",
      runtimeSessionName: "fb-user-runtime",
      name: undefined,
      aiTool: "kimi",
      status: "error",
    }),
  ];

  it("searches across name, runtime name, id, project, tool, and status fields", () => {
    const base = { statusFilter: "all", cliTools: new Set<string>() };
    expect(filterBoardSessions(sessions, { ...base, query: "bug" })).toHaveLength(1);
    expect(filterBoardSessions(sessions, { ...base, query: "fb-user-runtime" })[0]?.id).toBe("c");
    expect(filterBoardSessions(sessions, { ...base, query: "project one" })).toHaveLength(3);
    expect(filterBoardSessions(sessions, { ...base, query: "claude" })[0]?.id).toBe("a");
    expect(filterBoardSessions(sessions, { ...base, query: "error" })[0]?.id).toBe("c");
    expect(filterBoardSessions(sessions, { ...base, query: "  " })).toHaveLength(3);
  });

  it("filters by status using normalized display status", () => {
    const base = { query: "", cliTools: new Set<string>() };
    expect(filterBoardSessions(sessions, { ...base, statusFilter: "all" })).toHaveLength(3);
    expect(filterBoardSessions(sessions, { ...base, statusFilter: "running" })[0]?.id).toBe("a");
    expect(filterBoardSessions(sessions, { ...base, statusFilter: "stopped" })[0]?.id).toBe("b");
    expect(filterBoardSessions(sessions, { ...base, statusFilter: "error" })[0]?.id).toBe("c");
  });

  it("filters by selected CLI tools", () => {
    const cliTools = new Set(["codex", "kimi"]);
    const result = filterBoardSessions(sessions, { query: "", statusFilter: "all", cliTools });
    expect(result.map((session) => session.id)).toEqual(["b", "c"]);
  });

  it("combines query, status, and CLI filters", () => {
    const result = filterBoardSessions(sessions, {
      query: "docs",
      statusFilter: "stopped",
      cliTools: new Set(["codex"]),
    });
    expect(result.map((session) => session.id)).toEqual(["b"]);
  });
});

describe("collectSessionCliTools", () => {
  it("returns distinct sorted tools that actually exist", () => {
    const tools = collectSessionCliTools([
      makeSession({ aiTool: "kimi" }),
      makeSession({ id: "x", aiTool: "claude" }),
      makeSession({ id: "y", aiTool: "claude" }),
      makeSession({ id: "z", aiTool: undefined }),
    ]);
    expect(tools).toEqual(["claude", "kimi"]);
  });
});

describe("sortSessionsForColumn", () => {
  it("orders running > error > stopped, then by last activity descending", () => {
    const now = Date.parse("2026-09-13T12:00:00.000Z");
    const sorted = sortSessionsForColumn([
      makeSession({ id: "stopped-old", status: "stopped", lastActive: isoMinutesAgo(10, now) }),
      makeSession({ id: "running-old", status: "running", lastActive: isoMinutesAgo(30, now) }),
      makeSession({ id: "error-1", status: "error", lastActive: isoMinutesAgo(5, now) }),
      makeSession({ id: "running-new", status: "running", lastActive: isoMinutesAgo(2, now) }),
      makeSession({ id: "error-2", status: "error", lastActive: isoMinutesAgo(1, now) }),
    ]);
    expect(sorted.map((session) => session.id)).toEqual([
      "running-new",
      "running-old",
      "error-2",
      "error-1",
      "stopped-old",
    ]);
  });
});

describe("groupSessionsIntoColumns", () => {
  const projects = [makeProject("p1", "Alpha"), makeProject("p2", "Beta"), makeProject("p3", "Gamma")];
  const now = Date.parse("2026-09-13T12:00:00.000Z");

  it("groups sessions by projectId and sorts columns by recent activity descending", () => {
    const columns = groupSessionsIntoColumns(
      [
        makeSession({ id: "s1", projectId: "p1", projectName: "Alpha", lastActive: isoMinutesAgo(5, now) }),
        makeSession({ id: "s2", projectId: "p2", projectName: "Beta", lastActive: isoMinutesAgo(1, now) }),
        makeSession({ id: "s3", projectId: "p1", projectName: "Alpha", lastActive: isoMinutesAgo(9, now) }),
      ],
      projects,
      { showEmptyProjects: false }
    );
    expect(columns.map((column) => column.projectId)).toEqual(["p2", "p1"]);
    expect(columns[1]?.sessions.map((session) => session.id)).toEqual(["s1", "s3"]);
    expect(columns[0]?.runningCount).toBe(1);
    expect(columns[0]?.totalCount).toBe(1);
  });

  it("places the unlinked column last and hides empty projects by default", () => {
    const columns = groupSessionsIntoColumns(
      [
        makeSession({ id: "s1", projectId: "p1", projectName: "Alpha", lastActive: isoMinutesAgo(5, now) }),
        makeSession({ id: "u1", projectId: undefined, projectName: undefined, lastActive: isoMinutesAgo(1, now) }),
      ],
      projects,
      { showEmptyProjects: false }
    );
    expect(columns.map((column) => column.key)).toEqual(["p1", UNLINKED_COLUMN_KEY]);
    expect(columns[1]?.unlinked).toBe(true);
    expect(columns[1]?.projectId).toBeNull();
    expect(columns.some((column) => column.projectId === "p2")).toBe(false);
  });

  it("includes empty project columns, sorted by name, when showEmptyProjects is on", () => {
    const columns = groupSessionsIntoColumns(
      [
        makeSession({ id: "s1", projectId: "p3", projectName: "Gamma", lastActive: isoMinutesAgo(5, now) }),
      ],
      projects,
      { showEmptyProjects: true }
    );
    expect(columns.map((column) => column.projectId)).toEqual(["p3", "p1", "p2"]);
    expect(columns[1]?.totalCount).toBe(0);
    expect(columns[1]?.lastActivity).toBe(0);
  });

  it("keeps sessions whose projectId is missing from the projects list", () => {
    const columns = groupSessionsIntoColumns(
      [makeSession({ id: "s9", projectId: "ghost", projectName: "Ghost", lastActive: isoMinutesAgo(3, now) })],
      projects,
      { showEmptyProjects: false }
    );
    expect(columns).toHaveLength(1);
    expect(columns[0]?.projectName).toBe("Ghost");
  });
});

describe("pickSessionTitle", () => {
  it("prefers the recorded last prompt", () => {
    const picked = pickSessionTitle(makeSession({ name: "proj" }), "  fix the bug  ");
    expect(picked).toEqual({ title: "fix the bug", fromPrompt: true, showNoInputHint: false });
  });

  it("falls back to name, then runtime session name, then id", () => {
    expect(pickSessionTitle(makeSession({ name: "my session" })).title).toBe("my session");
    expect(
      pickSessionTitle(makeSession({ name: undefined, runtimeSessionName: "fb-u-x" })).title
    ).toBe("fb-u-x");
    expect(pickSessionTitle(makeSession({ name: undefined, runtimeSessionName: null })).title).toBe("s1");
  });

  it("flags sessions whose name equals the project name for the no-input hint", () => {
    const picked = pickSessionTitle(makeSession({ name: "Project One", projectName: "Project One" }));
    expect(picked.showNoInputHint).toBe(true);
    expect(pickSessionTitle(makeSession({ name: "custom" })).showNoInputHint).toBe(false);
    expect(pickSessionTitle(makeSession({ name: undefined })).showNoInputHint).toBe(true);
  });
});

describe("resolveSessionPrompt", () => {
  it("prefers the local capture over the Gateway value", () => {
    const session = makeSession({ id: "s1", lastPrompt: "remote prompt" });
    expect(resolveSessionPrompt(session, { s1: "local prompt" })).toBe("local prompt");
  });

  it("falls back to the Gateway value when no local capture exists", () => {
    const session = makeSession({ id: "s1", lastPrompt: "remote prompt" });
    expect(resolveSessionPrompt(session, {})).toBe("remote prompt");
    expect(resolveSessionPrompt(session, { s1: "   " })).toBe("remote prompt");
  });

  it("returns undefined when neither side has a prompt", () => {
    expect(resolveSessionPrompt(makeSession({ lastPrompt: null }), {})).toBeUndefined();
    expect(resolveSessionPrompt(makeSession({ lastPrompt: "  " }), {})).toBeUndefined();
  });
});

describe("formatSessionRelativeTime", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");

  it("formats relative to lastActive, falling back to createdAt", () => {
    const twoMinutesAgo = makeSession({ lastActive: isoMinutesAgo(2, now) });
    expect(formatSessionRelativeTime(twoMinutesAgo, now, "zh-CN")).toContain("分钟");
    const createdOnly = makeSession({ lastActive: null, createdAt: isoMinutesAgo(3, now) });
    expect(formatSessionRelativeTime(createdOnly, now, "en")).toContain("minute");
  });

  it("returns null when no timestamp exists", () => {
    expect(formatSessionRelativeTime(makeSession({ lastActive: null, createdAt: null }), now, "en")).toBeNull();
  });
});

describe("formatColumnStats", () => {
  it("interpolates running and total counts", () => {
    expect(formatColumnStats("运行中 {running} · 共 {total}", 2, 5)).toBe("运行中 2 · 共 5");
  });
});

describe("isRecentlyCreated", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");

  it("is true only inside the highlight window", () => {
    expect(isRecentlyCreated(makeSession({ createdAt: isoMinutesAgo(1, now) }), now, 120_000)).toBe(true);
    expect(isRecentlyCreated(makeSession({ createdAt: isoMinutesAgo(5, now) }), now, 120_000)).toBe(false);
    expect(isRecentlyCreated(makeSession({ createdAt: null }), now, 120_000)).toBe(false);
  });
});
