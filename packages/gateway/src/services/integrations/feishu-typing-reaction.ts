import { redactFeishuError } from "./feishu-error-redaction.js";

export interface FeishuTypingReactionState {
  messageId: string;
  reactionId: string | null;
}

interface FeishuReactionClient {
  im?: {
    messageReaction?: {
      create?(input: unknown): Promise<unknown>;
      delete?(input: unknown): Promise<unknown>;
    };
  };
}

export class FeishuTypingReactionLifecycle {
  constructor(private readonly options: {
    createClient(): FeishuReactionClient;
    onDiagnostic?(diagnostic: { action: "add" | "remove"; message: string }): void;
  }) {}

  async start(messageId: string): Promise<FeishuTypingReactionState> {
    try {
      const response = await this.options.createClient().im?.messageReaction?.create?.({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: "Typing" } },
      });
      assertSuccessfulResponse(response, "add");
      return { messageId, reactionId: readReactionId(response) };
    } catch (error) {
      // Receipt feedback is auxiliary and must never consume or fail the durable inbox item.
      this.report("add", error);
      return { messageId, reactionId: null };
    }
  }

  async stop(state: FeishuTypingReactionState): Promise<void> {
    if (!state.reactionId) return;
    try {
      const response = await this.options.createClient().im?.messageReaction?.delete?.({
        path: { message_id: state.messageId, reaction_id: state.reactionId },
      });
      assertSuccessfulResponse(response, "remove");
    } catch (error) {
      this.report("remove", error);
    }
  }

  private report(action: "add" | "remove", error: unknown): void {
    this.options.onDiagnostic?.({ action, message: redactFeishuError(error) });
  }
}

function assertSuccessfulResponse(response: unknown, action: string): void {
  if (!response || typeof response !== "object") throw new Error(`Feishu reaction ${action} unavailable`);
  const code = (response as { code?: unknown }).code;
  if (typeof code === "number" && code !== 0) {
    const message = (response as { msg?: unknown }).msg;
    throw new Error(typeof message === "string" ? message : `Feishu reaction ${action} failed with code ${code}`);
  }
}

function readReactionId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const reactionId = (data as { reaction_id?: unknown }).reaction_id;
  return typeof reactionId === "string" && reactionId.trim() ? reactionId : null;
}
