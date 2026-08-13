import type { CopilotMessage } from "../../db/repositories/copilot-repository.js";
import { redactCopilotText } from "./redaction.js";

const maxMessages = 8;
const maxMessageChars = 1_200;
const maxContextChars = 6_000;

/** Builds the bounded, redacted transcript shared by dashboard and channel turns. */
export function buildCopilotConversationContext(messages: CopilotMessage[]): string | undefined {
  const lines = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => message.content.trim().length > 0)
    .slice(-maxMessages)
    .map(toContextLine)
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;
  const context = lines.join("\n");
  return context.length > maxContextChars
    ? context.slice(context.length - maxContextChars)
    : context;
}

function toContextLine(message: CopilotMessage): string {
  const role = message.role === "assistant" ? "assistant" : "user";
  const content = redactCopilotText(message.content).replace(/\s+/gu, " ").trim();
  if (!content) return "";
  const truncated = content.length > maxMessageChars
    ? `${content.slice(0, maxMessageChars)}...`
    : content;
  return `${role}: ${truncated}`;
}
