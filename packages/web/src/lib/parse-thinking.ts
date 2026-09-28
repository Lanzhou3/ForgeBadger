/**
 * Some providers (e.g. MiniMax over the openai-completions format) inline the
 * model's reasoning into the text content as `<think>...</think>` blocks
 * instead of a separate reasoning field. Split those blocks out so the UI can
 * render the answer as the body and the reasoning as a collapsible dim strip —
 * for persisted history messages and for partially streamed text alike.
 */

export interface ParsedThinking {
  /** Message body with every <think> block stripped. */
  text: string;
  /** Reasoning content concatenated from all <think> blocks. */
  thinking: string;
  /** True while a trailing <think> block is unterminated (still streaming). */
  thinkingOpen: boolean;
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

export function parseThinkingContent(source: string): ParsedThinking {
  let text = "";
  let thinking = "";
  let thinkingOpen = false;
  let inThink = false;
  let cursor = 0;

  while (cursor < source.length) {
    const boundary = source.indexOf(inThink ? THINK_CLOSE : THINK_OPEN, cursor);
    const chunk = boundary === -1 ? source.slice(cursor) : source.slice(cursor, boundary);
    if (inThink) {
      if (chunk) thinking += (thinking ? "\n" : "") + chunk;
      if (boundary === -1) {
        // Unterminated <think>: everything after it is still reasoning.
        thinkingOpen = true;
        break;
      }
      inThink = false;
      cursor = boundary + THINK_CLOSE.length;
    } else {
      text += chunk;
      if (boundary === -1) break;
      inThink = true;
      cursor = boundary + THINK_OPEN.length;
    }
  }

  return { text: text.trim(), thinking: thinking.trim(), thinkingOpen };
}
