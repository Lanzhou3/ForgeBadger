// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { ConfirmDialog } from "./confirm-dialog";

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  render(
    <LanguageProvider>
      <ConfirmDialog
        open
        title="删除对象？"
        description="将删除「Alpha Provider」，该操作不可撤销。"
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        {...overrides}
      />
    </LanguageProvider>
  );
  return { onOpenChange, onConfirm };
}

describe("ConfirmDialog", () => {
  it("shows the affected object name and impact description", () => {
    renderDialog();
    expect(screen.getByText("删除对象？")).toBeTruthy();
    expect(screen.getByText(/Alpha Provider/)).toBeTruthy();
  });

  it("invokes onConfirm from the confirm button and onOpenChange from cancel", () => {
    const { onOpenChange, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses a custom confirm label and disables both buttons while pending", () => {
    renderDialog({ confirmLabel: "立即删除", pending: true, destructive: true });
    const confirmButton = screen.getByRole("button", { name: "立即删除" });
    expect(confirmButton).toBeTruthy();
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
