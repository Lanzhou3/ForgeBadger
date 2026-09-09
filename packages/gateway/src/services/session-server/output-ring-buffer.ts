/**
 * Per-session terminal output ring buffer.
 *
 * Captures raw pty output (including ANSI escapes) so the Web can replay a
 * read-only slice of recent output after reconnection.
 *
 * Memory bounds: each session buffers at most MAX_CHARS characters
 * (~1 MiB). This is the single source of truth for scrollback in the
 * custom session-server architecture.
 */
export const MAX_CHARS_PER_SESSION = 1_000_000; // ~1 MiB per session
export const MAX_LINES_DEFAULT = 2000;

export interface OutputTail {
  output: string;
  truncated: boolean;
  lineCount: number;
}

export class OutputRingBuffer {
  private buffer = "";
  private truncated = false;

  /**
   * Append raw pty output. When the buffer exceeds MAX_CHARS_PER_SESSION,
   * the oldest characters are dropped.
   */
  append(data: string): void {
    if (!data) return;
    this.buffer += data;
    if (this.buffer.length > MAX_CHARS_PER_SESSION) {
      this.buffer = this.buffer.slice(this.buffer.length - MAX_CHARS_PER_SESSION);
      this.truncated = true;
    }
  }

  /**
   * Return up to `maxLines` lines from the tail of the buffer.
   */
  getTail(maxLines: number = MAX_LINES_DEFAULT): OutputTail {
    if (this.buffer.length === 0) {
      return { output: "", truncated: false, lineCount: 0 };
    }
    const endsWithNewline = this.buffer.endsWith("\n");
    const lines = this.buffer.split("\n");
    if (endsWithNewline) {
      lines.pop();
    }
    const tail = lines.slice(-maxLines).join("\n");
    const output = endsWithNewline ? `${tail}\n` : tail;
    return { output, truncated: this.truncated, lineCount: lines.length };
  }

  get length(): number {
    return this.buffer.length;
  }
}
