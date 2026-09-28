// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { PET_STORAGE_KEY } from "@/lib/pet-preference";
import { PetSettings } from "./PetSettings";

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderSettings() {
  return render(<LanguageProvider><PetSettings /></LanguageProvider>);
}

it("saves the robot selection and restores it after remount", () => {
  renderSettings();
  fireEvent.click(screen.getByRole("radio", { name: "机器人" }));
  expect(window.localStorage.getItem(PET_STORAGE_KEY)).toBe("robot");
  expect(screen.getByRole("status").textContent).toBe("宠物选择已保存。");
  cleanup();
  renderSettings();
  expect(screen.getByRole("radio", { name: "机器人" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getAllByRole("radio")).toHaveLength(1);
});

it("falls back to the robot for an unsupported stored pet", () => {
  window.localStorage.setItem(PET_STORAGE_KEY, "removed-pet");
  renderSettings();
  expect(screen.getByRole("radio", { name: "机器人" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("status")).toBeNull();
});

it("reports storage failure without claiming the selection was saved", () => {
  renderSettings();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  fireEvent.click(screen.getByRole("radio", { name: "机器人" }));
  expect(screen.getByRole("alert").textContent).toContain("无法保存宠物选择");
  expect(screen.queryByRole("status")).toBeNull();
  expect(window.localStorage.getItem(PET_STORAGE_KEY)).toBeNull();
});
