import WebSocket from "ws";

import type {
  CodexAppServerChild,
  CodexAppServerSession
} from "./codex-app-server-manager.js";
import type { CodexAppServerTransport } from "./codex-app-server-client.js";

export interface WebSocketTransportFactoryOptions {
  headers?: Record<string, string>;
}

export interface WebSocketTransportConnection {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", handler: () => void): this;
  on(event: "message", handler: (data: unknown) => void): this;
  on(event: "close", handler: (code: number, reason: Buffer) => void): this;
  on(event: "error", handler: (error: Error) => void): this;
}

export type WebSocketTransportFactory = (
  url: string,
  options: WebSocketTransportFactoryOptions
) => WebSocketTransportConnection;

export function createCodexAppServerTransport(
  session: CodexAppServerSession,
  child: CodexAppServerChild,
  webSocketFactory = createNodeWebSocketConnection
): CodexAppServerTransport | undefined {
  if (session.runtimeMode === "app-server-stdio" && child.stdin && child.stdout) {
    return new StdioJsonLineTransport(child);
  }

  if (session.runtimeMode === "app-server-websocket" && session.listen.startsWith("ws://")) {
    return new WebSocketJsonRpcTransport({
      url: session.listen,
      bearerToken: session.token,
      connect: webSocketFactory
    });
  }

  return undefined;
}

export class StdioJsonLineTransport implements CodexAppServerTransport {
  private messageHandler: ((raw: string | Buffer) => void) | undefined;
  private closeHandler: ((code?: number, reason?: string) => void) | undefined;
  private buffer = "";

  constructor(private readonly child: CodexAppServerChild) {
    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      let newlineIndex = this.buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const frame = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (frame) this.messageHandler?.(frame);
        newlineIndex = this.buffer.indexOf("\n");
      }
    });
    child.on("exit", () => this.closeHandler?.(1000, "process exited"));
    child.on("error", (error: Error) => this.closeHandler?.(1011, error.message));
  }

  send(data: string): void {
    this.child.stdin?.write(`${data}\n`);
  }

  close(code?: number, reason?: string): void {
    this.child.stdin?.end();
    this.closeHandler?.(code, reason);
  }

  onMessage(handler: (raw: string | Buffer) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (code?: number, reason?: string) => void): void {
    this.closeHandler = handler;
  }
}

export class WebSocketJsonRpcTransport implements CodexAppServerTransport {
  private readonly socket: WebSocketTransportConnection;
  private messageHandler: ((raw: string | Buffer) => void) | undefined;
  private closeHandler: ((code?: number, reason?: string) => void) | undefined;
  private opened = false;
  private closed = false;
  private readonly sendQueue: string[] = [];

  constructor(input: {
    url: string;
    bearerToken?: string | undefined;
    connect?: WebSocketTransportFactory | undefined;
  }) {
    const options = input.bearerToken
      ? { headers: { Authorization: `Bearer ${input.bearerToken}` } }
      : {};
    this.socket = (input.connect ?? createNodeWebSocketConnection)(input.url, options);
    this.socket
      .on("open", () => this.handleOpen())
      .on("message", (data) => this.messageHandler?.(normalizeWebSocketData(data)))
      .on("close", (code, reason) => this.notifyClosed(code, reason.toString()))
      .on("error", () => this.notifyClosed(1011, "Codex app-server websocket error"));
  }

  send(data: string): void {
    if (this.closed) {
      throw new Error("Codex app-server websocket transport is closed");
    }
    if (!this.opened) {
      this.sendQueue.push(data);
      return;
    }
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.sendQueue.length = 0;
    this.socket.close(code, reason);
  }

  onMessage(handler: (raw: string | Buffer) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (code?: number, reason?: string) => void): void {
    this.closeHandler = handler;
  }

  private handleOpen(): void {
    if (this.closed) {
      return;
    }
    this.opened = true;
    for (const payload of this.sendQueue.splice(0)) {
      this.socket.send(payload);
    }
  }

  private notifyClosed(code?: number, reason?: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.sendQueue.length = 0;
    this.closeHandler?.(code, reason);
  }
}

function createNodeWebSocketConnection(
  url: string,
  options: WebSocketTransportFactoryOptions
): WebSocketTransportConnection {
  return new WebSocket(url, options) as unknown as WebSocketTransportConnection;
}

function normalizeWebSocketData(data: unknown): string | Buffer {
  if (typeof data === "string" || Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (Array.isArray(data) && data.every(Buffer.isBuffer)) {
    return Buffer.concat(data);
  }
  return String(data);
}
