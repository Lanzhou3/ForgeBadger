import { describe, expect, it } from "vitest";

import {
  pruneSessionTabs,
  readSessionTabs,
  removeSessionTab,
  sessionToTab,
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
});
