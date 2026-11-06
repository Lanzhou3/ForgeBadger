// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as api from "@/lib/copilot-api";
import { GoalCreateDialog } from "./goal-create-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/copilot-api", async (original) => ({
  ...await original<typeof import("@/lib/copilot-api")>(),
  createGoal: vi.fn(),
}));

let client: QueryClient;

function mount() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <GoalCreateDialog open conversationId="c1" onOpenChange={() => undefined} />
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
  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(api.createGoal).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: "c1",
    title: "Ship it",
    spec: "Finish the feature",
  })));
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
