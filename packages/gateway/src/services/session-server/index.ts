/**
 * Session Server module — the single terminal backend: direct node-pty management.
 *
 * This module provides:
 *   - SessionServer: core pty session management
 *   - IpcServer: IPC server for Gateway communication
 *   - TerminalScreen: per-session headless VT emulator (capture/inspect/replay)
 *   - Platform adapters for Windows/POSIX
 *   - IPC protocol types
 */
export { SessionServer, type SessionServerOptions, type AttachResult } from "./session-server.js";
export { IpcServer, type IpcServerOptions, startSessionServer } from "./ipc-server.js";
export { SessionHandle, type SessionHandleOptions, clientPauseSource } from "./session-handle.js";
export {
  TerminalScreen,
  type TerminalScreenOptions,
  DEFAULT_SCROLLBACK_LINES,
  DEFAULT_HIGH_WATER_BYTES,
  DEFAULT_LOW_WATER_BYTES
} from "./terminal-screen.js";
export { createPlatformAdapter, type PlatformPtyAdapter } from "./platform-adapter.js";
export { buildSanitizedEnv } from "./env-policy.js";
export {
  SESSION_SERVER_TOKEN_FILE_NAME,
  generateSessionServerToken,
  readSessionServerTokenFile,
  resolveSessionServerTokenPath,
  writeSessionServerTokenFile
} from "./auth-token.js";
export { performClientHello } from "./hello-handshake.js";
export {
  PROTOCOL_VERSION,
  type HelloMessage,
  type HelloOkResponse,
  type HelloErrorResponse,
  type ManagementRequest,
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
  ShutdownServerRequest,
  AttachClientMessage,
  DetachClientMessage,
  ClientInputMessage,
  ClientResizeMessage,
  ClientOutputMessage,
  AttachAckMessage,
  SessionExitMessage
} from "./ipc-protocol.js";
