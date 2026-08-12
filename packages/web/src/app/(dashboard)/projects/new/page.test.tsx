// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import NewProjectPage from "./page";

const { createProjectWithConfigMock, listTemplatesMock, defaultTemplateForAiToolMock } = vi.hoisted(() => ({
  createProjectWithConfigMock: vi.fn(),
  listTemplatesMock: vi.fn(),
  defaultTemplateForAiToolMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    createProjectWithConfig: createProjectWithConfigMock,
    listTemplates: listTemplatesMock,
    defaultTemplateForAiTool: defaultTemplateForAiToolMock,
  };
});

describe("NewProjectPage template seed hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultTemplateForAiToolMock.mockReturnValue("builtin-claude-code");
    listTemplatesMock.mockResolvedValue({ templates: [] });
  });

  it("renders the seed hint next to the template selector", async () => {
    render(
      <LanguageProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <NewProjectPage />
        </QueryClientProvider>
      </LanguageProvider>
    );

    expect(
      await screen.findByText(/模板作为初始化种子注入项目配置/)
    ).toBeTruthy();
    expect(listTemplatesMock).toHaveBeenCalled();
  });
});