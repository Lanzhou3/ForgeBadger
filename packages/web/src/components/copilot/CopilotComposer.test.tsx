// @vitest-environment jsdom
import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import type { CopilotChatMode } from "@/lib/copilot-api";
import { CopilotComposer } from "./CopilotComposer";

vi.mock("@/lib/copilot-api", () => ({ listCopilotCommands: vi.fn().mockResolvedValue({ commands: [] }) }));
vi.mock("./CopilotComposerToolbar", () => ({ CopilotComposerToolbar: () => null }));

afterEach(cleanup);

function Composer({ onSubmit }: { onSubmit: () => void }) {
  const [mode, setMode] = useState<CopilotChatMode>("execute");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <CopilotComposer
      testId="copilot-composer"
      textareaRef={textareaRef}
      input="Keep the draft"
      onInputChange={() => undefined}
      onSubmit={onSubmit}
      onStop={() => undefined}
      canStop={false}
      isRunning={false}
      isBusy={false}
      sendDisabled={false}
      projects={[]}
      projectId=""
      conversationId={null}
      onProjectChange={() => undefined}
      onModelChange={() => undefined}
      onSavingChange={() => undefined}
      toolbarDisabled={false}
      followups={[]}
      onCancelFollowup={() => undefined}
      mode={mode}
      onModeChange={setMode}
    />
  );
}

it("starts in Execute Mode and supports Plan Mode via the pill and Shift+Tab", () => {
  const onSubmit = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><LanguageProvider><Composer onSubmit={onSubmit} /></LanguageProvider></QueryClientProvider>);
  const execute = screen.getByRole("button", { name: "执行" });
  const plan = screen.getByRole("button", { name: "计划" });
  const textarea = screen.getByPlaceholderText("输入消息…");
  expect(execute.getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(plan);
  expect(plan.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByPlaceholderText("描述你想规划的工作…")).toBe(textarea);
  expect(screen.getByTestId("copilot-mode-toggle").title).toContain("Shift+Tab");

  expect(fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true })).toBe(false);
  expect(execute.getAttribute("aria-pressed")).toBe("true");
  expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(true);
  expect(textarea).toHaveProperty("value", "Keep the draft");
  expect(onSubmit).not.toHaveBeenCalled();
});
