// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { MessageRow, ThinkingSection, formatMessageTime } from "./copilot-message-primitives";
import type { CopilotMessage } from "@/lib/copilot-api";

const call: CopilotMessage = { id: "call", conversationId: "c", userId: "u", role: "assistant", kind: "tool_call", content: "", sequence: 1, createdAt: "", toolName: "create_project", toolCallId: "tc" };
const userText: CopilotMessage = { id: "user", conversationId: "c", userId: "u", role: "user", kind: "text", content: "你好", sequence: 1, createdAt: "2026-05-21T08:30:00.000Z" };
const assistantText: CopilotMessage = { id: "assistant", conversationId: "c", userId: "u", role: "assistant", kind: "text", content: "回答正文", sequence: 2, createdAt: "2026-05-21T08:31:00.000Z" };

afterEach(cleanup);

describe("tool outcome badges", () => {
  it("does not label historical calls without a result as still running", () => {
    render(<LanguageProvider><MessageRow message={call} pairedResult={null} suppressRender={false} /></LanguageProvider>);
    expect(screen.getByLabelText("unknown")).toBeTruthy();
    expect(screen.queryByLabelText("running")).toBeNull();
  });
  it.each([
    ["Action rejected by owner", "denied"],
    ["Tool disabled by owner: create_project", "denied"],
    ["Scheduled runs are read only", "denied"],
    ["Denied by security policy: restricted", "denied"],
    ["Denied by security policy: Action outside grant project scope", "denied"],
    ["Denied by security policy: Grant action budget exhausted", "denied"],
    ["Invalid tool input", "error"],
    ["Tool input digest mismatch", "error"],
    ["Unknown tool: missing", "error"],
    ["Tool error: delivery unconfirmed", "error"],
    ['{"projectId":"created"}', "ok"],
  ])("renders %s as %s", (content, status) => {
    render(<LanguageProvider><MessageRow message={call} pairedResult={{ ...call, id: "result", role: "tool", kind: "tool_result", content }} suppressRender={false} /></LanguageProvider>);
    expect(screen.getByLabelText(status)).toBeTruthy();
    if (status !== "ok") expect(screen.queryByLabelText("ok")).toBeNull();
  });
});

describe("message row metadata", () => {
  it("renders a timestamp for user and assistant messages", () => {
    const { container } = render(<LanguageProvider><MessageRow message={userText} pairedResult={null} suppressRender={false} /></LanguageProvider>);
    const time = container.querySelector("time")!;
    expect(time.getAttribute("dateTime")).toBe(userText.createdAt);
    expect(time.textContent).toBe(formatMessageTime(userText.createdAt, "zh-CN"));
  });

  it("copies an assistant message to the clipboard and confirms briefly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LanguageProvider><MessageRow message={assistantText} pairedResult={null} suppressRender={false} /></LanguageProvider>);
    const copy = screen.getByRole("button", { name: "复制" });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("回答正文");
    await waitFor(() => expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy());
  });

  it("keeps the edit affordance reachable on mobile", () => {
    render(
      <LanguageProvider>
        <MessageRow message={userText} pairedResult={null} suppressRender={false} canEdit onBeginEdit={vi.fn()} />
      </LanguageProvider>
    );
    const edit = screen.getByRole("button", { name: /编辑消息/ });
    // No `hidden` breakpoint class: the pencil stays visible without hover.
    expect(edit.className).not.toContain("hidden");
    expect(edit.className).not.toContain("md:flex");
  });
});

describe("thinking strip", () => {
  it("summarizes long reasoning with its opening line instead of a character count", () => {
    const longThinking = "先检查项目列表\n再逐项确认状态是否符合预期，并输出最终结论";
    render(<LanguageProvider><ThinkingSection text={longThinking} /></LanguageProvider>);
    const strip = screen.getByRole("button", { name: /思考过程/u });
    expect(strip.textContent).toContain("先检查项目列表");
    expect(strip.textContent).not.toContain("字");
    // The full reasoning only appears after expanding.
    expect(screen.queryByText(/逐项确认状态/u)).toBeNull();
    fireEvent.click(strip);
    expect(screen.getByText(/逐项确认状态/u)).toBeTruthy();
  });

  it("falls back to the plain label when the reasoning is too short to summarize", () => {
    render(<LanguageProvider><ThinkingSection text="推理内容" /></LanguageProvider>);
    expect(screen.getByRole("button", { name: "思考过程" })).toBeTruthy();
    expect(screen.queryByText("推理内容")).toBeNull();
  });
});
