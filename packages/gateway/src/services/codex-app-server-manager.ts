import { randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import type { CredentialMode } from "../adapters/claude.js";
import {
  createCodexAppServerLaunchPlan,
  type CodexAppServerAuth,
  type CodexAppServerLaunchPlanInput
} from "./codex-app-server.js";
import {
  CodexAppServerJsonRpcClient,
  type CodexAppServerTransport,
  type CodexThreadStartRequestInput,
  type CodexTurnStartRequestInput
} from "./codex-app-server-client.js";

export type CodexAppServerRuntimeMode = "app-server-stdio" | "app-server-websocket";
export type CodexAppServerStatus = "running" | "stopped" | "error";

export interface CodexAppServerChild extends Pick<EventEmitter, "on"> {
  pid?: number | undefined;
  stdin?: { write(data: string): boolean; end(): void } | null | undefined;
  stdout?: Pick<EventEmitter, "on"> | null | undefined;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface CodexAppServerSession {
  id: string;
  userId: string;
  projectId: string;
  projectRoot: string;
  runtimeMode: CodexAppServerRuntimeMode;
  status: CodexAppServerStatus;
  command: string;
  args: string[];
  listen: string;
  pid?: number | undefined;
  token?: string | undefined;
  tokenFile?: string | undefined;
  errorMessage?: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface CodexAppServerNotificationEvent {
  userId: string;
  projectId: string;
  appServerSessionId: string;
  threadId?: string | undefined;
  activityType: string;
  status: "info" | "warning" | "error";
  method: string;
  message: string;
}

export interface StartCodexAppServerInput {
  userId: string;
  projectId: string;
  projectRoot: string;
  credentialMode: CredentialMode;
  runtimeMode: CodexAppServerRuntimeMode;
  env?: Record<string, string>;
  secretEnvNames?: string[];
}

export interface CodexAppServerManagerOptions {
  runtimeRoot: string;
  perUserLimit?: number;
  clientVersion?: string;
  requestTimeoutMs?: number;
  maxFrameBytes?: number;
  spawn?: (command: string, args: string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  }) => CodexAppServerChild;
  transportFactory?: (input: {
    session: CodexAppServerSession;
    child: CodexAppServerChild;
  }) => CodexAppServerTransport | undefined;
}

const APP_SERVER_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "SHELL",
  "CODEX_HOME"
] as const;
const APP_SERVER_LOOPBACK_PORT_START = 45200;
const APP_SERVER_LOOPBACK_PORT_END = 46200;

interface ManagedCodexAppServerSession extends CodexAppServerSession {
  child: CodexAppServerChild;
  client?: CodexAppServerJsonRpcClient | undefined;
}

export class CodexAppServerManager extends EventEmitter {
  private sessions = new Map<string, ManagedCodexAppServerSession>();
  private readonly reservedLoopbackPorts = new Set<number>();
  private nextLoopbackPortCandidate = APP_SERVER_LOOPBACK_PORT_START;
  private readonly perUserLimit: number;
  private readonly spawnProcess: NonNullable<CodexAppServerManagerOptions["spawn"]>;

  constructor(private readonly options: CodexAppServerManagerOptions) {
    super();
    this.perUserLimit = options.perUserLimit ?? 1;
    this.spawnProcess = options.spawn ?? defaultSpawn;
  }

  async start(input: StartCodexAppServerInput): Promise<CodexAppServerSession> {
    this.assertWithinLimit(input.userId);
    const id = randomUUID();
    const auth = await this.authForRuntime(id, input.runtimeMode);
    const listen = auth.listen;
    const launchInput: CodexAppServerLaunchPlanInput = {
      projectRoot: input.projectRoot,
      credentialMode: input.credentialMode,
      listen
    };
    if (auth.wsAuth) launchInput.wsAuth = auth.wsAuth;
    if (input.env) launchInput.env = input.env;
    if (input.secretEnvNames) launchInput.secretEnvNames = input.secretEnvNames;
    const plan = createCodexAppServerLaunchPlan(launchInput);
    const child = this.spawnProcess(plan.command, plan.args, {
      cwd: plan.cwd,
      env: buildAppServerChildEnv(process.env, plan.env)
    });
    const now = new Date();
    const session: ManagedCodexAppServerSession = {
      id,
      userId: input.userId,
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      runtimeMode: input.runtimeMode,
      status: "running",
      command: plan.command,
      args: plan.args,
      listen,
      pid: child.pid,
      token: auth.token,
      tokenFile: auth.tokenFile,
      createdAt: now,
      updatedAt: now,
      child
    };
    child.on("exit", () => {
      const current = this.sessions.get(id);
      if (!current || current.status !== "running") return;
      current.status = "stopped";
      current.updatedAt = new Date();
      this.releaseSession(current);
    });
    child.on("error", (error: Error) => {
      const current = this.sessions.get(id);
      if (!current) return;
      current.status = "error";
      current.errorMessage = error.message;
      current.updatedAt = new Date();
      this.releaseSession(current);
    });
    session.client = this.createClient(session, child);
    this.sessions.set(id, session);
    return publicSession(session);
  }

  list(userId: string): CodexAppServerSession[] {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .map(publicSession);
  }

  get(id: string, userId: string): CodexAppServerSession {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) {
      throw new Error("Codex app-server session not found");
    }
    return publicSession(session);
  }

  stop(id: string, userId: string): CodexAppServerSession {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) {
      throw new Error("Codex app-server session not found");
    }
    if (session.status === "running") {
      session.child.kill("SIGTERM");
    }
    session.status = "stopped";
    session.updatedAt = new Date();
    this.releaseSession(session);
    return publicSession(session);
  }

  stopAll(): void {
    for (const session of [...this.sessions.values()]) {
      if (session.status === "running") {
        session.child.kill("SIGTERM");
      }
      session.status = "stopped";
      session.updatedAt = new Date();
      this.releaseSession(session);
    }
  }

  initialize(id: string, userId: string): Promise<unknown> {
    return this.clientFor(id, userId).initialize();
  }

  startThread(
    id: string,
    userId: string,
    input: Omit<CodexThreadStartRequestInput, "id">
  ): Promise<unknown> {
    return this.clientFor(id, userId).startThread(input);
  }

  startTurn(
    id: string,
    userId: string,
    input: Omit<CodexTurnStartRequestInput, "id">
  ): Promise<unknown> {
    return this.clientFor(id, userId).startTurn(input);
  }

  private assertWithinLimit(userId: string): void {
    const running = [...this.sessions.values()].filter(
      (session) => session.userId === userId && session.status === "running"
    );
    if (running.length >= this.perUserLimit) {
      throw new Error("Codex app-server process limit reached");
    }
  }

  private clientFor(id: string, userId: string): CodexAppServerJsonRpcClient {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) {
      throw new Error("Codex app-server session not found");
    }
    if (!session.client) {
      throw new Error("Codex app-server protocol client is not available");
    }
    return session.client;
  }

  private createClient(
    session: CodexAppServerSession,
    child: CodexAppServerChild
  ): CodexAppServerJsonRpcClient | undefined {
    const transport =
      this.options.transportFactory?.({ session, child }) ?? createDefaultTransport(session, child);
    if (!transport) {
      return undefined;
    }

    return new CodexAppServerJsonRpcClient({
      transport,
      clientVersion: this.options.clientVersion ?? "0.0.0",
      ...(this.options.requestTimeoutMs !== undefined ? { timeoutMs: this.options.requestTimeoutMs } : {}),
      ...(this.options.maxFrameBytes !== undefined ? { maxFrameBytes: this.options.maxFrameBytes } : {}),
      onNotification: (notification) => {
        this.emit("notification", {
          userId: session.userId,
          projectId: session.projectId,
          appServerSessionId: session.id,
          ...(notification.threadId ? { threadId: notification.threadId } : {}),
          activityType: notification.activityType,
          status: notification.status,
          method: notification.method,
          message: notification.message
        } satisfies CodexAppServerNotificationEvent);
      }
    });
  }

  private async authForRuntime(
    id: string,
    runtimeMode: CodexAppServerRuntimeMode
  ): Promise<{
    listen: string;
    wsAuth?: CodexAppServerAuth;
    token?: string;
    tokenFile?: string;
  }> {
    if (runtimeMode === "app-server-stdio") {
      return { listen: "stdio://" };
    }

    const token = randomBytes(24).toString("base64url");
    const tokenDir = path.join(this.options.runtimeRoot, "codex-app-server");
    await mkdir(tokenDir, { recursive: true, mode: 0o700 });
    const tokenFile = path.join(tokenDir, `${id}.token`);
    await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
    await chmod(tokenFile, 0o600);
    return {
      listen: `ws://127.0.0.1:${this.nextLoopbackPort()}`,
      wsAuth: {
        mode: "capability-token",
        tokenFile
      },
      token,
      tokenFile
    };
  }

  private nextLoopbackPort(): number {
    for (let attempts = 0; attempts <= APP_SERVER_LOOPBACK_PORT_END - APP_SERVER_LOOPBACK_PORT_START; attempts += 1) {
      const port = this.nextLoopbackPortCandidate;
      this.nextLoopbackPortCandidate =
        port >= APP_SERVER_LOOPBACK_PORT_END ? APP_SERVER_LOOPBACK_PORT_START : port + 1;
      if (!this.reservedLoopbackPorts.has(port)) {
        this.reservedLoopbackPorts.add(port);
        return port;
      }
    }
    throw new Error("No Codex app-server loopback ports are available");
  }

  private releaseSession(session: ManagedCodexAppServerSession): void {
    session.client?.close();
    releaseLoopbackPort(this.reservedLoopbackPorts, session.listen);
    if (session.tokenFile) {
      rmSync(session.tokenFile, { force: true });
    }
    this.sessions.delete(session.id);
  }
}

function buildAppServerChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  launchEnv: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of APP_SERVER_ENV_ALLOWLIST) {
    const value = parentEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return {
    ...env,
    ...launchEnv
  };
}

function releaseLoopbackPort(reservedPorts: Set<number>, listen: string): void {
  const match = /^ws:\/\/127\.0\.0\.1:(\d+)$/.exec(listen);
  if (!match) {
    return;
  }
  reservedPorts.delete(Number(match[1]));
}

function defaultSpawn(command: string, args: string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
}): ChildProcess {
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function publicSession(session: ManagedCodexAppServerSession): CodexAppServerSession {
  const { child: _child, client: _client, ...rest } = session;
  return { ...rest };
}

function createDefaultTransport(
  session: CodexAppServerSession,
  child: CodexAppServerChild
): CodexAppServerTransport | undefined {
  if (session.runtimeMode === "app-server-stdio" && child.stdin && child.stdout) {
    return new StdioJsonLineTransport(child);
  }

  return undefined;
}

class StdioJsonLineTransport implements CodexAppServerTransport {
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
