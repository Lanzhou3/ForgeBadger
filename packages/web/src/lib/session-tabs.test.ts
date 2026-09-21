import { describe, expect, it } from "vitest";

import {
  groupSessionTabs,
  pruneSessionTabs,
  readSessionTabs,
  removeSessionTab,
  sessionTabGroupColor,
  sessionToTab,
  setSessionTabPrompt,
  splitSessionTabsByVisibility,
  upsertSessionTab
} from "./session-tabs";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("session tabs", () => {
  it("upserts tabs without reordering existing tabs", () => {
    const storage = new MemoryStorage();

    upsertSessionTab({ id: "a", label: "A", updatedAt: 1 }, storage);
    upsertSessionTab({ id: "b", label: "B", updatedAt: 2 }, storage);
    upsertSessionTab({ id: "a", label: "A2", status: "running", updatedAt: 3 }, storage);
    upsertSessionTab({ id: "b", label: "B2", status: "running", updatedAt: 4 }, storage);

    expect(readSessionTabs(storage)).toEqual([
      { id: "a", label: "A2", status: "running", updatedAt: 3 },
      { id: "b", label: "B2", status: "running", updatedAt: 4 }
    ]);
  });

  it("removes a tab without touching other tabs", () => {
    const storage = new MemoryStorage();
    upsertSessionTab({ id: "a", label: "A", updatedAt: 1 }, storage);
    upsertSessionTab({ id: "b", label: "B", updatedAt: 2 }, storage);

    expect(removeSessionTab("b", storage)).toEqual([{ id: "a", label: "A", updatedAt: 1 }]);
  });

  it("recovers from malformed local storage", () => {
    const storage = new MemoryStorage();
    storage.setItem("forgebadger.sessionTabs.v1", "{");

    expect(readSessionTabs(storage)).toEqual([]);
  });

  it("keeps the most recent tabs when storage holds more than the cap", () => {
    const storage = new MemoryStorage();
    const tabs = Array.from({ length: 10 }, (_, index) => ({
      id: `s${index + 1}`,
      label: `S${index + 1}`,
      updatedAt: index + 1
    }));
    // Seed directly so storage can exceed the cap (the write path caps at 8).
    storage.setItem("forgebadger.sessionTabs.v1", JSON.stringify(tabs));

    const ids = readSessionTabs(storage).map((tab) => tab.id);
    expect(ids).toEqual(["s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"]);
  });

  it("keeps every running tab even when it exceeds the old cap", () => {
    const storage = new MemoryStorage();
    const tabs = Array.from({ length: 12 }, (_, index) => ({
      id: `r${index + 1}`,
      label: `R${index + 1}`,
      status: "running",
      updatedAt: index + 1
    }));
    storage.setItem("forgebadger.sessionTabs.v1", JSON.stringify(tabs));

    expect(readSessionTabs(storage)).toHaveLength(12);
  });

  it("caps only the stopped tabs and preserves the original order", () => {
    const storage = new MemoryStorage();
    const tabs = [
      { id: "r1", label: "R1", status: "running", updatedAt: 1 },
      { id: "r2", label: "R2", status: "running", updatedAt: 2 },
      { id: "i1", label: "I1", status: "stopped", updatedAt: 11 },
      { id: "i2", label: "I2", status: "stopped", updatedAt: 12 },
      { id: "i3", label: "I3", status: "stopped", updatedAt: 13 },
      { id: "i4", label: "I4", status: "stopped", updatedAt: 14 },
      { id: "i5", label: "I5", status: "stopped", updatedAt: 15 },
      { id: "i6", label: "I6", status: "stopped", updatedAt: 16 },
      { id: "i7", label: "I7", status: "stopped", updatedAt: 17 },
      { id: "i8", label: "I8", status: "stopped", updatedAt: 18 },
      { id: "i9", label: "I9", status: "stopped", updatedAt: 19 },
      { id: "i10", label: "I10", status: "stopped", updatedAt: 20 }
    ];
    storage.setItem("forgebadger.sessionTabs.v1", JSON.stringify(tabs));

    // Both running tabs survive; only the two oldest stopped tabs are dropped.
    expect(readSessionTabs(storage).map((tab) => tab.id)).toEqual([
      "r1",
      "r2",
      "i3",
      "i4",
      "i5",
      "i6",
      "i7",
      "i8",
      "i9",
      "i10"
    ]);
  });

  describe("splitSessionTabsByVisibility", () => {
    it("returns nothing visible and nothing hidden for empty input", () => {
      const { visibleIds, hiddenTabs } = splitSessionTabsByVisibility([], "x");

      expect(visibleIds.size).toBe(0);
      expect(hiddenTabs).toEqual([]);
    });

    it("shows all tabs inline when within the limit", () => {
      const tabs = [
        { id: "a", label: "A", updatedAt: 1 },
        { id: "b", label: "B", updatedAt: 2 },
      ];
      const { visibleIds, hiddenTabs } = splitSessionTabsByVisibility(tabs, "a", 2);

      expect([...visibleIds].sort()).toEqual(["a", "b"]);
      expect(hiddenTabs).toEqual([]);
    });

    it("folds the trailing tabs past the limit into hidden, in display order", () => {
      const tabs = [
        { id: "a", label: "A", updatedAt: 1 },
        { id: "b", label: "B", updatedAt: 2 },
        { id: "c", label: "C", updatedAt: 3 },
        { id: "d", label: "D", updatedAt: 4 },
      ];
      const { visibleIds, hiddenTabs } = splitSessionTabsByVisibility(tabs, "a", 2);

      expect([...visibleIds].sort()).toEqual(["a", "b"]);
      expect(hiddenTabs.map((tab) => tab.id)).toEqual(["c", "d"]);
    });

    it("does not exceed the limit when the active tab is within it", () => {
      const tabs = [
        { id: "a", label: "A", updatedAt: 1 },
        { id: "b", label: "B", updatedAt: 2 },
        { id: "c", label: "C", updatedAt: 3 },
      ];
      // Active b is within the limit, so it occupies a slot rather than being
      // free — the strip never shows maxVisible + 1.
      const { visibleIds, hiddenTabs } = splitSessionTabsByVisibility(tabs, "b", 2);

      expect([...visibleIds].sort()).toEqual(["a", "b"]);
      expect(hiddenTabs.map((tab) => tab.id)).toEqual(["c"]);
    });

    it("keeps the active tab inline even when it sits past the limit", () => {
      const tabs = [
        { id: "a", label: "A", updatedAt: 1 },
        { id: "b", label: "B", updatedAt: 2 },
        { id: "c", label: "C", updatedAt: 3 },
        { id: "d", label: "D", updatedAt: 4 },
      ];
      const { visibleIds, hiddenTabs } = splitSessionTabsByVisibility(tabs, "d", 2);

      // d is the 4th tab but is active, so it stays inline; a, b fill the budget.
      expect(visibleIds.has("d")).toBe(true);
      expect([...visibleIds].sort()).toEqual(["a", "b", "d"]);
      expect(hiddenTabs.map((tab) => tab.id)).toEqual(["c"]);
    });

    it("folds in grouped display order (project interleaving preserved)", () => {
      const tabs = [
        { id: "a", label: "A", projectName: "P1", updatedAt: 1 },
        { id: "b", label: "B", projectName: "P2", updatedAt: 2 },
        { id: "c", label: "C", projectName: "P1", updatedAt: 3 },
        { id: "d", label: "D", projectName: "P2", updatedAt: 4 },
        { id: "e", label: "E", projectName: "P3", updatedAt: 5 },
      ];
      const { visibleIds, hiddenTabs } = splitSessionTabsByVisibility(tabs, "a", 3);

      // Display order is a, c (P1) then b, d (P2) then e (P3); first 3 inline.
      expect([...visibleIds].sort()).toEqual(["a", "b", "c"]);
      expect(hiddenTabs.map((tab) => tab.id)).toEqual(["d", "e"]);
    });
  });

  it("prunes deleted sessions", () => {
    const storage = new MemoryStorage();
    upsertSessionTab({ id: "a", label: "A", updatedAt: 1 }, storage);
    upsertSessionTab({ id: "b", label: "B", updatedAt: 2 }, storage);

    expect(pruneSessionTabs(new Set(["b"]), storage)).toEqual([{ id: "b", label: "B", updatedAt: 2 }]);
  });

  it("builds labels from session metadata", () => {
    expect(
      sessionToTab({
        id: "session-1",
        status: "running",
        name: "aether-glass",
        projectName: "Aether Glass",
        aiTool: "claude"
      }, 10)
    ).toEqual({
      id: "session-1",
      label: "aether-glass",
      projectName: "Aether Glass",
      aiTool: "claude",
      status: "running",
      updatedAt: 10
    });
  });

  it("groups tabs by project preserving first-appearance order", () => {
    const groups = groupSessionTabs([
      { id: "a", label: "A", projectName: "Alpha", updatedAt: 1 },
      { id: "b", label: "B", projectName: "Beta", updatedAt: 2 },
      { id: "c", label: "C", projectName: "Alpha", updatedAt: 3 },
      { id: "d", label: "D", updatedAt: 4 },
    ]);

    expect(groups.map((group) => group.projectName)).toEqual(["Alpha", "Beta", undefined]);
    expect(groups[0]?.tabs.map((tab) => tab.id)).toEqual(["a", "c"]);
    expect(groups[1]?.tabs.map((tab) => tab.id)).toEqual(["b"]);
    expect(groups[2]?.tabs.map((tab) => tab.id)).toEqual(["d"]);
  });

  it("preserves the captured prompt when a session tab is refreshed", () => {
    const storage = new MemoryStorage();

    upsertSessionTab({ id: "a", label: "A", lastPrompt: "修一下登录页", updatedAt: 1 }, storage);
    const tabs = upsertSessionTab({ id: "a", label: "A2", status: "running", updatedAt: 2 }, storage);

    expect(tabs[0]?.lastPrompt).toBe("修一下登录页");
  });

  it("stores the latest prompt line on the session tab", () => {
    const storage = new MemoryStorage();

    upsertSessionTab({ id: "a", label: "A", updatedAt: 1 }, storage);
    const tabs = setSessionTabPrompt("a", "解释一下这个报错", storage);

    expect(tabs[0]?.lastPrompt).toBe("解释一下这个报错");
    expect(setSessionTabPrompt("missing", "noop", storage)).toHaveLength(1);
  });

  it("preserves the project name when a session tab is refreshed", () => {
    const storage = new MemoryStorage();

    upsertSessionTab({ id: "a", label: "A", projectName: "Alpha", updatedAt: 1 }, storage);
    const tabs = upsertSessionTab({ id: "a", label: "A2", status: "running", updatedAt: 2 }, storage);

    expect(tabs[0]?.projectName).toBe("Alpha");
  });

  it("carries and preserves the project id for new-session actions", () => {
    const storage = new MemoryStorage();

    expect(
      sessionToTab(
        { id: "session-1", status: "running", name: "s1", projectId: "proj-1", projectName: "Alpha" },
        10
      )
    ).toMatchObject({ projectId: "proj-1", projectName: "Alpha" });

    upsertSessionTab(
      { id: "a", label: "A", projectId: "proj-1", projectName: "Alpha", updatedAt: 1 },
      storage
    );
    const tabs = upsertSessionTab({ id: "a", label: "A2", status: "running", updatedAt: 2 }, storage);

    expect(tabs[0]?.projectId).toBe("proj-1");
  });

  it("drops captured terminal query responses when reading tabs", () => {
    const storage = new MemoryStorage();

    upsertSessionTab(
      { id: "a", label: "A", lastPrompt: "10;rgb:e5e5/eded/f7f711", updatedAt: 1 },
      storage
    );
    upsertSessionTab({ id: "b", label: "B", lastPrompt: "正常提示词", updatedAt: 2 }, storage);
    const tabs = readSessionTabs(storage);

    expect(tabs[0]?.lastPrompt).toBeUndefined();
    expect(tabs[1]?.lastPrompt).toBe("正常提示词");
  });

  it("assigns stable, distinct group colors per project name", () => {
    expect(sessionTabGroupColor("ForgeBadger")).toBe(sessionTabGroupColor("ForgeBadger"));
    expect(sessionTabGroupColor("ForgeBadger")).toMatch(/^#[0-9a-f]{6}$/);
    const colors = new Set(
      ["ForgeBadger", "Mindspark", "Shop API", "Docs"].map((name) => sessionTabGroupColor(name))
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
