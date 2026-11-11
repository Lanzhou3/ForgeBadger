// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopilotMessageStream, buildCopilotStream } from "./copilot-message-stream";
import { LanguageProvider } from "@/hooks/use-language";
import type { CopilotMessage } from "@/lib/copilot-api";

const base = {
  conversationId: "c",
  userId: "u",
  createdAt: "",
} as const;

let sequence = 0;
function message(partial: Partial<CopilotMessage> & Pick<CopilotMessage, "id" | "role" | "kind">): CopilotMessage {
  sequence += 1;
  return { ...base, content: "", sequence, ...partial } as CopilotMessage;
}

function call(id: string, toolName = "get_session_output"): CopilotMessage {
  return message({ id, role: "assistant", kind: "tool_call", toolName, toolCallId: `tc-${id}`, toolInputJson: '{"sessionId":"abc"}' });
}

function result(callId: string, content = '{"ok":true}'): CopilotMessage {
  return message({ id: `res-${callId}`, role: "tool", kind: "tool_result", toolCallId: `tc-${callId}`, content });
}

const noopHandlers = {
  isEditing: () => false,
  editDraft: "",
  editError: null,
  editSubmitting: false,
  canEdit: false,
  onBeginEdit: () => undefined,
  onChangeDraft: () => undefined,
  onSubmitEdit: () => undefined,
  onCancelEdit: () => undefined,
};

function renderStream(messages: CopilotMessage[]) {
  return render(
    <LanguageProvider>
      <CopilotMessageStream messages={messages} {...noopHandlers} />
    </LanguageProvider>
  );
}

afterEach(cleanup);

describe("buildCopilotStream", () => {
  it("folds a call and its result into one spot and groups consecutive calls", () => {
    const entries = buildCopilotStream([
      message({ id: "u", role: "user", kind: "text", content: "读取吧" }),
      call("a"),
      result("a"),
      call("b"),
      result("b"),
      message({ id: "answer", role: "assistant", kind: "text", content: "结论" }),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(["message", "tools", "message"]);
    const tools = entries[1];
    if (tools?.kind !== "tools") throw new Error("expected a tool group");
    expect(tools.rows).toHaveLength(2);
    expect(tools.rows[0]?.pairedResult?.id).toBe("res-a");
  });

  it("marks only the entry that opens an assistant turn with the avatar", () => {
    const entries = buildCopilotStream([
      message({ id: "u", role: "user", kind: "text", content: "读取吧" }),
      call("a"),
      result("a"),
      call("b"),
      result("b"),
      message({ id: "answer", role: "assistant", kind: "text", content: "结论" }),
    ]);

    expect(entries.map((entry) => entry.showAvatar)).toEqual([false, true, false]);
  });

  it("keeps an unpaired tool_result as its own row", () => {
    const entries = buildCopilotStream([
      message({ id: "loose", role: "tool", kind: "tool_result", toolCallId: "missing", content: "orphan output" }),
    ]);

    expect(entries).toHaveLength(1);
    const tools = entries[0];
    if (tools?.kind !== "tools") throw new Error("expected a tool group");
    expect(tools.rows).toHaveLength(1);
    expect(tools.rows[0]?.message.id).toBe("loose");
  });
});

describe("CopilotMessageStream", () => {
  it("folds a run of successful calls into one collapsed process header", () => {
    renderStream([
      message({ id: "u", role: "user", kind: "text", content: "读取吧" }),
      call("a"),
      result("a"),
      call("b"),
      result("b"),
      message({ id: "answer", role: "assistant", kind: "text", content: "四个会话都读完了" }),
    ]);

    const header = screen.getByRole("button", { name: /2 次工具调用/u });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    // Collapsed: the slim rows are not mounted, so the answer is what you read.
    expect(screen.queryByRole("button", { name: /get_session_output/u })).toBeNull();
    expect(screen.getByText("四个会话都读完了")).toBeTruthy();

    fireEvent.click(header);
    expect(screen.getAllByRole("button", { name: /get_session_output/u })).toHaveLength(2);
  });

  it("never hides a failed call", () => {
    renderStream([
      call("a"),
      result("a", '{"ok":true}'),
      call("b", "run_command"),
      result("b", "Tool error: command exited with code 1"),
    ]);

    expect(screen.getByRole("button", { name: /get_session_output/u })).toBeTruthy();
    // The failed row keeps its status label for assistive technology.
    expect(screen.getByLabelText("error")).toBeTruthy();
  });

  it("renders a lone call inline without a process header", () => {
    renderStream([call("a"), result("a")]);

    expect(screen.queryByRole("button", { name: /次工具调用/u })).toBeNull();
    expect(screen.getByRole("button", { name: /get_session_output/u })).toBeTruthy();
  });

  it("reveals new rows when a collapsed run keeps growing", () => {
    const first = [call("a"), result("a"), call("b"), result("b")];
    const { rerender } = renderStream(first);
    const header = screen.getByRole("button", { name: /2 次工具调用/u });
    fireEvent.click(header);
    fireEvent.click(header);
    expect(screen.queryByRole("button", { name: /get_session_output/u })).toBeNull();

    rerender(
      <LanguageProvider>
        <CopilotMessageStream messages={[...first, call("c"), result("c")]} {...noopHandlers} />
      </LanguageProvider>
    );
    expect(screen.getAllByRole("button", { name: /get_session_output/u })).toHaveLength(3);
  });
});

describe("assistant rail", () => {
  it("shows one avatar per assistant turn in the rendered tree", () => {
    const { container } = renderStream([
      message({ id: "u", role: "user", kind: "text", content: "读取吧" }),
      call("a"),
      result("a"),
      message({ id: "answer", role: "assistant", kind: "text", content: "结论" }),
    ]);

    expect(container.querySelectorAll(".bg-brand\\/10").length).toBe(1);
  });
});

describe("tool row summary", () => {
  it("surfaces the first argument values instead of raw JSON", () => {
    renderStream([
      message({
        id: "a",
        role: "assistant",
        kind: "tool_call",
        toolName: "read_file",
        toolCallId: "tc-a",
        toolInputJson: '{"path":"packages/web/src/app/page.tsx","limit":200}',
      }),
      message({ id: "res-a", role: "tool", kind: "tool_result", toolCallId: "tc-a", content: "export default" }),
    ]);

    expect(screen.getByText(/path=packages\/web\/src\/app\/page\.tsx/u)).toBeTruthy();
  });

  it("opens a row to reveal the argument payload and result", () => {
    const writeText = vi.fn();
    void writeText;
    renderStream([call("a"), result("a", '{"projectId":"created"}')]);

    fireEvent.click(screen.getByRole("button", { name: /get_session_output/u }));
    expect(screen.getByText("参数")).toBeTruthy();
    expect(screen.getByText("结果")).toBeTruthy();
    expect(screen.getByText(/"sessionId": "abc"/u)).toBeTruthy();
  });
});
