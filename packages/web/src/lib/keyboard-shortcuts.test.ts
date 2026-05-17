import { describe, expect, it } from "vitest";

import {
  isCommandPaletteShortcut,
  isCopilotShortcut,
  isSidebarToggleShortcut,
  shouldHandleCopilotShortcut,
  shouldHandleGlobalShortcut,
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

  it("detects Copilot shortcut without conflicting with command palette", () => {
    expect(isCopilotShortcut({ key: "k", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(isCopilotShortcut({ key: "K", metaKey: true, shiftKey: true })).toBe(true);
    expect(isCopilotShortcut({ key: "k", ctrlKey: true })).toBe(false);
    expect(isCopilotShortcut({ key: "k", ctrlKey: true, shiftKey: true, altKey: true })).toBe(false);
  });

  it("does not handle global shortcuts while terminal or form fields own keyboard input", () => {
    expect(shouldHandleGlobalShortcut({ isTerminalRoute: true })).toBe(false);
    expect(shouldHandleGlobalShortcut({ targetTagName: "textarea" })).toBe(false);
    expect(shouldHandleGlobalShortcut({ targetTagName: "input" })).toBe(false);
    expect(shouldHandleGlobalShortcut({ targetIsContentEditable: true })).toBe(false);
    expect(shouldHandleGlobalShortcut({ targetClosestXterm: true })).toBe(false);
  });

  it("handles global shortcuts on normal shell surfaces", () => {
    expect(shouldHandleGlobalShortcut({ targetTagName: "div" })).toBe(true);
  });

  it("allows Copilot shortcut on terminal routes without stealing terminal input", () => {
    expect(shouldHandleCopilotShortcut({ isTerminalRoute: true, targetTagName: "div" })).toBe(true);
    expect(shouldHandleCopilotShortcut({ targetClosestXterm: true })).toBe(false);
    expect(shouldHandleCopilotShortcut({ targetTagName: "textarea" })).toBe(false);
  });
});
