// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { CopilotSettings } from "@/components/copilot/copilot-settings";

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("CopilotSettings gear entry", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("navigates to the full settings page when the gear is clicked", () => {
    render(
      <LanguageProvider>
        <CopilotSettings />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Copilot 设置" }));

    expect(pushMock).toHaveBeenCalledWith("/copilot/settings");
  });
});
