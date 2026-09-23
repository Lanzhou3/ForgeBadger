import type {ConfirmedStopReceipt,RuntimeGeneration,DaemonIdentity} from './session-server/confirmed-stop.js';
import type {SessionInfo} from './session-server/ipc-protocol.js';
/**
 * Terminal backend client contract.
 *
 * The Session Server daemon (services/session-server/*) is the single terminal
 * backend: it owns the pty processes, the per-session headless screens, and
 * the IPC surface this interface is translated onto. `SessionServerClient`
 * is the production implementation.
 *
 * `name` identifies a Session Server session using the configured prefix
 * and the user/session IDs. It is persisted as runtime_session_name.
 */
export interface TerminalSessionOptions {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  launchNonce?: string | undefined;
  expectedDaemon?: DaemonIdentity | undefined;
}

export interface BackendPaneSnapshot {
  /** Rendered current-viewport text (headless screen buffer API). */
  content: string;
  dead: boolean;
}

export interface TerminalBackendClient {
  supportsConfirmedSessionStop?():boolean;
  confirmedStopAuthority?():Promise<DaemonIdentity|null>;
  getServerIdentity?():DaemonIdentity|undefined;
  confirmedStop?(generation:RuntimeGeneration):Promise<ConfirmedStopReceipt|null>;
  confirmedStopStatus?(generation:RuntimeGeneration):Promise<ConfirmedStopReceipt|null>;
  createSession(options: TerminalSessionOptions): Promise<void>;
  killSession(name: string): Promise<void>;
  capturePane(name: string): Promise<string>;
  listSessions(): Promise<string[]>;
  /** Full runtime rows (id + status) for the force-delete liveness gate. */
  listSessionInfos?(): Promise<SessionInfo[]>;
  hasSession(name: string): Promise<boolean>;
  showEnvironment?(name: string): Promise<Record<string, string>>;
  resizeWindow?(name: string, cols: number, rows: number): Promise<void>;
  sendInput?(name: string, data: string): Promise<void>;
  inspectPane?(name: string): Promise<BackendPaneSnapshot>;
  stageProgrammaticInput?(name: string, data: string): Promise<void>;
  pressEnter?(name: string): Promise<void>;
  /**
   * Connection health for launch gating (adapter discovery / dependencies
   * report). Clients without a health signal are assumed available.
   */
  isAvailable?(): boolean;
}
