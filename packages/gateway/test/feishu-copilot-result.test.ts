import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toFeishuCopilotTurn } from "../src/services/integrations/feishu-runtime-factory.js";

describe("Feishu Copilot terminal result delivery", () => {
  it("delivers the final answer instead of every internal progress narration", () => {
    const output = toFeishuCopilotTurn({
      ok: true,
      run: { id: "run-final" },
      events: [
        { type: "assistant_message", message: "我先查项目列表。" },
        { type: "tool_result", message: null },
        { type: "assistant_message", message: "最终状态：任务尚未完成，正在等待一次权限确认。" }
      ]
    } as never);

    assert.deepEqual(output.assistantMessages, [
      "最终状态：任务尚未完成，正在等待一次权限确认。"
    ]);
  });

  it("turns a failed adopted run into a bounded user-visible reply", () => {
    const output = toFeishuCopilotTurn({
      ok: false,
      status: 400,
      error: {
        code: "copilot_tool_validation_failed",
        message: "Copilot tool input is invalid"
      },
      run: { id: "run-1" },
      events: [{ type: "assistant_message", message: "我先检查会话。" }]
    } as never);

    assert.equal(output.runId, "run-1");
    assert.deepEqual(output.assistantMessages, [
      "我先检查会话。",
      "这次请求未能完成：生成的操作参数不符合要求，未执行任何操作。请重新描述操作或明确指定目标会话。"
    ]);
  });
});
