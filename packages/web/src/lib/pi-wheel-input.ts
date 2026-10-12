interface WheelGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
}

type ReportSink = (data: string) => void;

/** Pixel delta of one physical mouse-wheel notch (Windows default is 120). */
const NOTCH_DELTA = 100;
/** Tail smaller than this is dropped as gesture noise. */
const TAIL_DELTA = 25;
/** Emit the accumulated tail this long after the last wheel event. */
const TAIL_FLUSH_MS = 100;
/** Assumed pixel height of one line-delta wheel unit (Safari / legacy mice). */
const LINE_DELTA_PX = 40;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * PI's fullscreen TUI consumes SGR wheel reports. A real terminal receives
 * OS-coalesced wheel messages (one per notch batch), but browsers deliver a
 * single notch or trackpad sweep as several raw wheel events. Forwarding
 * every event as a report multiplies the report rate, and PI's wheel
 * accelerator (1..6 lines per report, faster cadence = more lines) turns
 * that into fly-scrolling.
 *
 * Coalesce like the OS does: one SGR report per accumulated notch, plus one
 * tail report shortly after the gesture stops so micro-flicks still land.
 * The cadence that reaches PI then matches a real terminal's, and PI's own
 * accelerator decides the speed — no amplification here (unlike codex,
 * which scrolls one line per report without acceleration).
 */
export class PiWheelInput {
  private pending = 0;
  private lastX = 0;
  private lastY = 0;
  private tailTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly sink: ReportSink) {}

  /**
   * Accumulate one wheel event. Returns the SGR report to send now (one per
   * accumulated notch), `""` while still accumulating, or `null` when the
   * event must not be forwarded at all (modifier gesture, invalid geometry).
   */
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
    ) {
      return null;
    }
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.pending +=
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * LINE_DELTA_PX
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * geometry.height
          : event.deltaY;
    this.scheduleTailFlush(geometry);
    const notches = Math.trunc(this.pending / NOTCH_DELTA);
    if (notches === 0) return "";
    this.pending -= notches * NOTCH_DELTA;
    return this.report(notches < 0 ? 64 : 65, geometry);
  }

  dispose(): void {
    if (this.tailTimer !== null) clearTimeout(this.tailTimer);
    this.tailTimer = null;
    this.pending = 0;
  }

  private scheduleTailFlush(geometry: WheelGeometry): void {
    if (this.tailTimer !== null) clearTimeout(this.tailTimer);
    this.tailTimer = setTimeout(() => {
      this.tailTimer = null;
      if (Math.abs(this.pending) < TAIL_DELTA) {
        this.pending = 0;
        return;
      }
      const data = this.report(this.pending < 0 ? 64 : 65, geometry);
      this.pending = 0;
      this.sink(data);
    }, TAIL_FLUSH_MS);
  }

  private report(button: number, geometry: WheelGeometry): string {
    const column = clamp(
      Math.floor(((this.lastX - geometry.left) / geometry.width) * geometry.cols) + 1,
      1,
      geometry.cols
    );
    const row = clamp(
      Math.floor(((this.lastY - geometry.top) / geometry.height) * geometry.rows) + 1,
      1,
      geometry.rows
    );
    return `\x1b[<${button};${column};${row}M`;
  }
}
