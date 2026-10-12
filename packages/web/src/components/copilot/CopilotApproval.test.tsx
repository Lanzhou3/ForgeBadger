// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GatewayApiError } from "@/lib/api";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotApproval } from "./CopilotApproval";
import type { CopilotPendingAction } from "@/lib/copilot-api";

const { decide } = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("@/lib/copilot-api", () => ({ decidePendingAction: decide }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const action: CopilotPendingAction = { id: "action-1", runId: "run-1", userId: "user-1", tool: "mcp_write", inputJson: '{"text":"<script>alert(1)</script>"}', inputDigest: "digest", status: "pending", createdAt: "", updatedAt: "" };

it("shows exact input as text and disables both decisions while approval is pending", async () => {
  let resolve!: (value: { resumed: boolean; runId: string }) => void;
  decide.mockReturnValue(new Promise(res => { resolve = res; }));
  const onDecided = vi.fn();
  const { container } = render(<LanguageProvider><CopilotApproval action={action} onDecided={onDecided} /></LanguageProvider>);
  expect(screen.getByText("mcp_write")).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "允许本次调用" }));
  expect(decide).toHaveBeenCalledWith("run-1", "action-1", true);
  expect((screen.getByRole("button", { name: "拒绝本次调用" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { resolve({ resumed: true, runId: "run-1" }); });
  expect(onDecided).toHaveBeenCalledOnce();
});

it("reports a stale approval instead of claiming success and refreshes authoritative state", async () => {
  decide.mockResolvedValue({ resumed: false, runId: "run-1" });
  const onDecided = vi.fn();
  render(<LanguageProvider><CopilotApproval action={action} onDecided={onDecided} /></LanguageProvider>);
  fireEvent.click(screen.getByRole("button", { name: "拒绝本次调用" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("状态已变化"));
  expect(decide).toHaveBeenCalledWith("run-1", "action-1", false);
  expect(onDecided).toHaveBeenCalledOnce();
});

it("shows the server-bound stop target rather than trusting the model's label", () => {
  const input = { sessionId: 'session-arch', observationId: 'observation-1', expectedTitle: '检查Copilot架构与实现不足' };
  const stop: CopilotPendingAction = { ...action, tool: 'stop_session', inputJson: JSON.stringify(input), platformIntent: {
    id: 'intent-1', command_id: 'session.stop', input_json: JSON.stringify(input), digest: 'digest', authority: 'owner_action', status: 'approved', expires_at: Date.now() + 10000,
    resources_json: JSON.stringify({ stopTarget: { ...input, taskTitle: input.expectedTitle, projectName: 'ForgeBadger', sessionName: 'ForgeBadger',
      observedAt: Date.now(), titleSource: 'terminal_footer', terminalExcerpt: '<script>terminal text</script>', executionScope: 'session_process_group' } })
  } };
  const { container } = render(<LanguageProvider><CopilotApproval action={stop} onDecided={() => {}} /></LanguageProvider>);
  expect(screen.getByText('检查Copilot架构与实现不足')).toBeTruthy();
  expect(screen.getByText('session-arch')).toBeTruthy();
  expect(container.querySelector('script')).toBeNull();
  expect((screen.getByRole('button', { name: '允许本次调用' }) as HTMLButtonElement).disabled).toBe(false);
});

it("blocks approval of legacy stop requests with no trusted target but permits rejection", () => {
  const stop = { ...action, tool: 'stop_session', inputJson: '{"sessionId":"wrong-target"}' };
  render(<LanguageProvider><CopilotApproval action={stop} onDecided={() => {}} /></LanguageProvider>);
  expect((screen.getByRole('button', { name: '允许本次调用' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '拒绝本次调用' }) as HTMLButtonElement).disabled).toBe(false);
});

it('shows an expired authority remedy and immediately reconciles a failed decision', async () => {
  decide.mockRejectedValue(new GatewayApiError('operation rejected',400,{code:'PLATFORM_INTENT_EXPIRED'}));
  const onDecided=vi.fn();
  render(<LanguageProvider><CopilotApproval action={action} onDecided={onDecided}/></LanguageProvider>);
  fireEvent.click(screen.getByRole('button',{name:'允许本次调用'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('已过期'));
  expect(screen.getByRole('alert').textContent).toContain('重新发起');
  expect(onDecided).toHaveBeenCalledOnce();
  expect(decide).toHaveBeenCalledOnce();
});
