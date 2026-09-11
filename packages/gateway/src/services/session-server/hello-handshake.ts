/**
 * Client-side hello handshake for Session Server IPC connections.
 *
 * Shared by the management client (session-server-client.ts) and the I/O
 * stream client (session-server-pty.ts): after the socket connects, the
 * client sends a HelloMessage and resolves once the server replies hello_ok.
 * Any hello_error, close, or timeout rejects the promise.
 */
import type { Socket } from "node:net";

import { isRecord } from "./ipc-validation.js";
import { PROTOCOL_VERSION } from "./ipc-protocol.js";

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
      if (Buffer.byteLength(buffer) > 64 * 1024) {
        fail(new Error("Session Server hello exceeds size limit"));
        return;
      }
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex);
      const rest = buffer.slice(newlineIndex + 1);
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        fail(new Error("Invalid hello response from Session Server"));
        return;
      }
      if (!isRecord(msg) || typeof msg.type !== "string") {
        fail(new Error("Invalid hello response from Session Server")); return;
      }
      if (msg.type === "hello_ok") {
        if (typeof msg.protocolVersion === "number" && Number.isSafeInteger(msg.protocolVersion)
          && msg.protocolVersion > 0 && msg.protocolVersion !== PROTOCOL_VERSION) {
          fail(new Error(`Incompatible Session Server protocol version: server v${msg.protocolVersion}, Gateway requires v${PROTOCOL_VERSION}. Finish or explicitly stop active sessions, then restart the Session Server and Gateway. Existing sessions were not stopped.`));
          return;
        }
        if (msg.protocolVersion !== PROTOCOL_VERSION || !Number.isSafeInteger(msg.pid)
          || typeof msg.pid !== "number" || msg.pid <= 0 || typeof msg.startedAt !== "string"
          || !Number.isFinite(Date.parse(msg.startedAt))) {
          fail(new Error("Invalid Session Server hello identity or protocol version")); return;
        }
        cleanup();
        resolve({ leftover: rest, pid: msg.pid, startedAt: msg.startedAt });
        return;
      }
      if (msg.type === "hello_error") {
        if (typeof msg.message !== "string" || typeof msg.protocolVersion !== "number"
          || !Number.isSafeInteger(msg.protocolVersion) || msg.protocolVersion < 1) {
          fail(new Error("Invalid hello error response from Session Server")); return;
        }
        fail(new Error(`Session Server hello rejected: ${msg.message} (server protocol v${msg.protocolVersion}, Gateway requires v${PROTOCOL_VERSION}). If incompatible, finish or explicitly stop active sessions, then restart the Session Server and Gateway. Existing sessions were not stopped.`));
        return;
      }
      fail(new Error("Unexpected first message from Session Server"));
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
