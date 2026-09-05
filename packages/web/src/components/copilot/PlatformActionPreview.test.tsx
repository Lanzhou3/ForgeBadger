// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PendingActionRow } from "./copilot-message-primitives";
import { LanguageProvider } from "@/hooks/use-language";
import {
  getPlatformAction,
  type PlatformIntent,
} from "@/lib/platform-actions-api";
import type { CopilotPendingAction } from "@/lib/copilot-api";
vi.mock("@/lib/platform-actions-api", () => ({ getPlatformAction: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const intent: PlatformIntent = {
  id: "intent1",
  command_id: "pm.management.update",
  input_json: '{"ownerLabel":"张三"}',
  resources_json: '{"projectIds":["p1"],"revision":"3"}',
  digest: "exact-platform-digest",
  authority: "owner_action",
  grant_id: null,
  expires_at: Date.now() + 60000,
  status: "pending",
};
function mount(expiresAt: number, onDecide = vi.fn()) {
  const action: CopilotPendingAction = {
    id: "a1",
    runId: "r1",
    userId: "u1",
    tool: "pm_update_management",
    inputJson: intent.input_json,
    inputDigest: "tool-digest",
    status: "pending",
    createdAt: "",
    updatedAt: "",
    platformIntentId: intent.id,
    platformIntent: { ...intent, expires_at: expiresAt },
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <LanguageProvider>
        <PendingActionRow action={action} onDecide={onDecide} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return onDecide;
}
it("shows the exact platform digest and blocks expired approvals", async () => {
  vi.mocked(getPlatformAction).mockResolvedValue({ intent, receipt: null });
  const decide = mount(1);
  await screen.findByText(/exact-platform-digest/);
  expect(screen.getByText("确认已失效，请重新生成操作预览。")).toBeTruthy();
  for (const button of screen.getAllByRole("button"))
    expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(decide).not.toHaveBeenCalled();
});
it("renders unknown receipts without suggesting replay", async () => {
  vi.mocked(getPlatformAction).mockResolvedValue({
    intent,
    receipt: {
      intentId: intent.id,
      outcome: "unknown",
      result: null,
      createdAt: Date.now(),
    },
  });
  mount(intent.expires_at);
  expect(await screen.findByText(/操作结果未知/)).toBeTruthy();
});
it("keeps original same-run decision callback and reports approval failure", async () => {
  vi.mocked(getPlatformAction).mockResolvedValue({ intent, receipt: null });
  const decide = vi.fn().mockRejectedValue(new Error("Scope revoked"));
  mount(intent.expires_at, decide);
  await waitFor(() =>
    expect(
      (screen.getAllByRole("button")[0] as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getAllByRole("button")[0]!);
  await waitFor(() => expect(decide).toHaveBeenCalledWith(true));
  expect(await screen.findByText("Scope revoked")).toBeTruthy();
});
