import { randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";

import type { CredentialMode } from "../adapters/claude.js";
import {
  createCodexAppServerLaunchPlan,
  type CodexAppServerAuth,
  type CodexAppServerLaunchPlanInput
} from "./codex-app-server.js";

export type CodexAppServerRuntimeMode = "app-server-stdio" | "app-server-websocket";
export type CodexAppServerStatus = "running" | "stopped" | "error";

export interface CodexAppServerChild extends Pick<EventEmitter, "on"> {
  pid?: number | undefined;
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
  spawn?: (command: string, args: string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  }) => CodexAppServerChild;
}

interface ManagedCodexAppServerSession extends CodexAppServerSession {
  child: CodexAppServerChild;
}

export class CodexAppServerManager {
  private sessions = new Map<string, ManagedCodexAppServerSession>();
  private readonly perUserLimit: number;
  private readonly spawnProcess: NonNullable<CodexAppServerManagerOptions["spawn"]>;

  constructor(private readonly options: CodexAppServerManagerOptions) {
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
      env: {
        ...process.env,
        ...plan.env
      }
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

  private assertWithinLimit(userId: string): void {
    const running = [...this.sessions.values()].filter(
      (session) => session.userId === userId && session.status === "running"
    );
    if (running.length >= this.perUserLimit) {
      throw new Error("Codex app-server process limit reached");
    }
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
    return 45200 + this.sessions.size;
  }

  private releaseSession(session: ManagedCodexAppServerSession): void {
    if (session.tokenFile) {
      rmSync(session.tokenFile, { force: true });
    }
    this.sessions.delete(session.id);
  }
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
  const { child: _child, ...rest } = session;
  return { ...rest };
}
