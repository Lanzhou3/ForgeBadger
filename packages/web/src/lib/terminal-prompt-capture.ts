/**
 * Captures the most recent line of user input flowing into a terminal session
 * (keystrokes → WebSocket), so session tabs can show "what was I asking here".
 * Pure keystroke accumulator: printable characters are buffered, backspace
 * edits, Enter finalizes a line, escape sequences (arrows, function keys) are
 * ignored. Nothing leaves the browser — the captured line is stored in
 * localStorage on the session tab only.
 */

export interface TerminalPromptCapture {
  /** Feed raw xterm onData chunks; returns the captured line on Enter. */
  push(data: string): string | null;
  reset(): void;
}

const MAX_BUFFER_CHARS = 240;
const MIN_PROMPT_CHARS = 2;

type ParserState =
  | "normal"
  | "escape"
  | "csi"
  | "ss3"
  | "osc"
  | "osc_escape"
  | "string"
  | "string_escape";

// Residual escape sequences when sanitizing a finalized line.
const ANSI_PATTERN = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[a-zA-Z]/g;

function isCsiFinalByte(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

export function createTerminalPromptCapture(maxPromptChars = 48): TerminalPromptCapture {
  let buffer = "";
  let state: ParserState = "normal";

  function finalize(): string | null {
    const cleaned = buffer
      .replace(ANSI_PATTERN, " ")
      .replace(/\s+/g, " ")
      .trim();
    buffer = "";
    if (cleaned.length < MIN_PROMPT_CHARS) return null;
    return cleaned.slice(0, maxPromptChars);
  }

  return {
    push(data: string): string | null {
      for (let index = 0; index < data.length; index += 1) {
        const char = data.charAt(index);
        const code = char.charCodeAt(0);

        // Enter remains a line boundary even after a malformed or truncated
        // sequence, so one bad terminal response cannot poison later input.
        if (char === "\r" || char === "\n") {
          state = "normal";
          const line = finalize();
          if (line !== null) return line;
          continue;
        }

        if (state === "escape") {
          if (char === "[") state = "csi";
          else if (char === "O") state = "ss3";
          else if (char === "]") state = "osc";
          else if (char === "P" || char === "_" || char === "^" || char === "X") {
            state = "string";
          } else {
            state = "normal";
          }
          continue;
        }

        if (state === "csi" || state === "ss3") {
          if (isCsiFinalByte(code)) state = "normal";
          continue;
        }

        if (state === "osc") {
          if (char === "\x07") state = "normal";
          else if (char === "\x1b") state = "osc_escape";
          continue;
        }

        if (state === "osc_escape") {
          state = char === "\\" ? "normal" : "osc";
          continue;
        }

        if (state === "string") {
          if (char === "\x1b") state = "string_escape";
          continue;
        }

        if (state === "string_escape") {
          state = char === "\\" ? "normal" : "string";
          continue;
        }

        if (char === "\x1b") {
          // Preserve parsing across xterm onData chunks. Cursor keys can arrive
          // as ESC O A/B (SS3), not only ESC [ A/B (CSI).
          state = "escape";
          continue;
        }

        if (char === "\x7f" || char === "\b") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        if (code >= 0x20 && code !== 0x7f) {
          buffer = (buffer + char).slice(-MAX_BUFFER_CHARS);
        }
      }
      return null;
    },
    reset() {
      buffer = "";
      state = "normal";
    },
  };
}
