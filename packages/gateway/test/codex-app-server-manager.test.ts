import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CodexAppServerManager,
  type CodexAppServerChild
} from "../src/services/codex-app-server-manager.js";
import {
  createCodexAppServerNotificationEvent,
  type CodexAppServerTransport
} from "../src/services/codex-app-server-client.js";
import type {
  WebSocketTransportConnection,
  WebSocketTransportFactoryOptions
} from "../src/services/codex-app-server-transports.js";

class FakeChild extends EventEmitter implements CodexAppServerChild {
  killed = false;

  constructor(readonly pid: number) {
    super();
  }

  kill(): boolean {
    this.killed = true;
    this.emit("exit", 0);
    return true;
  }
}

describe("CodexAppServerManager", () => {
  it("starts a loopback websocket app-server with a capability token file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-manager-"));
    const child = new FakeChild(1234);
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      spawn: () => child
    });

    const session = await manager.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "/workspace/project",
      credentialMode: "host_environment",
      runtimeMode: "app-server-websocket"
    });

    assert.equal(session.status, "running");
    assert.equal(session.command, "codex");
    assert.ok(session.args.includes("app-server"));
    assert.ok(session.args.includes("--ws-auth"));
    assert.ok(session.listen.startsWith("ws://127.0.0.1:"));
    assert.ok(session.tokenFile);
    assert.equal(await readFile(session.tokenFile, "utf8"), `${session.token}\n`);
    assert.equal((await stat(session.tokenFile)).mode & 0o777, 0o600);
  });

  it("initializes websocket app-server sessions through capability-token transport", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-ws-client-"));
    const socket = new FakeWebSocketConnection();
    let connectUrl = "";
    let connectOptions: WebSocketTransportFactoryOptions | undefined;
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      spawn: () => new FakeChild(1234),
      webSocketFactory: (url, options) => {
        connectUrl = url;
        connectOptions = options;
        return socket;
      }
    });

    const session = await manager.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "/workspace/project",
      credentialMode: "host_environment",
      runtimeMode: "app-server-websocket"
    });
    const pending = manager.initialize(session.id, "user-1");

    assert.equal(connectUrl, session.listen);
    assert.equal(connectOptions?.headers?.Authorization, `Bearer ${session.token}`);
    assert.equal(socket.sent.length, 0);

    socket.emitOpen();
    const sent = JSON.parse(socket.sent[0] ?? "{}") as { id: number; method: string };
    assert.equal(sent.method, "initialize");
    socket.emitMessage(JSON.stringify({
      id: sent.id,
      result: {
        userAgent: "openforge/0.130.0",
        codexHome: root,
        platformFamily: "unix",
        platformOs: "linux"
      }
    }));

    assert.deepEqual(await pending, {
      userAgent: "openforge/0.130.0",
      codexHome: root,
      platformFamily: "unix",
      platformOs: "linux"
    });
    assert.deepEqual(JSON.parse(socket.sent[1] ?? "{}"), { method: "initialized" });
  });

  it("allocates unique loopback ports for concurrent websocket starts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-ports-"));
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      perUserLimit: 3,
      spawn: () => new FakeChild(1234)
    });

    const [first, second] = await Promise.all([
      manager.start({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "/workspace/project",
        credentialMode: "host_environment",
        runtimeMode: "app-server-websocket"
      }),
      manager.start({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "/workspace/project",
        credentialMode: "host_environment",
        runtimeMode: "app-server-websocket"
      })
    ]);

    assert.notEqual(first.listen, second.listen);
  });

  it("does not pass unrelated parent secrets to the app-server child", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-env-"));
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.OPENAI_API_KEY = "parent-openai-key";
    process.env.DATABASE_URL = "postgres://example";
    let childEnv: NodeJS.ProcessEnv | undefined;
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      spawn: (_command, _args, options) => {
        childEnv = options.env;
        return new FakeChild(1234);
      }
    });

    try {
      await manager.start({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "/workspace/project",
        credentialMode: "host_environment",
        runtimeMode: "app-server-stdio"
      });
    } finally {
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }

    assert.equal(childEnv?.OPENAI_API_KEY, undefined);
    assert.equal(childEnv?.DATABASE_URL, undefined);
    assert.ok(childEnv?.PATH);
  });

  it("enforces tenant ownership and process limits", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-limit-"));
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      perUserLimit: 1,
      spawn: () => new FakeChild(1000)
    });

    const session = await manager.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "/workspace/project",
      credentialMode: "host_environment",
      runtimeMode: "app-server-stdio"
    });

    assert.throws(
      () => manager.get(session.id, "user-2"),
      /not found/i
    );
    await assert.rejects(
      () => manager.start({
        userId: "user-1",
        projectId: "project-2",
        projectRoot: "/workspace/project-2",
        credentialMode: "host_environment",
        runtimeMode: "app-server-stdio"
      }),
      /limit/i
    );
  });

  it("stops only the owner's app-server session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-stop-"));
    const child = new FakeChild(2222);
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      spawn: () => child
    });

    const session = await manager.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "/workspace/project",
      credentialMode: "host_environment",
      runtimeMode: "app-server-stdio"
    });

    assert.throws(() => manager.stop(session.id, "user-2"), /not found/i);
    const stopped = manager.stop(session.id, "user-1");

    assert.equal(child.killed, true);
    assert.equal(stopped.status, "stopped");
  });

  it("removes websocket token files and list entries when a session stops", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-cleanup-"));
    const child = new FakeChild(3333);
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      spawn: () => child
    });

    const session = await manager.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "/workspace/project",
      credentialMode: "host_environment",
      runtimeMode: "app-server-websocket"
    });
    assert.ok(session.tokenFile);

    const stopped = manager.stop(session.id, "user-1");

    assert.equal(stopped.status, "stopped");
    assert.equal(manager.list("user-1").length, 0);
    await assert.rejects(() => stat(session.tokenFile as string), { code: "ENOENT" });
  });

  it("cleans all managed websocket token files on stopAll", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-stopall-"));
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      perUserLimit: 2,
      spawn: () => new FakeChild(4444)
    });

    const first = await manager.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "/workspace/project",
      credentialMode: "host_environment",
      runtimeMode: "app-server-websocket"
    });
    const second = await manager.start({
      userId: "user-1",
      projectId: "project-2",
      projectRoot: "/workspace/project-2",
      credentialMode: "host_environment",
      runtimeMode: "app-server-websocket"
    });

    assert.ok(first.tokenFile);
    assert.ok(second.tokenFile);

    manager.stopAll();

    assert.equal(manager.list("user-1").length, 0);
    await assert.rejects(() => stat(first.tokenFile as string), { code: "ENOENT" });
    await assert.rejects(() => stat(second.tokenFile as string), { code: "ENOENT" });
  });

  it("emits normalized app-server notifications with session ownership metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-notify-"));
    const transport = new ManualTransport();
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      spawn: () => new FakeChild(5555),
      transportFactory: () => transport
    });
    const notifications: unknown[] = [];
    manager.on("notification", (event) => notifications.push(event));

    const session = await manager.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "/workspace/project",
      credentialMode: "host_environment",
      runtimeMode: "app-server-stdio"
    });
    transport.emitMessage(JSON.stringify(createCodexAppServerNotificationEvent({
      threadId: "thr_123",
      notificationType: "permission_prompt",
      message: "approval needed"
    })));

    assert.deepEqual(notifications, [{
      userId: "user-1",
      projectId: "project-1",
      appServerSessionId: session.id,
      threadId: "thr_123",
      activityType: "permission_prompt",
      status: "warning",
      method: "notification/prompt",
      message: "approval needed"
    }]);
  });
});

class ManualTransport implements CodexAppServerTransport {
  private messageHandler: ((raw: string | Buffer) => void) | undefined;
  private closeHandler: ((code?: number, reason?: string) => void) | undefined;

  send(): void {}

  close(code?: number, reason?: string): void {
    this.closeHandler?.(code, reason);
  }

  onMessage(handler: (raw: string | Buffer) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (code?: number, reason?: string) => void): void {
    this.closeHandler = handler;
  }

  emitMessage(raw: string): void {
    this.messageHandler?.(raw);
  }
}

class FakeWebSocketConnection implements WebSocketTransportConnection {
  readonly readyState = 0;
  sent: string[] = [];
  private openHandler: (() => void) | undefined;
  private messageHandler: ((data: unknown) => void) | undefined;
  private closeHandler: ((code: number, reason: Buffer) => void) | undefined;
  private errorHandler: ((error: Error) => void) | undefined;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeHandler?.(code ?? 1000, Buffer.from(reason ?? ""));
  }

  on(event: "open", handler: () => void): this;
  on(event: "message", handler: (data: unknown) => void): this;
  on(event: "close", handler: (code: number, reason: Buffer) => void): this;
  on(event: "error", handler: (error: Error) => void): this;
  on(event: "open" | "message" | "close" | "error", handler: unknown): this {
    if (event === "open") this.openHandler = handler as () => void;
    if (event === "message") this.messageHandler = handler as (data: unknown) => void;
    if (event === "close") this.closeHandler = handler as (code: number, reason: Buffer) => void;
    if (event === "error") this.errorHandler = handler as (error: Error) => void;
    return this;
  }

  emitOpen(): void {
    this.openHandler?.();
  }

  emitMessage(data: string): void {
    this.messageHandler?.(data);
  }

  emitError(error: Error): void {
    this.errorHandler?.(error);
  }
}
