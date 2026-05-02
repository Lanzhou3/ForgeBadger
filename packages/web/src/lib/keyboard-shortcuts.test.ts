import { describe, expect, it } from "vitest";

import {
  isCommandPaletteShortcut,
  isSidebarToggleShortcut,
} from "./keyboard-shortcuts";

describe("keyboard shortcuts", () => {
  it("detects command palette shortcut with ctrl or meta", () => {
    expect(isCommandPaletteShortcut({ key: "k", ctrlKey: true })).toBe(true);
    expect(isCommandPaletteShortcut({ key: "K", metaKey: true })).toBe(true);
    expect(isCommandPaletteShortcut({ key: "k" })).toBe(false);
  });

  it("detects sidebar toggle shortcut without text modifiers", () => {
    expect(isSidebarToggleShortcut({ key: "b", ctrlKey: true })).toBe(true);
    expect(isSidebarToggleShortcut({ key: "B", metaKey: true })).toBe(true);
    expect(isSidebarToggleShortcut({ key: "b", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isSidebarToggleShortcut({ key: "b", ctrlKey: true, altKey: true })).toBe(false);
  });
});
