// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as coreApi from "@/lib/api";
import * as api from "@/lib/copilot-api";
import { GoalCreateDialog } from "./goal-create-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  listProjects: vi.fn(),
}));
vi.mock("@/lib/copilot-api", async (original) => ({
  ...await original<typeof import("@/lib/copilot-api")>(),
  createConversation: vi.fn(),
  createGoal: vi.fn(),
}));

let client: QueryClient;

function mount(props: { conversationId?: string | null; projectId?: string } = { conversationId: "c1" }) {
  render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <GoalCreateDialog open {...props} onOpenChange={() => undefined} />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.mocked(coreApi.listProjects).mockResolvedValue({
    projects: [{ id: "p1", name: "Alpha Repo" } as coreApi.Project],
  });
  vi.mocked(api.createConversation).mockResolvedValue({
    conversation: { id: "c-lazy", title: "Ship it", status: "active", project_id: "p1", created_at: 1, updated_at: 1 },
  });
  vi.mocked(api.createGoal).mockResolvedValue({ goalId: "g1", runId: "r1" });
});

afterEach(() => {
  client.clear();
});

function fillRequired() {
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: "Ship it" } });
  fireEvent.change(screen.getByLabelText("目标描述"), { target: { value: "Finish the feature" } });
}

it("submits without grants by default", async () => {
  mount();
  expect(screen.queryByRole("combobox", { name: "关联项目" })).toBeNull();
  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(api.createGoal).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: "c1",
    title: "Ship it",
    spec: "Finish the feature",
  })));
  expect(api.createConversation).not.toHaveBeenCalled();
  expect(vi.mocked(api.createGoal).mock.calls[0]?.[0]).not.toHaveProperty("grants");
});

it("submits checked grants and omits unchecked ones", async () => {
  mount();
  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: /自动授权/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "会话启停" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "任务派发" }));
  // 终端命令 stays unchecked.
  fireEvent.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(api.createGoal).toHaveBeenCalledWith(expect.objectContaining({
    grants: ["operate_sessions", "pm_dispatch"],
  })));
});

it("lazily creates a conversation with optional selected project when conversationId is omitted", async () => {
  mount({});
  const trigger = await screen.findByRole("combobox", { name: "关联项目" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  const option = await screen.findByRole("option", { name: "Alpha Repo" });
  fireEvent.pointerDown(option, { button: 0 });
  fireEvent.pointerUp(option, { button: 0 });
  fireEvent.click(option);

  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(api.createConversation).toHaveBeenCalledWith("Ship it", "p1"));
  await waitFor(() => expect(api.createGoal).toHaveBeenCalledWith({
    conversationId: "c-lazy",
    projectId: "p1",
    title: "Ship it",
    spec: "Finish the feature",
  }));
});
