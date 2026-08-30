import { describe, expect, it } from "vitest";

import {
  readMigratedStorageValue,
  removeMigratedStorageValue,
  writeMigratedStorageValue,
} from "./brand-storage";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("brand browser storage migration", () => {
  it("prefers the ForgeBadger value and clears the legacy value", () => {
    const storage = memoryStorage({
      "forgebadger.preference": "new",
      "openforge.preference": "old",
    });

    expect(readMigratedStorageValue(storage, "forgebadger.preference", "openforge.preference"))
      .toBe("new");
    expect(storage.getItem("openforge.preference")).toBeNull();
  });

  it("moves a legacy value to the ForgeBadger key on first read", () => {
    const storage = memoryStorage({ "openforge.preference": "old" });

    expect(readMigratedStorageValue(storage, "forgebadger.preference", "openforge.preference"))
      .toBe("old");
    expect(storage.getItem("forgebadger.preference")).toBe("old");
    expect(storage.getItem("openforge.preference")).toBeNull();
  });

  it("writes and removes only the bounded new and legacy key pair", () => {
    const storage = memoryStorage({ "openforge.preference": "old", unrelated: "keep" });

    writeMigratedStorageValue(storage, "forgebadger.preference", "openforge.preference", "new");
    expect(storage.getItem("forgebadger.preference")).toBe("new");
    expect(storage.getItem("openforge.preference")).toBeNull();

    removeMigratedStorageValue(storage, "forgebadger.preference", "openforge.preference");
    expect(storage.getItem("forgebadger.preference")).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });
});
