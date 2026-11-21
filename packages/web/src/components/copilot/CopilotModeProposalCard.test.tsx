// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import type { CopilotMessage } from "@/lib/copilot-api";
import { CopilotMessageStream } from "./copilot-message-stream";
import { CopilotModeProposalCard, parseEnterPlanMode, parseModeProposal } from "./CopilotModeProposalCard";

const { confirmMode, toastError } = vi.hoisted(() => ({ confirmMode: vi.fn(), toastError: vi.fn() }));
vi.mock("@/lib/copilot-api", () => ({ confirmCopilotModeProposal: confirmMode }));
vi.mock("@/lib/toast", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }));

const common = { conversationId: "conversation-1", userId: "user-1", sequence: 1, createdAt: "2026-11-19" } as const;
const goalResult: CopilotMessage = {
  ...common, id: "mode-result", role: "tool", kind: "tool_result", toolName: "propose_mode_switch", runId: "run-1", stepId: "step-1",
  content: JSON.stringify({ status: "mode_switch_proposed", target: "goal", reason: "Long multi-task work", title: "Migrate auth", spec: "Move everything" }),
  modeProposal: { target: "goal" },
};

function mount(message: CopilotMessage, onReceipt = vi.fn(), busy = false) {
  const proposal = parseModeProposal(message)!;
  render(
    <QueryClientProvider client={new QueryClient()}><LanguageProvider>
      <CopilotModeProposalCard proposal={proposal} stored={message.modeProposal!} stepId="step-1" conversationId="conversation-1" busy={busy} onReceipt={onReceipt} />
    </LanguageProvider></QueryClientProvider>,
  );
  return onReceipt;
}

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("CopilotModeProposalCard", () => {
  it("previews the goal and accepts it, linking the created goal", async () => {
    confirmMode.mockResolvedValue({ receipt: { decision: "accept", target: "goal", goalId: "goal-3", runId: "run-3" } });
    const onReceipt = mount(goalResult);
    expect(screen.getByText("Long multi-task work")).toBeTruthy();
    const disclosure = screen.getByText("Migrate auth");
    expect(disclosure.tagName).toBe("SUMMARY");
    expect(disclosure.closest("details")?.open).toBe(false);
    fireEvent.click(disclosure);
    expect(disclosure.closest("details")?.open).toBe(true);
    expect(screen.getByTestId("copilot-mode-proposal-spec").textContent).toBe("Move everything");
    fireEvent.click(screen.getByRole("button", { name: "接受" }));
    expect((await screen.findByRole("link", { name: "查看 Goal" })).getAttribute("href")).toBe("/copilot/goals/goal-3");
    expect(confirmMode).toHaveBeenCalledWith("conversation-1", "step-1", "accept");
    expect(onReceipt).toHaveBeenCalledWith(expect.objectContaining({ goalId: "goal-3" }));
  });

  it("allows dismissing a stale Execute proposal but cannot accept it", async () => {
    confirmMode.mockResolvedValue({ receipt: { decision: "dismiss", target: "execute" } });
    mount({
      ...goalResult,
      content: JSON.stringify({ status: "mode_switch_proposed", target: "execute", reason: "Ready" }),
      modeProposal: { target: "execute", stale: true },
    });
    expect(screen.getByRole("status").textContent).toBe("此建议已过期");
    const accept = screen.getByRole("button", { name: "接受" });
    expect(accept).toHaveProperty("disabled", true);
    fireEvent.click(accept);
    expect(confirmMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "忽略" }));
    await screen.findByText("已忽略");
    expect(confirmMode).toHaveBeenCalledWith("conversation-1", "step-1", "dismiss");
  });

  it("records a dismissal and hides the actions", async () => {
    confirmMode.mockResolvedValue({ receipt: { decision: "dismiss", target: "goal" } });
    mount(goalResult);
    fireEvent.click(screen.getByRole("button", { name: "忽略" }));
    expect(await screen.findByText("已忽略")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "接受" })).toBeNull();
  });

  it("renders the stored receipt without calling the API", () => {
    mount({ ...goalResult, modeProposal: { target: "goal", receipt: { decision: "accept", target: "goal", goalId: "goal-1" } } });
    expect(screen.getByText("已接受")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "忽略" })).toBeNull();
    expect(confirmMode).not.toHaveBeenCalled();
  });

  it("toasts a conflict and refreshes via an empty receipt", async () => {
    confirmMode.mockRejectedValue(new GatewayApiError("conflict", 409, { code: "COPILOT_REQUEST_CONFLICT" }));
    const onReceipt = mount(goalResult);
    fireEvent.click(screen.getByRole("button", { name: "接受" }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("此建议已失效或已处理。"));
    expect(onReceipt).toHaveBeenCalledWith(undefined);
  });

  it("disables actions while the conversation is busy", () => {
    mount(goalResult, vi.fn(), true);
    expect(screen.getByRole("button", { name: "接受" })).toHaveProperty("disabled", true);
  });

  it("parses proposals and enter_plan_mode results strictly", () => {
    expect(parseModeProposal({ ...goalResult, content: "{" })).toBeNull();
    expect(parseModeProposal({ ...goalResult, modeProposal: undefined })).toBeNull();
    const entered = { ...goalResult, toolName: "enter_plan_mode", content: JSON.stringify({ status: "mode_changed", mode: "plan", reason: "Risky" }) };
    expect(parseEnterPlanMode(entered)).toBe("Risky");
    expect(parseEnterPlanMode({ ...entered, content: "nope" })).toBeNull();
  });

  it("renders in the stream and shows enter_plan_mode as a status row", () => {
    const entered: CopilotMessage = { ...goalResult, id: "entered", stepId: "step-2", toolName: "enter_plan_mode", modeProposal: undefined, content: JSON.stringify({ status: "mode_changed", mode: "plan", reason: "Wide impact" }) };
    render(
      <QueryClientProvider client={new QueryClient()}><LanguageProvider>
        <CopilotMessageStream messages={[goalResult, entered]} isEditing={() => false} editDraft="" editError={null} canEdit={false} editSubmitting={false}
          onBeginEdit={() => undefined} onChangeDraft={() => undefined} onSubmitEdit={() => undefined} onCancelEdit={() => undefined} />
      </LanguageProvider></QueryClientProvider>,
    );
    expect(screen.getByTestId("copilot-mode-proposal-card")).toBeTruthy();
    expect(screen.getByTestId("copilot-entered-plan-mode").textContent).toBe("已切换到计划模式：Wide impact");
  });
});
