/**
 * Client-side hello handshake for Session Server IPC connections.
 *
 * Shared by the management client (session-server-client.ts) and the I/O
 * stream client (session-server-pty.ts): after the socket connects, the
 * client sends a HelloMessage and resolves once the server replies hello_ok.
 * Any hello_error, close, or timeout rejects the promise.
 */
import type { Socket } from "node:net";

import { PROTOCOL_VERSION } from "./ipc-protocol.js";

interface HelloReply {
  type?: string;
  message?: string;
  protocolVersion?: number;
  pid?: number;
  startedAt?: string;
}

/**
 * Send hello and wait for hello_ok. Returns the daemon identity (pid /
 * startedAt, used for reuse logging and restart detection) plus any bytes
 * received after the hello_ok line so the caller can seed its line buffer.
 */
export interface ClientHelloResult {
  leftover: string;
  pid?: number | undefined;
  startedAt?: string | undefined;
}

export function performClientHello(
  socket: Socket,
  token: string,
  timeoutMs: number
): Promise<ClientHelloResult> {
  socket.setEncoding("utf8");
  return new Promise<ClientHelloResult>((resolve, reject) => {
    let buffer = "";

    function cleanup(): void {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    }

    function fail(error: Error): void {
      cleanup();
      reject(error);
    }

    function onData(chunk: string): void {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex);
      const rest = buffer.slice(newlineIndex + 1);
      let msg: HelloReply;
      try {
        msg = JSON.parse(line) as HelloReply;
      } catch {
        fail(new Error("Invalid hello response from Session Server"));
        return;
      }
      if (msg.type === "hello_ok") {
        cleanup();
        resolve({ leftover: rest, pid: msg.pid, startedAt: msg.startedAt });
        return;
      }
      if (msg.type === "hello_error") {
        const detail = msg.message ?? "unknown";
        fail(new Error(`Session Server hello rejected: ${detail} (server protocol v${msg.protocolVersion ?? "?"})`));
        return;
      }
      fail(new Error(`Unexpected first message from Session Server: ${msg.type ?? "unknown"}`));
    }

    function onError(error: Error): void {
      fail(error);
    }

    function onClose(): void {
      fail(new Error("Session Server closed the connection during hello"));
    }

    const timer = setTimeout(() => {
      fail(new Error(`Session Server hello timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.write(`${JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, token })}\n`);
  });
}
