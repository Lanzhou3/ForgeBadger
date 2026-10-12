// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import type { DirectoryPickerResult } from "@/lib/api";
import ImportProjectPage from "./page";

const { getDesktopCapabilitiesMock, selectNativeDirectoryMock } = vi.hoisted(() => ({
  getDesktopCapabilitiesMock: vi.fn(),
  selectNativeDirectoryMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api")>(),
  getDesktopCapabilities: getDesktopCapabilitiesMock,
  selectNativeDirectory: selectNativeDirectoryMock,
}));

async function renderPicker() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ImportProjectPage />
      </QueryClientProvider>
    </LanguageProvider>
  );
  return screen.findByRole("button", { name: "Browse" });
}

describe("ImportProjectPage native directory picker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.setItem("forgebadger-language", "en");
    getDesktopCapabilitiesMock.mockResolvedValue({ platform: "win32", directoryPickerSupported: true });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("fills the path with the selected Windows directory", async () => {
    selectNativeDirectoryMock.mockResolvedValue({ supported: true, path: "D:\\工作项目\\demo", cancelled: false });
    fireEvent.click(await renderPicker());
    await waitFor(() => expect((screen.getByLabelText("Directory Path") as HTMLInputElement).value)
      .toBe("D:\\工作项目\\demo"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a picker failure, preserves the manual path and enables retry", async () => {
    selectNativeDirectoryMock.mockRejectedValue(new Error("Could not open the directory picker."));
    const button = await renderPicker();
    const input = screen.getByLabelText("Directory Path") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "D:\\manual\\project" } });
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not open the directory picker.");
    expect(input.value).toBe("D:\\manual\\project");
    expect(button.hasAttribute("disabled")).toBe(false);

    selectNativeDirectoryMock.mockResolvedValue({ supported: true, path: "D:\\picked\\project", cancelled: false });
    fireEvent.click(button);
    await waitFor(() => expect(input.value).toBe("D:\\picked\\project"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the manual path without an error when the user cancels", async () => {
    selectNativeDirectoryMock.mockResolvedValue({ supported: true, cancelled: true });
    const button = await renderPicker();
    const input = screen.getByLabelText("Directory Path") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "D:\\manual\\project" } });
    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(input.value).toBe("D:\\manual\\project");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows why directory picking is unavailable", async () => {
    selectNativeDirectoryMock.mockResolvedValue({ supported: false, reason: "Directory picking is unavailable." });
    fireEvent.click(await renderPicker());
    expect((await screen.findByRole("alert")).textContent).toContain("Directory picking is unavailable.");
  });

  it("prevents duplicate picks while a dialog is open", async () => {
    let finish!: (result: DirectoryPickerResult) => void;
    selectNativeDirectoryMock.mockImplementation(() => new Promise<DirectoryPickerResult>((resolve) => { finish = resolve; }));
    const button = await renderPicker();
    fireEvent.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(selectNativeDirectoryMock).toHaveBeenCalledTimes(1);
    finish({ supported: true, cancelled: true });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  });
});
