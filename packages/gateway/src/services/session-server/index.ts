/**
 * Session Server module — replaces tmux/psmux with direct node-pty management.
 *
 * This module provides:
 *   - SessionServer: core pty session management
 *   - IpcServer: IPC server for Gateway communication
 *   - Platform adapters for Windows/POSIX
 *   - IPC protocol types
 */
export { SessionServer, type SessionServerOptions } from "./session-server.js";
export { IpcServer, type IpcServerOptions, startSessionServer } from "./ipc-server.js";
export { SessionHandle, type SessionHandleOptions } from "./session-handle.js";
export { OutputRingBuffer, MAX_CHARS_PER_SESSION, MAX_LINES_DEFAULT } from "./output-ring-buffer.js";
export { createPlatformAdapter, type PlatformPtyAdapter } from "./platform-adapter.js";
export type {
  ManagementRequest,
  ManagementResponse,
  IoStreamRequest,
  IoStreamResponse,
  LaunchPlanPayload,
  PaneSnapshot,
  SessionInfo,
  CreateSessionRequest,
  KillSessionRequest,
  ListSessionsRequest,
  HasSessionRequest,
  CapturePaneRequest,
  ShowEnvironmentRequest,
  ResizeWindowRequest,
  SendInputRequest,
  InspectPaneRequest,
  StageProgrammaticInputRequest,
  PressEnterRequest,
  ConfigureSessionRequest,
  AttachClientMessage,
  DetachClientMessage,
  ClientInputMessage,
  ClientResizeMessage,
  ClientOutputMessage,
  SessionExitMessage
} from "./ipc-protocol.js";
