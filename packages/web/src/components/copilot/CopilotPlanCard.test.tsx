// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotPlanCard, parseSubmittedPlan, type CopilotPlanActions } from "./CopilotPlanCard";
import { CopilotMessageStream } from "./copilot-message-stream";
import type { CopilotMessage } from "@/lib/copilot-api";

const { confirmPlan, toastError } = vi.hoisted(() => ({ confirmPlan: vi.fn(), toastError: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/copilot-api", () => ({ confirmCopilotPlan: confirmPlan }));

const plan = {
  title: "Document setup",
  summary: "Make local setup reproducible.",
  constraints: ["Use existing commands"],
  acceptanceCriteria: ["Two examples work"],
  todos: [
    { title: "Update README", description: "Add an install example", verifyCommand: "pnpm test" },
    { title: "Add migration notes" },
  ],
};

function withProviders(element: React.ReactNode) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><LanguageProvider>{element}</LanguageProvider></QueryClientProvider>);
  return invalidate;
}

function renderCard(props: Partial<ComponentProps<typeof CopilotPlanCard>> = {}) {
  return withProviders(<CopilotPlanCard
    plan={plan}
    stepId="step-1"
    conversationId="conversation-1"
    proposal={{ projectId: "project-1" }}
    currentProjectId="project-1"
    {...props}
  />);
}

const common = { role: "assistant", conversationId: "conversation-1", userId: "user-1", sequence: 1, createdAt: "2026-11-19" } as const;
const result: CopilotMessage = {
  ...common, id: "plan-result", kind: "tool_result", role: "tool", toolName: "submit_plan",
  runId: "run-1", stepId: "step-1", toolCallId: "provider-call",
  content: JSON.stringify({ status: "plan_proposed", plan }),
  planProposal: { projectId: "project-1" },
};
const toolCall: CopilotMessage = {
  ...common, id: "plan-call", kind: "tool_call", toolName: "submit_plan",
  runId: "run-1", stepId: "step-1", toolCallId: "provider-call",
  content: "submit_plan", toolInputJson: JSON.stringify({ ...plan, title: "Model input title" }),
};

function renderStream(messages: CopilotMessage[], props: CopilotPlanActions = {}) {
  return withProviders(<CopilotMessageStream
    messages={messages}
    planActions={{ currentProjectId: "project-1", ...props }}
    isEditing={() => false}
    editDraft=""
    editError={null}
    canEdit={false}
    editSubmitting={false}
    onBeginEdit={() => undefined}
    onChangeDraft={() => undefined}
    onSubmitEdit={() => undefined}
    onCancelEdit={() => undefined}
  />);
}

beforeEach(() => {
  vi.resetAllMocks();
  confirmPlan.mockImplementation(async (_conversationId, _stepId, { action, todoIndexes }) =>
    ({ confirmation: { action, todoIndexes } }));
});
afterEach(cleanup);

describe("CopilotPlanCard", () => {
  it("renders a reviewable checklist and sends only selected TODO indexes", async () => {
    const invalidate = renderCard();
    expect(screen.getByRole("heading", { name: plan.title })).toBeTruthy();
    expect(screen.getByText("Use existing commands")).toBeTruthy();
    expect(screen.getByText("Two examples work")).toBeTruthy();
    expect(screen.getByText("pnpm test")).toBeTruthy();
    const skipped = screen.getByRole("checkbox", { name: "Add migration notes" });
    expect(skipped).toHaveProperty("checked", true);
    fireEvent.click(skipped);
    fireEvent.click(screen.getByRole("button", { name: "仅写入项目任务" }));
    await screen.findByText("已写入项目任务");
    expect(confirmPlan).toHaveBeenCalledOnce();
    expect(confirmPlan).toHaveBeenCalledWith("conversation-1", "step-1", { action: "save", todoIndexes: [0] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project-manager", "project-1"] });
  });

  it("invalidates Copilot and project Goal views after creating an autonomous Goal", async () => {
    confirmPlan.mockResolvedValue({ confirmation: { action: "goal", todoIndexes: [0, 1], goalId: "goal-1", runId: "run-2" } });
    const invalidate = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "作为自主 Goal 执行" }));
    const link = await screen.findByRole("link", { name: "查看 Goal" });
    expect(link.getAttribute("href")).toBe("/copilot/goals/goal-1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["copilot", "goals"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["copilot-goals"] });
  });

  it("can execute without a project and disables board-only save", async () => {
    const onConfirmation = vi.fn();
    confirmPlan.mockResolvedValue({ confirmation: { action: "execute", todoIndexes: [0, 1], runId: "run-2" } });
    renderCard({ currentProjectId: null, proposal: { projectId: null }, onConfirmation });
    expect(screen.getByRole("button", { name: "仅写入项目任务" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "确认并开始执行" }));
    await screen.findByText("已开始执行计划");
    expect(onConfirmation).toHaveBeenCalledWith({ action: "execute", todoIndexes: [0, 1], runId: "run-2" });
  });

  it("refuses a different project and restores a confirmation from the transcript", () => {
    renderStream([toolCall, result], { currentProjectId: "project-2" });
    expect(screen.getByText("请切回生成此计划时的项目上下文。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认并开始执行" })).toBeNull();
    cleanup();
    renderStream([toolCall, { ...result, planProposal: {
      projectId: "project-1", confirmation: { action: "save", todoIndexes: [1] },
    } }]);
    expect(screen.getByText("已写入项目任务")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Update README" })).toHaveProperty("checked", false);
    expect(screen.getByRole("checkbox", { name: "Add migration notes" })).toHaveProperty("checked", true);
    expect(confirmPlan).not.toHaveBeenCalled();
  });

  it("uses the confirmed plan in the receipt and ignores a reused provider ID from another run", () => {
    expect(parseSubmittedPlan(toolCall)).toBeNull();
    expect(parseSubmittedPlan({ ...result, content: "{" })).toBeNull();
    expect(parseSubmittedPlan(result)).toEqual(plan);

    const deniedCall = { ...toolCall, runId: "other-run", stepId: "other-step", id: "denied-call" };
    const deniedResult = { ...deniedCall, kind: "tool_result", role: "tool", id: "denied-result",
      content: "Denied by security policy: Tool disabled by owner" } as const;
    renderStream([deniedCall, deniedResult, toolCall, result]);
    expect(screen.getAllByTestId("copilot-plan-card")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: plan.title })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Model input title" })).toBeNull();
    const group = screen.getByRole("button", { name: /过程/ });
    fireEvent.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("copilot-plan-card")).toBeTruthy();
  });

  const richPlan = {
    ...plan,
    todos: [
      { title: "Update README", dependsOn: [] },
      { title: "Add migration notes", dependsOn: [0], files: ["docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md"], risk: "high", parallelizable: true, executor: "delegate" },
    ],
  } as const;

  it("renders dependency, files, risk, parallel and executor chips", () => {
    renderCard({ plan: richPlan as never });
    const meta = screen.getAllByTestId("copilot-plan-todo-meta");
    expect(meta).toHaveLength(1);
    expect(meta[0]!.textContent).toContain("依赖 #1");
    expect(meta[0]!.textContent).toContain("风险：高");
    expect(meta[0]!.textContent).toContain("可并行");
    expect(meta[0]!.textContent).toContain("子代理");
    expect(meta[0]!.textContent).toContain("docs/a.md");
    expect(meta[0]!.textContent).toContain("另 2 个");
    expect(meta[0]!.textContent).not.toContain("docs/c.md");
  });

  it("accepts the extended TODO schema from the transcript", () => {
    expect(parseSubmittedPlan({ ...result, content: JSON.stringify({ status: "plan_proposed", plan: richPlan }) })).not.toBeNull();
  });

  it("collapses a superseded proposal without actions and expands it read-only", () => {
    renderCard({ proposal: { projectId: "project-1", supersededBy: "step-2" } });
    expect(screen.queryByRole("button", { name: "确认并开始执行" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Document setup/ }));
    expect(screen.getAllByText("已被新计划取代").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "确认并开始执行" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Update README" })).toHaveProperty("disabled", true);
  });

  it("shows a revised marker with an added/removed/changed title diff", () => {
    const previousPlan = { ...plan, todos: [{ title: "Update README", description: "Old text" }, { title: "Drop me" }] };
    renderCard({ proposal: { projectId: "project-1", previousStepId: "step-0" }, previousPlan });
    fireEvent.click(screen.getByRole("button", { name: "已修订" }));
    const diff = screen.getByTestId("copilot-plan-diff");
    expect(diff.textContent).toContain("Add migration notes");
    expect(diff.textContent).toContain("Drop me");
    expect(diff.textContent).toContain("Update README");
  });

  it("sends revision feedback through the plan-mode send path", () => {
    const onRequestChanges = vi.fn();
    renderCard({ onRequestChanges });
    fireEvent.click(screen.getByRole("button", { name: "请求修改" }));
    const box = screen.getByRole("textbox", { name: "请求修改" });
    const send = screen.getByRole("button", { name: "发送修改意见" });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.change(box, { target: { value: "Split step 2" } });
    fireEvent.click(send);
    expect(onRequestChanges).toHaveBeenCalledWith("Split step 2");
  });

  it("cannot send an open revision form after project context changes", () => {
    const onRequestChanges = vi.fn();
    const client = new QueryClient();
    const forProject = (id: string) => (
      <QueryClientProvider client={client}><LanguageProvider>
        <CopilotPlanCard plan={plan} stepId="step-1" conversationId="conversation-1"
          proposal={{ projectId: "project-1" }} currentProjectId={id} onRequestChanges={onRequestChanges} />
      </LanguageProvider></QueryClientProvider>
    );
    const { rerender } = render(forProject("project-1"));
    fireEvent.click(screen.getByRole("button", { name: "请求修改" }));
    fireEvent.change(screen.getByRole("textbox", { name: "请求修改" }), { target: { value: "Project A feedback" } });
    rerender(forProject("project-2"));
    expect(screen.queryByRole("button", { name: "发送修改意见" })).toBeNull();
    expect(onRequestChanges).not.toHaveBeenCalled();
  });

  it("explains isolated single-run execution and links the goal after Execute now", async () => {
    confirmPlan.mockResolvedValue({ confirmation: { action: "execute", todoIndexes: [0, 1], goalId: "goal-9", runId: "run-9" } });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "确认并开始执行" }));
    expect(await screen.findByText("在隔离的 Goal 工作区中执行，运行一轮后暂停。")).toBeTruthy();
    expect(screen.getByRole("link", { name: "查看 Goal" }).getAttribute("href")).toBe("/copilot/goals/goal-9");
  });

  it("shows a specific toast and refreshes when the plan was superseded (409)", async () => {
    const { GatewayApiError } = await import("@/lib/api");
    confirmPlan.mockRejectedValue(new GatewayApiError("superseded", 409, { code: "COPILOT_PLAN_SUPERSEDED" }));
    const onConfirmation = vi.fn();
    renderCard({ onConfirmation });
    fireEvent.click(screen.getByRole("button", { name: "确认并开始执行" }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("此计划已被更新的计划取代，请使用最新计划。"));
    expect(onConfirmation).toHaveBeenCalledWith(undefined);
  });
});
