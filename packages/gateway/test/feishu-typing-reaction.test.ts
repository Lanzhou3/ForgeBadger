import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FeishuTypingReactionLifecycle } from "../src/services/integrations/feishu-typing-reaction.js";

describe("FeishuTypingReactionLifecycle", () => {
  it("adds Typing to the inbound message and removes the returned reaction", async () => {
    const calls: Array<{ action: string; input: unknown }> = [];
    const lifecycle = new FeishuTypingReactionLifecycle({
      createClient: () => ({
        im: {
          messageReaction: {
            create: async (input) => {
              calls.push({ action: "create", input });
              return { code: 0, data: { reaction_id: "reaction-1" } };
            },
            delete: async (input) => {
              calls.push({ action: "delete", input });
              return { code: 0 };
            },
          },
        },
      }),
    });

    const state = await lifecycle.start("message-1");
    await lifecycle.stop(state);

    assert.deepEqual(calls, [
      {
        action: "create",
        input: {
          path: { message_id: "message-1" },
          data: { reaction_type: { emoji_type: "Typing" } },
        },
      },
      {
        action: "delete",
        input: { path: { message_id: "message-1", reaction_id: "reaction-1" } },
      },
    ]);
  });

  it("keeps reaction failures best-effort and reports only redacted diagnostics", async () => {
    const diagnostics: Array<{ action: string; message: string }> = [];
    const lifecycle = new FeishuTypingReactionLifecycle({
      createClient: () => ({
        im: {
          messageReaction: {
            create: async () => {
              throw new Error("authorization=Bearer secret-token app_secret=hidden");
            },
          },
        },
      }),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    const state = await lifecycle.start("message-1");
    await lifecycle.stop(state);

    assert.deepEqual(state, { messageId: "message-1", reactionId: null });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.action, "add");
    assert.doesNotMatch(diagnostics[0]?.message ?? "", /secret-token|hidden/);
  });

  it("treats an SDK response error code as a non-blocking add failure", async () => {
    const diagnostics: Array<{ action: string; message: string }> = [];
    const lifecycle = new FeishuTypingReactionLifecycle({
      createClient: () => ({
        im: {
          messageReaction: {
            create: async () => ({ code: 999, msg: "permission denied" }),
          },
        },
      }),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    const state = await lifecycle.start("message-1");

    assert.deepEqual(state, { messageId: "message-1", reactionId: null });
    assert.match(diagnostics[0]?.message ?? "", /permission denied/);
  });
});
