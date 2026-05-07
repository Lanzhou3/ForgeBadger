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
});
