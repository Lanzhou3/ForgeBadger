/**
 * Per-session headless terminal screen.
 *
 * Each session owns one @xterm/headless Terminal that absorbs all pty output,
 * so capture/inspect/replay operate on the *rendered* screen (tmux
 * capture-pane semantics) instead of a raw byte stream:
 *   - capture / attach snapshot  -> SerializeAddon output (ANSI preserved)
 *   - inspect (programmatic submit composer detection) -> buffer API
 *     (`translateToString(true)`), never parsed serialize output
 *
 * Hard engineering rules baked in here:
 *   1. Write-callback watermark flow control: xterm.js drops data silently
 *      once its internal write buffer grows unboundedly, so `write()` tracks
 *      pending callbacks and pauses the pty above a high watermark, resuming
 *      below a low watermark.
 *   2. Resize is applied to the headless terminal in lockstep with the pty.
 *   3. Screen sampling (capture/inspect/snapshot) must wait for the write
 *      queue to drain (`whenIdle`) or it reads a stale frame.
 *   4. Scrollback replaces the tmux `history-limit 10000` default.
 */
import xtermHeadless from "@xterm/headless";
import addonSerialize from "@xterm/addon-serialize";

const { Terminal } = xtermHeadless;
const { SerializeAddon } = addonSerialize;

type HeadlessTerminal = InstanceType<typeof Terminal>;

export const DEFAULT_SCROLLBACK_LINES = 10_000;
export const DEFAULT_HIGH_WATER_BYTES = 2 * 1024 * 1024;
export const DEFAULT_LOW_WATER_BYTES = 512 * 1024;
export const DEFAULT_IDLE_TIMEOUT_MS = 1_000;

export interface TerminalScreenOptions {
  cols: number;
  rows: number;
  scrollback?: number;
  highWaterBytes?: number;
  lowWaterBytes?: number;
  /** Max wait for the write queue to drain before sampling anyway. */
  idleTimeoutMs?: number;
  /** Wired to pty.pause()/pty.resume() by the owning SessionHandle. */
  onFlowPauseChange?: ((paused: boolean) => void) | undefined;
}

export class TerminalScreen {
  private readonly term: HeadlessTerminal;
  private readonly serializer: InstanceType<typeof SerializeAddon>;
  private readonly highWaterBytes: number;
  private readonly lowWaterBytes: number;
  private readonly idleTimeoutMs: number;
  private readonly onFlowPauseChange: ((paused: boolean) => void) | undefined;
  private pendingWrites = 0;
  private pendingBytes = 0;
  private flowPaused = false;
  private holdCount = 0;
  private appliedPause = false;
  private readonly idleWaiters = new Set<() => void>();
  private disposed = false;

  constructor(options: TerminalScreenOptions) {
    this.highWaterBytes = options.highWaterBytes ?? DEFAULT_HIGH_WATER_BYTES;
    this.lowWaterBytes = options.lowWaterBytes ?? DEFAULT_LOW_WATER_BYTES;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.onFlowPauseChange = options.onFlowPauseChange;
    this.term = new Terminal({
      cols: options.cols,
      rows: options.rows,
      scrollback: options.scrollback ?? DEFAULT_SCROLLBACK_LINES,
      // The buffer API and SerializeAddon are "proposed API" in the 5.5 line.
      allowProposedApi: true
    });
    this.serializer = new SerializeAddon();
    this.term.loadAddon(this.serializer);
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  get paused(): boolean {
    return this.appliedPause;
  }

  /** Bytes still queued in the xterm write buffer (flow-control signal). */
  get pendingWriteBytes(): number {
    return this.pendingBytes;
  }

  /**
   * Feed pty output into the emulator. The write callback fires once xterm
   * has parsed the chunk; pending-byte accounting drives pty flow control.
   * `data.length` (UTF-16 units) approximates bytes — good enough for a
   * watermark that lives orders of magnitude below xterm's internal limit.
   */
  write(data: string): void {
    if (this.disposed || data.length === 0) return;
    const size = data.length;
    this.pendingWrites += 1;
    this.pendingBytes += size;
    this.term.write(data, () => this.handleWriteDone(size));
    if (this.pendingBytes >= this.highWaterBytes) {
      this.setFlowPaused(true);
    }
  }

  private handleWriteDone(size: number): void {
    this.pendingWrites -= 1;
    this.pendingBytes -= size;
    if (this.flowPaused && this.pendingBytes <= this.lowWaterBytes) {
      this.setFlowPaused(false);
    }
    if (this.pendingWrites === 0) {
      this.notifyIdle();
    }
  }

  private setFlowPaused(paused: boolean): void {
    this.flowPaused = paused;
    this.applyPauseState();
  }

  /**
   * External pause hold (attach quiesce). Independent of the flow-control
   * watermark; the pty resumes only when every hold and the watermark clear.
   */
  acquirePauseHold(): () => void {
    this.holdCount += 1;
    this.applyPauseState();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holdCount -= 1;
      this.applyPauseState();
    };
  }

  private applyPauseState(): void {
    const wantPause = this.flowPaused || this.holdCount > 0;
    if (wantPause === this.appliedPause) return;
    this.appliedPause = wantPause;
    this.onFlowPauseChange?.(wantPause);
  }

  private notifyIdle(): void {
    for (const waiter of [...this.idleWaiters]) {
      waiter();
    }
  }

  /** Resolve once every queued write has been parsed (or after a timeout). */
  whenIdle(timeoutMs = this.idleTimeoutMs): Promise<void> {
    if (this.pendingWrites === 0 || this.disposed) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const waiter = (): void => {
        clearTimeout(timer);
        this.idleWaiters.delete(waiter);
        resolve();
      };
      const timer = setTimeout(() => {
        this.idleWaiters.delete(waiter);
        resolve();
      }, timeoutMs);
      timer.unref?.();
      this.idleWaiters.add(waiter);
    });
  }

  /** Resize the rendered geometry; callers must resize the pty in the same step. */
  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    this.term.resize(cols, rows);
  }

  /** Serialize scrollback (up to `scrollbackLines`) + screen, ANSI preserved. */
  serializeCapture(scrollbackLines: number): string {
    return this.serializer.serialize({ scrollback: scrollbackLines });
  }

  /** Full-fidelity snapshot for attach replay: entire scrollback, screen,
   *  alt-screen state, modes and cursor position. */
  serializeSnapshot(): string {
    return this.serializer.serialize();
  }

  /** Rendered text of the current viewport (post-escape-interpretation). */
  renderViewport(): string {
    const buffer = this.term.buffer.active;
    const start = buffer.viewportY;
    const lines: string[] = [];
    for (let y = start; y < start + this.term.rows; y += 1) {
      lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.notifyIdle();
    this.idleWaiters.clear();
    this.term.dispose();
  }
}
