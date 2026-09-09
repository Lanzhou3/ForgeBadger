/**
 * IPC protocol for the Session Server.
 *
 * Communication between the Gateway and Session Server uses newline-delimited
 * JSON (NDJSON) over a Unix Domain Socket (POSIX) or Named Pipe (Windows).
 *
 * Two connection types exist:
 *   - Management: single long-lived connection for lifecycle commands
 *   - I/O stream: one per attached client, for terminal input/output
 *
 * All messages share a common envelope: { id?, type, ...payload }
 *   - `id` is present on request/response pairs (correlation)
 *   - `type` identifies the message kind
 *
 * Every connection must complete a hello handshake before any other message:
 * the first line the client sends must be a HelloMessage carrying the shared
 * token and protocol version; the server replies hello_ok / hello_error.
 */

/**
 * Protocol major version. Bumped on incompatible changes; the default socket
 * path / pipe name carries the same major version so incompatible daemons
 * coexist instead of fighting over one endpoint.
 */
export const PROTOCOL_VERSION = 1;

export interface HelloMessage {
  type: "hello";
  protocolVersion: number;
  token: string;
}

export interface HelloOkResponse {
  type: "hello_ok";
  protocolVersion: number;
  /** Daemon process id — lets the Gateway distinguish a reused daemon from a respawned one. */
  pid: number;
  /** Daemon start time (ISO 8601); together with pid it identifies a daemon instance. */
  startedAt: string;
}

export interface HelloErrorResponse {
  type: "hello_error";
  message: string;
  protocolVersion: number;
}

// ---------------------------------------------------------------------------
// Management messages (Gateway → Session Server)
// ---------------------------------------------------------------------------

export interface CreateSessionRequest {
  id: string;
  type: "create_session";
  sessionId: string;
  userId: string;
  attachToken: string;
  launchPlan: LaunchPlanPayload;
}

export interface KillSessionRequest {
  id: string;
  type: "kill_session";
  sessionId: string;
}

export interface ListSessionsRequest {
  id: string;
  type: "list_sessions";
}

export interface HasSessionRequest {
  id: string;
  type: "has_session";
  sessionId: string;
}

export interface CapturePaneRequest {
  id: string;
  type: "capture_pane";
  sessionId: string;
}

export interface ShowEnvironmentRequest {
  id: string;
  type: "show_environment";
  sessionId: string;
}

export interface ResizeWindowRequest {
  id: string;
  type: "resize_window";
  sessionId: string;
  cols: number;
  rows: number;
}

export interface SendInputRequest {
  id: string;
  type: "send_input";
  sessionId: string;
  data: string;
}

export interface InspectPaneRequest {
  id: string;
  type: "inspect_pane";
  sessionId: string;
}

export interface StageProgrammaticInputRequest {
  id: string;
  type: "stage_programmatic_input";
  sessionId: string;
  data: string;
}

export interface PressEnterRequest {
  id: string;
  type: "press_enter";
  sessionId: string;
}

export interface ConfigureSessionRequest {
  id: string;
  type: "configure_session";
  sessionId: string;
}

/**
 * Ask the daemon to destroy every session and exit. This is an explicit
 * maintenance path (tests, future CLI commands) — the Gateway's normal
 * shutdown only disconnects and must never kill the daemon.
 */
export interface ShutdownServerRequest {
  id: string;
  type: "shutdown_server";
}

export type ManagementRequest =
  | CreateSessionRequest
  | KillSessionRequest
  | ListSessionsRequest
  | HasSessionRequest
  | CapturePaneRequest
  | ShowEnvironmentRequest
  | ResizeWindowRequest
  | SendInputRequest
  | InspectPaneRequest
  | StageProgrammaticInputRequest
  | PressEnterRequest
  | ConfigureSessionRequest
  | ShutdownServerRequest;

// ---------------------------------------------------------------------------
// Management responses (Session Server → Gateway)
// ---------------------------------------------------------------------------

export interface OkResponse {
  id: string;
  type: "ok";
  data?: unknown;
}

export interface ErrorResponse {
  id: string;
  type: "error";
  message: string;
}

export type ManagementResponse = OkResponse | ErrorResponse;

// ---------------------------------------------------------------------------
// I/O stream messages (bidirectional, per attached client)
// ---------------------------------------------------------------------------

/** Gateway → Session Server: a client wants to attach to a session */
export interface AttachClientMessage {
  type: "attach_client";
  sessionId: string;
  clientId: string;
}

/** Gateway → Session Server: a client is detaching */
export interface DetachClientMessage {
  type: "detach_client";
  sessionId: string;
  clientId: string;
}

/** Gateway → Session Server: terminal input from a client */
export interface ClientInputMessage {
  type: "client_input";
  sessionId: string;
  clientId: string;
  data: string;
}

/** Gateway → Session Server: terminal resize from a client */
export interface ClientResizeMessage {
  type: "client_resize";
  sessionId: string;
  clientId: string;
  cols: number;
  rows: number;
}

export type IoStreamRequest =
  | AttachClientMessage
  | DetachClientMessage
  | ClientInputMessage
  | ClientResizeMessage;

/** Session Server → Gateway: terminal output for a client */
export interface ClientOutputMessage {
  type: "client_output";
  sessionId: string;
  clientId: string;
  data: string;
}

/** Session Server → Gateway: the session's CLI process exited */
export interface SessionExitMessage {
  type: "session_exit";
  sessionId: string;
  exitCode: number;
}

export type IoStreamResponse = ClientOutputMessage | SessionExitMessage;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface LaunchPlanPayload {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  secretEnvNames: string[];
  credentialMode: "stored_encrypted_key" | "host_environment";
}

export interface PaneSnapshot {
  content: string;
  dead: boolean;
  inMode: boolean;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  status: "running" | "exited" | "error";
}
