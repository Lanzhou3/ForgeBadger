// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import NewProjectPage from "./page";

const { createProjectMock, listTemplatesMock } = vi.hoisted(() => ({
  createProjectMock: vi.fn(),
  listTemplatesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    createProject: createProjectMock,
    listTemplates: listTemplatesMock,
  };
});

describe("NewProjectPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // jsdom implements neither Pointer Capture nor scrollIntoView; Radix
    // Select calls both while opening/rendering its content.
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    listTemplatesMock.mockResolvedValue({
      templates: [{ id: "tpl-1", name: "My Template" }],
    });
  });

  it("creates a plain project without runtime CLI or template selection", async () => {
    createProjectMock.mockResolvedValue({ project: { id: "project-1" } });
    render(
      <LanguageProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <NewProjectPage />
        </QueryClientProvider>
      </LanguageProvider>
    );

    fireEvent.change(screen.getByLabelText(/名称|Name/), { target: { value: "My Project" } });
    fireEvent.change(screen.getByLabelText(/路径|Path/), { target: { value: "/tmp/my-project" } });
    fireEvent.click(screen.getByRole("button", { name: /创建项目|Create Project/ }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: "My Project",
        path: "/tmp/my-project",
        description: "",
      });
    });
  });

  it("renders an unselected template selector but no runtime CLI selector", async () => {
    render(
      <LanguageProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <NewProjectPage />
        </QueryClientProvider>
      </LanguageProvider>
    );

    expect(screen.queryByLabelText(/Runtime CLI/)).toBeNull();
    expect(screen.getByLabelText(/模板|Template/)).toBeTruthy();
  });

  it("submits the selected template alongside the project", async () => {
    createProjectMock.mockResolvedValue({ project: { id: "project-1" } });
    render(
      <LanguageProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <NewProjectPage />
        </QueryClientProvider>
      </LanguageProvider>
    );

    const trigger = await screen.findByRole("combobox");
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    fireEvent.keyDown(trigger, { key: "Enter" });

    const option = await screen.findByRole("option", { name: "My Template" });
    fireEvent.pointerDown(option, { button: 0 });
    fireEvent.pointerUp(option, { button: 0 });
    fireEvent.click(option);

    fireEvent.change(screen.getByLabelText(/名称|Name/), { target: { value: "My Project" } });
    fireEvent.change(screen.getByLabelText(/路径|Path/), { target: { value: "/tmp/my-project" } });
    fireEvent.click(screen.getByRole("button", { name: /创建项目|Create Project/ }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: "My Project",
        path: "/tmp/my-project",
        description: "",
        templateId: "tpl-1",
      });
    });
  });
});