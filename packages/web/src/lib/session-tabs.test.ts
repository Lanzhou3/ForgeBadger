import { describe, expect, it } from "vitest";

import {
  groupSessionTabs,
  pruneSessionTabs,
  readSessionTabs,
  removeSessionTab,
  sessionTabGroupColor,
  sessionToTab,
  setSessionTabPrompt,
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
    storage.setItem("openforge.sessionTabs.v1", "{");

    expect(readSessionTabs(storage)).toEqual([]);
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
    expect(sessionTabGroupColor("OpenForge")).toBe(sessionTabGroupColor("OpenForge"));
    expect(sessionTabGroupColor("OpenForge")).toMatch(/^#[0-9a-f]{6}$/);
    const colors = new Set(
      ["OpenForge", "Mindspark", "Shop API", "Docs"].map((name) => sessionTabGroupColor(name))
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
