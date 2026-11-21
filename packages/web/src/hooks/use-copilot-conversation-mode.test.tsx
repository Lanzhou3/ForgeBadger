// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import type { CopilotChatMode, CopilotConversation, CopilotMessage } from "@/lib/copilot-api";
import { useCopilotConversationMode, useEnterPlanModeSync } from "./use-copilot-conversation-mode";

const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/copilot-api", () => ({ updateConversationMode: update }));

const wrapper = ({ children }: { children: ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

function conversation(id: string, mode: CopilotChatMode): CopilotConversation {
  return { id, mode, title: null, project_id: null, status: "active", created_at: 0, updated_at: 0 };
}

it("loads the selected mode while another conversation is saving", async () => {
  let finish!: (value: { conversation: CopilotConversation }) => void;
  update.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const onPersisted = vi.fn();
  const { result, rerender } = renderHook(
    (active: CopilotConversation) => useCopilotConversationMode({ conversationId: active.id, serverMode: active.mode, onPersisted }),
    { initialProps: conversation("old", "execute"), wrapper },
  );
  act(() => result.current.setMode("plan"));
  await waitFor(() => expect(update).toHaveBeenCalledWith("old", "plan"));
  rerender(conversation("new", "execute"));
  expect(result.current.mode).toBe("execute");
  expect(result.current.modeSaving).toBe(false);

  await act(async () => finish({ conversation: conversation("old", "plan") }));
  expect(result.current.mode).toBe("execute");
  expect(onPersisted).toHaveBeenCalledTimes(1);
  expect(onPersisted).toHaveBeenCalledWith(conversation("old", "plan"));
});

it("reflects only newly received successful mode transitions from the active conversation", () => {
  const user: CopilotMessage = {
    id: "first", conversationId: "current", userId: "owner", role: "user", kind: "text", content: "Plan it", sequence: 1, createdAt: "",
  };
  const toolResult: CopilotMessage = { ...user, role: "tool", kind: "tool_result", toolName: "enter_plan_mode" };
  const successful = JSON.stringify({ status: "mode_changed", mode: "plan", reason: "Ready" });
  const onEnter = vi.fn();
  const { rerender } = renderHook(
    (messages: CopilotMessage[]) => useEnterPlanModeSync("current", messages, onEnter),
    { initialProps: [user, { ...toolResult, id: "historical", content: successful }] },
  );
  rerender([
    user,
    { ...toolResult, id: "historical", content: successful },
    { ...toolResult, id: "denied", content: "Error: COPILOT_SCOPE_VIOLATION" },
    { ...toolResult, id: "other", content: successful, conversationId: "other" },
  ]);
  expect(onEnter).not.toHaveBeenCalled();
  rerender([user, { ...toolResult, id: "new", content: successful }]);
  expect(onEnter).toHaveBeenCalledTimes(1);
});
