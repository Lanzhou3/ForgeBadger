// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { MessageRow } from "./copilot-message-primitives";
import type { CopilotMessage } from "@/lib/copilot-api";
const call: CopilotMessage = { id: "call", conversationId: "c", userId: "u", role: "assistant", kind: "tool_call", content: "", sequence: 1, createdAt: "", toolName: "create_project", toolCallId: "tc" };
afterEach(cleanup);
describe("tool outcome badges", () => {
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
