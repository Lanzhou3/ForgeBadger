import { EventEmitter } from "node:events";

import type { OpenForgeEvent } from "./event-bus.js";

export type JsonRpcId = string | number;

export interface CodexAppServerRequestEnvelope<TParams extends Record<string, unknown> = Record<string, unknown>> {
  id: JsonRpcId;
  method: string;
  params: TParams;
}

export interface CodexAppServerRequestOptions {
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
}

export interface CodexAppServerNotificationEnvelope<
  TParams extends Record<string, unknown> | undefined = undefined
> {
  method: string;
  params?: TParams;
}

export interface CodexInitializeRequestInput {
  id: JsonRpcId;
  clientVersion: string;
  experimentalApi?: boolean;
  optOutNotificationMethods?: string[];
}

export interface CodexThreadStartRequestInput {
  id: JsonRpcId;
  cwd: string;
  model?: string;
  approvalPolicy?: CodexApprovalPolicy;
  sandbox?: CodexSandboxMode;
}

export interface CodexTurnStartRequestInput {
  id: JsonRpcId;
  threadId: string;
  text: string;
}

export interface CodexAppServerNotificationInput {
  threadId?: string;
  notificationType: string;
  message?: string;
  method?: string;
  status?: "info" | "warning" | "error";
}

export type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexAppServerResponseFrame {
  kind: "response";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface CodexAppServerNotificationFrame {
  kind: "notification";
  method: string;
  params: Record<string, unknown>;
}

export type CodexAppServerFrame =
  | CodexAppServerResponseFrame
  | CodexAppServerNotificationFrame;

export interface CodexAppServerTransport {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (raw: string | Buffer) => void): void;
  onClose(handler: (code?: number, reason?: string) => void): void;
}

export interface CodexAppServerClientOptions {
  transport: CodexAppServerTransport;
  clientVersion: string;
  timeoutMs?: number;
  maxFrameBytes?: number;
  experimentalApi?: boolean;
  optOutNotificationMethods?: string[];
  onNotification?: (notification: CodexAppServerNormalizedNotification) => void;
}

export interface CodexAppServerNormalizedNotification {
  type: "codex_app_server_notification";
  method: string;
  threadId?: string;
  activityType: string;
  status: "info" | "warning" | "error";
  message: string;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortListener?: () => void;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;

export function createCodexAppServerRequestEnvelope<TParams extends Record<string, unknown>>(
  input: CodexAppServerRequestOptions & { params: TParams }
): CodexAppServerRequestEnvelope<TParams> {
  return {
    id: input.id,
    method: input.method,
    params: input.params
  };
}

export function createCodexAppServerNotificationEnvelope<
  TParams extends Record<string, unknown> | undefined = undefined
>(
  input: { method: string; params?: TParams }
): CodexAppServerNotificationEnvelope<TParams> {
  return {
    method: input.method,
    ...(input.params !== undefined ? { params: input.params } : {})
  };
}

export function createCodexAppServerInitializedNotification(): CodexAppServerNotificationEnvelope {
  return createCodexAppServerNotificationEnvelope({ method: "initialized" });
}

export function createCodexAppServerInitializeRequest(
  input: CodexInitializeRequestInput
): CodexAppServerRequestEnvelope<{
  clientInfo: { name: string; title: string; version: string };
  capabilities: { experimentalApi: boolean; optOutNotificationMethods: string[] };
}> {
  return createCodexAppServerRequestEnvelope({
    id: input.id,
    method: "initialize",
    params: {
      clientInfo: {
        name: "openforge",
        title: "OpenForge",
        version: input.clientVersion
      },
      capabilities: {
        experimentalApi: input.experimentalApi ?? false,
        optOutNotificationMethods: input.optOutNotificationMethods ?? []
      }
    }
  });
}

export function createCodexAppServerThreadStartRequest(
  input: CodexThreadStartRequestInput
): CodexAppServerRequestEnvelope<{
  cwd: string;
  model?: string;
  approvalPolicy?: string;
  sandbox?: string;
  serviceName: string;
}> {
  return createCodexAppServerRequestEnvelope({
    id: input.id,
    method: "thread/start",
    params: {
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
      ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
      ...(input.sandbox ? { sandbox: input.sandbox } : {}),
      serviceName: "openforge"
    }
  });
}

export function createCodexAppServerTurnStartRequest(
  input: CodexTurnStartRequestInput
): CodexAppServerRequestEnvelope<{
  threadId: string;
  input: Array<{ type: "text"; text: string; text_elements: [] }>;
}> {
  return createCodexAppServerRequestEnvelope({
    id: input.id,
    method: "turn/start",
    params: {
      threadId: input.threadId,
      input: [{ type: "text", text: input.text, text_elements: [] }]
    }
  });
}

export function createCodexAppServerNotificationEvent(
  input: CodexAppServerNotificationInput
): CodexAppServerNotificationFrame {
  return {
    kind: "notification",
    method: input.method ?? "notification/prompt",
    params: {
      ...(input.threadId ? { threadId: input.threadId } : {}),
      notification: {
        type: input.notificationType,
        message: input.message ?? ""
      }
    }
  };
}

export function parseCodexAppServerFrame(
  raw: string | Buffer,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES
): CodexAppServerFrame {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  if (Buffer.byteLength(text, "utf8") > maxFrameBytes) {
    throw new Error("Malformed Codex app-server frame");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Malformed Codex app-server frame");
  }

  if (!isRecord(value) || (value.jsonrpc !== undefined && value.jsonrpc !== "2.0")) {
    throw new Error("Malformed Codex app-server frame");
  }

  if (typeof value.id === "string" || typeof value.id === "number") {
    if ("result" in value || "error" in value) {
      if ("error" in value && isRecord(value.error)) {
        const code = value.error.code;
        const message = value.error.message;
        if (typeof code === "number" && typeof message === "string") {
          return {
            kind: "response",
            id: value.id,
            ...(value.result !== undefined ? { result: value.result } : {}),
            error: {
              code,
              message,
              ...(value.error.data !== undefined ? { data: value.error.data } : {})
            }
          };
        }
      } else {
        return {
          kind: "response",
          id: value.id,
          ...(value.result !== undefined ? { result: value.result } : {})
        };
      }
    }
  }

  if (
    typeof value.method === "string" &&
    isRecord(value.params)
  ) {
    return {
      kind: "notification",
      method: value.method,
      params: value.params
    };
  }

  throw new Error("Malformed Codex app-server frame");
}

export function normalizeCodexAppServerNotification(
  frame: CodexAppServerFrame
): CodexAppServerNormalizedNotification | null {
  if (frame.kind !== "notification") {
    return null;
  }

  const notification = isRecord(frame.params.notification)
    ? frame.params.notification
    : undefined;
  const threadId = readString(frame.params.threadId) ?? readString(frame.params.thread_id);
  const notificationType = safeProtocolLabel(
    readString(notification?.type) ??
    readString(frame.params.notification_type) ??
    readString(frame.params.hook_event_name) ??
    frame.method,
    "unknown"
  );
  const method = safeProtocolLabel(frame.method, "unknown");
  const status = inputStatusForNotification(notificationType, frame.method);

  return {
    type: "codex_app_server_notification",
    method,
    ...(threadId ? { threadId: safeProtocolLabel(threadId, "unknown") } : {}),
    activityType: notificationType,
    status,
    message: safeNotificationMessage(notificationType, status)
  };
}

function safeNotificationMessage(
  activityType: string,
  status: "info" | "warning" | "error"
): string {
  if (activityType === "permission_prompt") {
    return "Codex app-server permission prompt";
  }
  if (status === "error") {
    return "Codex app-server error notification";
  }
  if (status === "warning") {
    return "Codex app-server warning notification";
  }
  return "Codex app-server notification";
}

function safeProtocolLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_./:-]{1,80}$/.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export class CodexAppServerJsonRpcClient extends EventEmitter {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();

  constructor(private readonly options: CodexAppServerClientOptions) {
    super();
    options.transport.onMessage((raw) => {
      void this.handleRawFrame(raw).catch((error: unknown) => {
        this.closeForProtocolError(error);
      });
    });
    options.transport.onClose(() => {
      this.rejectPending("Codex app-server transport closed");
      this.closed = true;
    });
  }

  async initialize(input?: Partial<Omit<CodexInitializeRequestInput, "id">>): Promise<unknown> {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "openforge",
        title: "OpenForge",
        version: input?.clientVersion ?? this.options.clientVersion
      },
      capabilities: {
        experimentalApi: input?.experimentalApi ?? this.options.experimentalApi ?? false,
        optOutNotificationMethods:
          input?.optOutNotificationMethods ?? this.options.optOutNotificationMethods ?? []
      }
    });
    this.sendNotification(createCodexAppServerInitializedNotification());
    return result;
  }

  async startThread(input: Omit<CodexThreadStartRequestInput, "id">): Promise<unknown> {
    return this.request("thread/start", {
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
      ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
      ...(input.sandbox ? { sandbox: input.sandbox } : {}),
      serviceName: "openforge"
    });
  }

  async startTurn(input: Omit<CodexTurnStartRequestInput, "id">): Promise<unknown> {
    return this.request("turn/start", {
      threadId: input.threadId,
      input: [{ type: "text", text: input.text, text_elements: [] }]
    });
  }

  async request(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) {
      throw new Error("Codex app-server client is closed");
    }

    const id = this.nextId++;
    const request = createCodexAppServerRequestEnvelope({
      id,
      method,
      params
    });
    const payload = JSON.stringify(request);
    if (Buffer.byteLength(payload, "utf8") > (this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES)) {
      throw new Error("Codex app-server request too large");
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = this.options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        const pendingRequest = this.pending.get(id);
        if (pendingRequest) {
          this.cleanupPending(id, pendingRequest);
        }
        reject(new Error(`Codex app-server request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const pending: PendingRequest = {
        resolve,
        reject,
        timeout
      };

      if (signal) {
        const abortListener = () => {
          this.cleanupPending(id, pending);
          reject(new Error("Codex app-server request cancelled"));
        };
        if (signal.aborted) {
          abortListener();
          return;
        }
        signal.addEventListener("abort", abortListener, { once: true });
        pending.abortSignal = signal;
        pending.abortListener = abortListener;
      }

      this.pending.set(id, pending);
      try {
        this.options.transport.send(payload);
      } catch (error) {
        this.cleanupPending(id, pending);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async handleRawFrame(raw: string | Buffer): Promise<void> {
    const frame = parseCodexAppServerFrame(raw, this.options.maxFrameBytes);
    if (frame.kind === "response") {
      this.resolveResponse(frame);
      return;
    }

    const notification = normalizeCodexAppServerNotification(frame);
    if (notification) {
      this.options.onNotification?.(notification);
      this.emit("notification", notification);
    }
  }

  close(code = 1000, reason = "client closed"): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectPending("Codex app-server client is closed");
    this.options.transport.close(code, reason);
  }

  private sendNotification(notification: CodexAppServerNotificationEnvelope): void {
    const payload = JSON.stringify(notification);
    if (Buffer.byteLength(payload, "utf8") > (this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES)) {
      throw new Error("Codex app-server notification too large");
    }
    this.options.transport.send(payload);
  }

  private resolveResponse(frame: CodexAppServerResponseFrame): void {
    const pending = this.pending.get(frame.id);
    if (!pending) {
      return;
    }
    this.cleanupPending(frame.id, pending);
    if ("error" in frame && frame.error) {
      pending.reject(new Error(frame.error.message));
      return;
    }
    pending.resolve(frame.result);
  }

  private rejectPending(message: string): void {
    for (const [id, pending] of this.pending) {
      this.cleanupPending(id, pending);
      pending.reject(new Error(message));
    }
  }

  private cleanupPending(id: JsonRpcId, pending: PendingRequest): void {
    clearTimeout(pending.timeout);
    if (pending.abortSignal && pending.abortListener) {
      pending.abortSignal.removeEventListener("abort", pending.abortListener);
    }
    this.pending.delete(id);
  }

  private closeForProtocolError(error: unknown): void {
    if (this.closed) {
      return;
    }
    const protocolError = error instanceof Error ? error : new Error(String(error));
    this.closed = true;
    this.rejectPending(protocolError.message);
    if (this.listenerCount("error") > 0) {
      this.emit("error", protocolError);
    }
    this.options.transport.close(1002, "Malformed Codex app-server frame");
  }
}

function inputStatusForNotification(notificationType: string, method: string): "info" | "warning" | "error" {
  const normalized = `${notificationType} ${method}`.toLowerCase();
  if (normalized.includes("permission") || normalized.includes("ask") || normalized.includes("approval")) {
    return "warning";
  }
  if (normalized.includes("error") || normalized.includes("fail")) {
    return "error";
  }
  return "info";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
