interface WheelGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
}

const MAX_REPORTS_PER_EVENT = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Codex's owned transcript consumes SGR wheel reports rather than xterm scrollback. */
export class CodexWheelInput {
  private pendingLines = 0;

  encode(event: WheelEvent, geometry: WheelGeometry): string | null {
    if (
      !Number.isFinite(event.deltaY) ||
      event.deltaY === 0 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      geometry.width <= 0 ||
      geometry.height <= 0 ||
      geometry.cols <= 0 ||
      geometry.rows <= 0
    ) return null;

    const rowHeight = geometry.height / geometry.rows;
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
      ? event.deltaY / (rowHeight / 2)
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * geometry.rows
        : event.deltaY;
    this.pendingLines += lines;
    const wholeLines = Math.trunc(this.pendingLines);
    if (wholeLines === 0) return "";

    // xterm 5.5 collapses any wheel event to one mouse report, even when a
    // single trackpad event spans many rows. Preserve the gesture's distance.
    const count = Math.min(Math.abs(wholeLines), MAX_REPORTS_PER_EVENT);
    this.pendingLines %= 1;
    const column = clamp(
      Math.floor(((event.clientX - geometry.left) / geometry.width) * geometry.cols) + 1,
      1,
      geometry.cols
    );
    const row = clamp(
      Math.floor(((event.clientY - geometry.top) / geometry.height) * geometry.rows) + 1,
      1,
      geometry.rows
    );
    const button = wholeLines < 0 ? 64 : 65;
    return `\x1b[<${button};${column};${row}M`.repeat(count);
  }
}
