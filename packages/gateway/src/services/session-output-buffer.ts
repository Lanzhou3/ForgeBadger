/**
 * Per-session terminal output ring buffer.
 *
 * Captures raw pty output (including ANSI escapes) while a browser terminal is
 * attached, so the Web can replay a read-only slice of recent output after the
 * live terminal has scrolled away. Pure class with no external dependencies.
 *
 * Memory bounds: each session buffers at most MAX_CHARS_PER_SESSION characters
 * (≈1 MiB) and at most MAX_BUFFERED_SESSIONS (200) sessions are buffered at
 * once, so worst-case memory ≈ 200 sessions × 1 MiB = 200 MiB. The buffer is
 * in-memory only and is cleared on Gateway restart (documented limitation).
 */

export const MAX_CHARS_PER_SESSION = 1_000_000; // ≈ 1 MiB per session
export const MAX_LINES_DEFAULT = 2000;

export interface SessionOutputTail {
  output: string;
  truncated: boolean;
  lineCount: number;
}

export class SessionOutputRing {
  private buffer = "";
  private truncated = false;

  /**
   * Append raw pty output. When the buffer exceeds MAX_CHARS_PER_SESSION, the
   * oldest characters are dropped (prefix slice is O(n), acceptable here since
   * the 1 MiB cap means truncation is rare) and `truncated` is set. Length is
   * measured in UTF-16 code units, a close approximation of memory footprint.
   */
  append(data: string): void {
    if (!data) {
      return;
    }
    this.buffer += data;
    if (this.buffer.length > MAX_CHARS_PER_SESSION) {
      this.buffer = this.buffer.slice(this.buffer.length - MAX_CHARS_PER_SESSION);
      this.truncated = true;
    }
  }

  /**
   * Return up to `maxLines` lines from the tail of the buffer.
   *
   * - `output`: the last `maxLines` lines joined by `\n`. A trailing newline in
   *   the source is preserved (so the tail still ends on a complete line).
   * - `truncated`: whether any characters were ever dropped for exceeding the
   *   per-session cap.
   * - `lineCount`: total number of lines in the whole buffered output (0 when
   *   the buffer is empty). A final trailing newline does not add an empty
   *   line; this is independent of the tail slice.
   */
  getTail(maxLines: number = MAX_LINES_DEFAULT): SessionOutputTail {
    if (this.buffer.length === 0) {
      return { output: "", truncated: false, lineCount: 0 };
    }
    const endsWithNewline = this.buffer.endsWith("\n");
    const lines = this.buffer.split("\n");
    if (endsWithNewline) {
      lines.pop(); // trailing empty element from the final newline
    }
    const tail = lines.slice(-maxLines).join("\n");
    const output = endsWithNewline ? `${tail}\n` : tail;
    return { output, truncated: this.truncated, lineCount: lines.length };
  }
}
