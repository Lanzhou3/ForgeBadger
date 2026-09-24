// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CopilotManagementPanel } from "./CopilotManagementPanel";
import { LanguageProvider } from "@/hooks/use-language";
import * as api from "@/lib/platform-actions-api";
vi.mock("@/lib/platform-actions-api", () => ({
  getProjectOverview: vi.fn(),
  setCopilotAutonomy: vi.fn(),
  updateProjectManagement: vi.fn(),
}));
const project = {
  id: "p1",
  name: "项目一",
  copilotAutonomy: false,
  management: {
    projectId: "p1",
    mode: "manual" as const,
    ownerLabel: "",
    nextAction: "",
    freshnessHours: 24,
    revision: 3,
    updatedAt: null,
  },
  counts: {
    total: 1,
    todo: 1,
    in_progress: 0,
    blocked: 0,
    ready_for_review: 0,
    done: 0,
    cancelled: 0,
  },
  goal: null,
  autonomy: "manual_only" as const,
  evidenceFreshness: {
    status: "unknown" as const,
    fresh: 0,
    stale: 0,
    unknown: 1,
    lastObservedAt: null,
  },
};
function mount() {
  render(
    <LanguageProvider>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        <CopilotManagementPanel />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getProjectOverview).mockResolvedValue({
    projects: [project],
    observedAt: Date.now(),
  });
});
afterEach(cleanup);
it("shows the project autonomy state and enables it through the switch", async () => {
  vi.mocked(api.setCopilotAutonomy).mockResolvedValue({
    projectId: "p1",
    copilotAutonomy: true,
  });
  mount();
  expect(await screen.findByText("未授权")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "项目一 Copilot 自治开关" }));
  await waitFor(() =>
    expect(api.setCopilotAutonomy).toHaveBeenCalledWith("p1", true),
  );
});
it("turns autonomy off for an authorized project", async () => {
  vi.mocked(api.getProjectOverview).mockResolvedValue({
    projects: [{ ...project, copilotAutonomy: true }],
    observedAt: Date.now(),
  });
  vi.mocked(api.setCopilotAutonomy).mockResolvedValue({
    projectId: "p1",
    copilotAutonomy: false,
  });
  mount();
  expect(await screen.findByText("已授权 Copilot 自治执行")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "项目一 Copilot 自治开关" }));
  await waitFor(() =>
    expect(api.setCopilotAutonomy).toHaveBeenCalledWith("p1", false),
  );
});
it("surfaces autonomy save failures inline", async () => {
  vi.mocked(api.setCopilotAutonomy).mockRejectedValue(new Error("offline"));
  mount();
  fireEvent.click(
    await screen.findByRole("switch", { name: "项目一 Copilot 自治开关" }),
  );
  expect(await screen.findByText(/保存失败：offline/)).toBeTruthy();
});
it("surfaces loading errors with retry controls", async () => {
  vi.mocked(api.getProjectOverview).mockRejectedValue(new Error("offline"));
  mount();
  expect(await screen.findByText("项目加载失败")).toBeTruthy();
});
it("saves management using the observed revision and preserves manual defaults", async () => {
  vi.mocked(api.updateProjectManagement).mockResolvedValue({
    management: project.management,
  });
  mount();
  await screen.findByText("人工项目 · 人工执行");
  fireEvent.change(screen.getByLabelText("负责人"), {
    target: { value: "张三" },
  });
  fireEvent.change(screen.getByLabelText("下一步"), {
    target: { value: "检查验收" },
  });
  fireEvent.submit(screen.getByLabelText("负责人").closest("form")!);
  await waitFor(() =>
    expect(api.updateProjectManagement).toHaveBeenCalledWith("p1", {
      mode: "manual",
      ownerLabel: "张三",
      nextAction: "检查验收",
      freshnessHours: 24,
      expectedRevision: 3,
    }),
  );
});
