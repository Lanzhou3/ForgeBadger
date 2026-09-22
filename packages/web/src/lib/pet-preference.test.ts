// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PET_STORAGE_KEY, readPetPreference, subscribePetPreference, writePetPreference } from "./pet-preference";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("returns the default pet when browser storage cannot be read", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  expect(readPetPreference()).toBe("robot");
});

it("notifies local and other-tab consumers, ignores unrelated preferences, and cleans up", () => {
  const onChange = vi.fn();
  const unsubscribe = subscribePetPreference(onChange);
  expect(writePetPreference("robot")).toBe(true);
  expect(readPetPreference()).toBe("robot");
  expect(onChange).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
  expect(onChange).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new StorageEvent("storage", { key: PET_STORAGE_KEY, newValue: "robot" }));
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(onChange).toHaveBeenCalledTimes(3);
  unsubscribe();
  writePetPreference("robot");
  window.dispatchEvent(new StorageEvent("storage", { key: PET_STORAGE_KEY }));
  expect(onChange).toHaveBeenCalledTimes(3);
});
