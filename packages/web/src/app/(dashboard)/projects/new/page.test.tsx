// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import NewProjectPage from "./page";

const { createProjectMock } = vi.hoisted(() => ({
  createProjectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    createProject: createProjectMock,
  };
});

describe("NewProjectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(createProjectMock).toHaveBeenCalledWith(
        {
          name: "My Project",
          path: "/tmp/my-project",
          description: "",
        },
        expect.anything()
      );
    });
  });

  it("does not render runtime CLI or template selectors", async () => {
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
    expect(screen.queryByLabelText(/Template/)).toBeNull();
  });
});