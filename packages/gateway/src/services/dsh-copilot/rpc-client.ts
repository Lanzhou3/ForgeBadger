/**
 * Minimal newline-delimited JSON-RPC client for the dsh SDK stdio protocol.
 *
 * Speaks the three request methods (`initialize`, `session/prompt`,
 * `session/inject`, `shutdown`) and dispatches server notifications
 * (`session.event`, `session.status`, `subagent.*`) to a single subscriber.
 * One runtime process serves one user and one active run at a time (enforced
 * upstream), so a single notification handler is sufficient.
 *
 * M3: the runtime may also send server->client requests (currently
 * `approval/decide`, emitted while an operate tool waits on owner approval).
 * `onRequest` installs the handler; unknown methods are answered with a
 * JSON-RPC error so the runtime never hangs on an unanswered frame.
 *
 * The client is stream-based: the process manager wires child stdio, tests
 * wire a fake runtime's stdio — no process logic lives here.
 */
import type { Readable, Writable } from "node:stream";

export interface DshNotification {
  method: string;
  params?: Record<string, unknown> | undefined;
}

/** Inbound server->client request handler; the result is serialized back. */
export type DshRequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class DshRpcError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "DshRpcError";
  }
}

export class DshRpcClient {
  private nextId = 1;
  private buffer = "";
  private closed = false;
  private readonly pending = new Map<number, PendingRequest>();
  private notificationHandler: ((notification: DshNotification) => void) | undefined;
  private requestHandler: DshRequestHandler | undefined;

  constructor(
    private readonly input: Writable,
    output: Readable
  ) {
    output.on("data", (chunk: Buffer | string) => this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  }

  /** Subscribe to server notifications; one active handler at a time. */
  onNotification(handler: ((notification: DshNotification) => void) | undefined): void {
    this.notificationHandler = handler;
  }

  /** Handle inbound server->client requests (e.g. `approval/decide`). */
  onRequest(handler: DshRequestHandler | undefined): void {
    this.requestHandler = handler;
  }

  /** Send one request and await its correlated response. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new DshRpcError(`dsh rpc client is closed (method ${method})`));
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.input.write(`${frame}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  /** Reject every pending request and stop dispatching (runtime exit/EOF). */
  failAll(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    const error = new DshRpcError(reason);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.notificationHandler = undefined;
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line !== "") this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let frame: { id?: number | string; result?: unknown; error?: { code?: number; message?: string }; method?: string; params?: Record<string, unknown> };
    try {
      frame = JSON.parse(line) as typeof frame;
    } catch {
      return; // Non-JSON stdout noise must not wedge the protocol reader.
    }
    // Inbound request: id + method. The runtime uses string ids; the client's
    // own outbound requests use numeric ids, so responses never land here.
    if (typeof frame.method === "string" && frame.id !== undefined) {
      this.onInboundRequest(frame.id, frame.method, frame.params ?? {});
      return;
    }
    if (typeof frame.id === "number" && (("result" in frame) || ("error" in frame))) {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      if (frame.error) {
        pending.reject(new DshRpcError(frame.error.message ?? "dsh rpc error", frame.error.code));
      } else {
        pending.resolve(frame.result);
      }
      return;
    }
    if (typeof frame.method === "string") {
      this.notificationHandler?.({ method: frame.method, params: frame.params });
    }
  }

  /** Answer one inbound request; handler failure becomes a -32603 error frame. */
  private onInboundRequest(id: number | string, method: string, params: Record<string, unknown>): void {
    const handler = this.requestHandler;
    if (!handler) {
      this.writeFrame({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
      return;
    }
    void Promise.resolve()
      .then(() => handler(method, params))
      .then(
        (result) => this.writeFrame({ jsonrpc: "2.0", id, result: result ?? {} }),
        (error: unknown) => this.writeFrame({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
        })
      );
  }

  private writeFrame(frame: Record<string, unknown>): void {
    if (this.closed) return;
    this.input.write(`${JSON.stringify(frame)}\n`);
  }
}
