type OutputType = "terminal_history" | "terminal_output";
interface OutputFrame { type: OutputType; payload: { data: string; sequence: number } }
interface Options {
  send: (frame: OutputFrame) => void;
  pause: (paused: boolean) => void;
  fail: () => void;
  highWater?: number;
  chunkSize?: number;
  maxQueued?: number;
  ackTimeoutMs?: number;
}

/** Per-WebSocket render acknowledgements. Counters use UTF-16 units consistently.
 * IPC reads pause until xterm has parsed the outstanding frames; its socket
 * backpressure then reaches the daemon. A stalled browser loses only its attach.
 */
export class TerminalOutputFlow {
  private queue: Array<{ type: OutputType; data: string }> = [];
  private pending = new Map<number, number>();
  private queued = 0;
  private outstanding = 0;
  private sequence = 0;
  private acknowledged = 0;
  private disposed = false;
  private onFinished: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly options: Options) {}

  enqueue(type: OutputType, data: string): void {
    if (this.disposed) return;
    if (this.queued + this.outstanding + data.length > (this.options.maxQueued ?? 16 * 1024 * 1024)) {
      this.fail();
      return;
    }
    const size = this.options.chunkSize ?? 64 * 1024;
    let offset = 0;
    do {
      let end = Math.min(offset + size, data.length);
      if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]!)) end--;
      const chunk = data.slice(offset, end);
      this.queue.push({ type: offset === 0 ? type : "terminal_output", data: chunk });
      this.queued += chunk.length;
      offset = end;
    } while (offset < data.length);
    this.flush();
  }

  acknowledge(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence <= this.acknowledged || sequence > this.sequence) {
      throw new Error("Invalid terminal ACK");
    }
    this.acknowledged = sequence;
    for (const [id, size] of this.pending) {
      if (id > sequence) break;
      this.outstanding -= size;
      this.pending.delete(id);
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    this.flush();
  }

  finish(callback: () => void): void {
    this.onFinished = callback;
    this.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.queue = [];
    this.pending.clear();
    this.options.pause(false);
  }

  private flush(): void {
    if (this.disposed) return;
    const high = this.options.highWater ?? 256 * 1024;
    while (this.queue.length && this.outstanding < high && this.pending.size < 128) {
      const frame = this.queue.shift()!;
      this.queued -= frame.data.length;
      this.outstanding += frame.data.length;
      const sequence = ++this.sequence;
      this.pending.set(sequence, frame.data.length);
      this.options.send({ type: frame.type, payload: { data: frame.data, sequence } });
    }
    this.options.pause(this.queue.length > 0 || this.outstanding >= high || this.pending.size >= 128);
    if (!this.queue.length && !this.pending.size && this.onFinished) {
      const callback = this.onFinished;
      this.onFinished = undefined;
      callback();
    }
    if (this.pending.size && !this.timer) {
      this.timer = setTimeout(() => this.fail(), this.options.ackTimeoutMs ?? 30_000);
      this.timer.unref?.();
    }
  }

  private fail(): void {
    this.dispose();
    this.options.fail();
  }
}
