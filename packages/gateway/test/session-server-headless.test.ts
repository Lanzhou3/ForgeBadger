/**
 * P3 integration tests: headless screen semantics, attach ack + ordered
 * replay, bracketed paste staging, targeted session_exit, UTF-8 chunk
 * handling, backpressure, and flood integrity.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { IPty } from "node-pty";

import { SessionServer } from "../src/services/session-server/session-server.js";
import { SessionHandle } from "../src/services/session-server/session-handle.js";
import { IpcServer } from "../src/services/session-server/ipc-server.js";
import { createPlatformAdapter } from "../src/services/session-server/platform-adapter.js";
import { performClientHello } from "../src/services/session-server/hello-handshake.js";
import { SessionServerPty } from "../src/services/session-server-pty.js";
import {
  composerContainsStagedTask,
  isProgrammaticComposerReady
} from "../src/services/programmatic-terminal-submit.js";
import type { LaunchPlanPayload } from "../src/services/session-server/ipc-protocol.js";

const TOKEN = "0123456789abcdef".repeat(4);
const isWin = process.platform === "win32";
const shell = isWin ? "cmd.exe" : "bash";
const shellArg = isWin ? "/c" : "-c";

let testCounter = 0;
function uniqueIpcPath(): string {
  testCounter += 1;
  if (isWin) {
    return `\\\\.\\pipe\\forgebadger-ss-hl-${process.pid}-${Date.now()}-${testCounter}`;
  }
  const dir = mkdtempSync(join(tmpdir(), "ss-hl-"));
  return `${createPlatformAdapter().getIpcPath(dir)}-${testCounter}`;
}

function plan(cwd: string, cmd: string): LaunchPlanPayload {
  return { command: shell, args: [shellArg, cmd], cwd, env: {}, secretEnvNames: [], credentialMode: "host_environment" };
}

async function startPair(ipcPath: string, options: { maxClientBufferBytes?: number } = {}) {
  const sessionServer = new SessionServer();
  const ipcServer = new IpcServer({
    ipcPath,
    sessionServer,
    token: TOKEN,
    ...(options.maxClientBufferBytes !== undefined
      ? { maxClientBufferBytes: options.maxClientBufferBytes }
      : {})
  });
  await ipcServer.start();
  await new Promise((r) => setTimeout(r, 150));
  return { sessionServer, ipcServer };
}

async function pollUntil(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error("pollUntil timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Minimal IPty stub: write-capturing, manually driven. */
function fakePty(): { pty: IPty; writes: string[]; emitter: EventEmitter; pauses: boolean[] } {
  const emitter = new EventEmitter();
  const writes: string[] = [];
  const pauses: boolean[] = [];
  const pty = {
    pid: 4242,
    cols: 80,
    rows: 24,
    process: "fake-shell",
    onData: (listener: (data: string) => void) => {
      emitter.on("data", listener);
      return { dispose: () => emitter.off("data", listener) };
    },
    onExit: (listener: (event: { exitCode: number }) => void) => {
      emitter.on("exit", listener);
      return { dispose: () => emitter.off("exit", listener) };
    },
    write: (data: string) => { writes.push(data); },
    resize: (cols: number, rows: number) => {
      (pty as { cols: number }).cols = cols;
      (pty as { rows: number }).rows = rows;
    },
    kill: () => undefined,
    pause: () => pauses.push(true),
    resume: () => pauses.push(false),
    clear: () => undefined
  } as unknown as IPty;
  return { pty, writes, emitter, pauses };
}

describe("bracketed paste staging", () => {
  it("wraps programmatic input in bracketed paste markers", () => {
    const { pty, writes } = fakePty();
    const handle = new SessionHandle({ sessionId: "s", userId: "u", attachToken: "t", pty });
    try {
      handle.stageProgrammaticInput("第一行\n第二行");
      assert.strictEqual(writes.length, 1);
      assert.strictEqual(writes[0], "\x1b[200~第一行\n第二行\x1b[201~");
    } finally {
      handle.disposeResources();
    }
  });

  it("rejects C0/C1 control characters before any write", () => {
    const { pty, writes } = fakePty();
    const handle = new SessionHandle({ sessionId: "s", userId: "u", attachToken: "t", pty });
    try {
      assert.throws(
        () => handle.stageProgrammaticInput("hello\x1b[201~\rInjected"),
        /PROGRAMMATIC_SUBMIT_UNSAFE_INPUT/
      );
      assert.strictEqual(writes.length, 0, "rejected input must never reach the pty");
      // LF and TAB remain allowed
      handle.stageProgrammaticInput("a\nb\tc");
      assert.strictEqual(writes.length, 1);
    } finally {
      handle.disposeResources();
    }
  });
});

describe("composer classification on the rendered screen", () => {
  it("claude composer is detected from rendered text", async () => {
    const server = new SessionServer();
    const cwd = mkdtempSync(join(tmpdir(), "ss-composer-"));
    try {
      await server.createSession({
        sessionId: "claude-ui", userId: "u", attachToken: "t",
        launchPlan: plan(cwd, isWin
          ? "echo ❯ & echo ────────────── & ping -n 60 127.0.0.1 >nul"
          : "printf 'Welcome\\n\\n──────────────\\n❯ \\n'; sleep 60")
      });
      await pollUntil(async () => {
        const snap = await server.inspectPane("claude-ui");
        return snap.content.includes("❯");
      });
      const snapshot = await server.inspectPane("claude-ui");
      assert.strictEqual(snapshot.dead, false);
      assert.ok(!snapshot.content.includes("printf"), "content must be the rendered screen, not the raw command echo");
      assert.ok(
        isProgrammaticComposerReady("claude", snapshot.content),
        `claude composer must classify as ready; content=${JSON.stringify(snapshot.content)}`
      );
    } finally {
      await server.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("codex composer and pasted-content placeholder classify on rendered text", async () => {
    const server = new SessionServer();
    const cwd = mkdtempSync(join(tmpdir(), "ss-composer-cx-"));
    try {
      await server.createSession({
        sessionId: "codex-ui", userId: "u", attachToken: "t",
        launchPlan: plan(cwd, isWin
          ? "echo › Ask Codex to do anything & ping -n 60 127.0.0.1 >nul"
          : "printf 'gpt-5 · /repo\\n\\n› Ask Codex to do anything\\n'; sleep 60")
      });
      await pollUntil(async () => (await server.inspectPane("codex-ui")).content.includes("Ask Codex"));
      const ready = await server.inspectPane("codex-ui");
      assert.ok(isProgrammaticComposerReady("codex", ready.content), JSON.stringify(ready.content));

      // Staged state: Codex collapses a large paste into a placeholder.
      const message = "请".repeat(2032);
      const stagedPane = "gpt-5 · /repo\n\n› [Pasted Content 2032 chars]\n";
      assert.ok(composerContainsStagedTask("codex", stagedPane, message, ""));
    } finally {
      await server.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("attach ack and ordered replay", () => {
  it("rejects attaching to a missing session with an explicit error", async () => {
    const ipcPath = uniqueIpcPath();
    const { sessionServer, ipcServer } = await startPair(ipcPath);
    try {
      const pty = new SessionServerPty({ ipcPath, sessionId: "no-such-session", token: TOKEN });
      await assert.rejects(() => pty.connect(), /Session not found/);
    } finally {
      await ipcServer.stop();
      await sessionServer.destroy();
    }
  });

  it("snapshot replays history, live stream follows without loss or duplication", async () => {
    if (isWin) return; // bash-only orchestration
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "ss-attach-"));
    const { sessionServer, ipcServer } = await startPair(ipcPath);
    try {
      await sessionServer.createSession({
        sessionId: "ord", userId: "u", attachToken: "t",
        launchPlan: plan(cwd, "echo before-marker; cat")
      });
      await pollUntil(async () => (await sessionServer.capturePane("ord")).includes("before-marker"));

      const pty = new SessionServerPty({ ipcPath, sessionId: "ord", token: TOKEN });
      const { snapshot } = await pty.connect();
      assert.ok(snapshot, "attach ack must carry a snapshot");
      assert.ok(snapshot.includes("before-marker"), "snapshot replays history");
      assert.ok(!snapshot.includes("after-marker"));

      const live: string[] = [];
      pty.onData((data) => live.push(data));
      pty.write("echo after-marker\n");
      await pollUntil(() => live.join("").includes("after-marker"));

      const liveText = live.join("");
      assert.ok(!liveText.includes("before-marker"), "history must not be re-streamed after the snapshot");
    } finally {
      await ipcServer.stop();
      await sessionServer.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("buffers output produced during the attach window and flushes it after the ack", async () => {
    if (isWin) return;
    const server = new SessionServer();
    const cwd = mkdtempSync(join(tmpdir(), "ss-attachwin-"));
    try {
      await server.createSession({
        sessionId: "win", userId: "u", attachToken: "t",
        launchPlan: plan(cwd, "while read x; do echo got-$x; done")
      });
      const live: string[] = [];
      server.onSessionOutput = (_sessionId, _clientId, data) => live.push(data);

      // attachClient resolves with the client registered in buffering mode.
      const { snapshot } = await server.attachClient("win", "c-window");
      assert.strictEqual(typeof snapshot, "string");

      // Output produced now must land in the attach buffer, not the live stream.
      server.sendInput("win", "hello\n");
      await pollUntil(async () => (await server.capturePane("win")).includes("got-hello"));
      assert.ok(!live.join("").includes("got-hello"), "attach-window output must not stream live");

      const buffered = server.endClientBuffering("win", "c-window");
      assert.ok(buffered.join("").includes("got-hello"), "attach-window output must be buffered");

      // After the flush the client is live.
      server.sendInput("win", "world\n");
      await pollUntil(() => live.join("").includes("got-world"));
    } finally {
      await server.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("targeted session_exit", () => {
  it("delivers exit only to clients attached to the exiting session", async () => {
    if (isWin) return;
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "ss-exit-"));
    const { sessionServer, ipcServer } = await startPair(ipcPath);
    try {
      await sessionServer.createSession({
        sessionId: "exit-a", userId: "u", attachToken: "t", launchPlan: plan(cwd, "read x; exit 3")
      });
      await sessionServer.createSession({
        sessionId: "stay-b", userId: "u", attachToken: "t", launchPlan: plan(cwd, "sleep 60")
      });

      const ptyA = new SessionServerPty({ ipcPath, sessionId: "exit-a", token: TOKEN });
      const ptyB = new SessionServerPty({ ipcPath, sessionId: "stay-b", token: TOKEN });
      await ptyA.connect();
      await ptyB.connect();

      const exitA = new Promise<number>((resolve) => ptyA.onExit((e) => resolve(e.exitCode)));
      let exitB: number | undefined;
      ptyB.onExit((e) => { exitB = e.exitCode; });

      ptyA.write("\n"); // releases `read`, session A exits with code 3
      assert.strictEqual(await exitA, 3);
      await new Promise((r) => setTimeout(r, 500));
      assert.strictEqual(exitB, undefined, "session_exit must not leak across sessions");
      ptyB.kill();
    } finally {
      await ipcServer.stop();
      await sessionServer.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("UTF-8 inbound chunk splitting", () => {
  it("does not corrupt multibyte characters split across TCP chunks", async () => {
    if (isWin) return;
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "ss-utf8-"));
    const { sessionServer, ipcServer } = await startPair(ipcPath);
    try {
      await sessionServer.createSession({
        sessionId: "u8", userId: "u", attachToken: "t", launchPlan: plan(cwd, "cat")
      });

      const socket = new Socket();
      await new Promise<void>((resolve, reject) => {
        socket.connect(ipcPath, resolve);
        socket.once("error", reject);
      });
      await performClientHello(socket, TOKEN, 5000);

      // Split the 3-byte character 中 across two TCP chunks.
      const line = `${JSON.stringify({ id: "i1", type: "send_input", sessionId: "u8", data: "中文切片OK\n" })}\n`;
      const bytes = Buffer.from(line, "utf8");
      const cut = bytes.indexOf(Buffer.from("中", "utf8")) + 1; // mid-character
      socket.write(bytes.subarray(0, cut));
      await new Promise((r) => setTimeout(r, 100));
      socket.write(bytes.subarray(cut));

      await pollUntil(async () => (await sessionServer.capturePane("u8")).includes("中文切片OK"));
      const content = await sessionServer.capturePane("u8");
      assert.ok(!content.includes("\uFFFD"), "no replacement characters from split chunks");
      socket.destroy();
    } finally {
      await ipcServer.stop();
      await sessionServer.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("pty/screen resize sync", () => {
  it("client_resize resizes the pty and the headless screen together", async () => {
    if (isWin) return;
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "ss-resize-"));
    const { sessionServer, ipcServer } = await startPair(ipcPath);
    try {
      await sessionServer.createSession({
        sessionId: "rz", userId: "u", attachToken: "t", launchPlan: plan(cwd, "sleep 60")
      });
      const pty = new SessionServerPty({ ipcPath, sessionId: "rz", token: TOKEN });
      await pty.connect();
      pty.resize(90, 30);

      await pollUntil(() => {
        const handle = sessionServer.getSession("rz");
        return handle?.screen.cols === 90 && handle.screen.rows === 30
          && handle.pty.cols === 90 && handle.pty.rows === 30;
      });
      pty.kill();
    } finally {
      await ipcServer.stop();
      await sessionServer.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("data-plane backpressure", () => {
  /** A client that completes hello+attach and then stops reading. */
  async function stuckClient(ipcPath: string, sessionId: string): Promise<Socket> {
    const socket = new Socket();
    await new Promise<void>((resolve, reject) => {
      socket.connect(ipcPath, resolve);
      socket.once("error", reject);
    });
    await performClientHello(socket, TOKEN, 5000);
    socket.write(`${JSON.stringify({ type: "attach_client", sessionId, clientId: `stuck-${sessionId}` })}\n`);
    socket.pause();
    return socket;
  }

  it("pauses the session pty when a client stops reading", async () => {
    if (isWin) return;
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "ss-bp-"));
    const { sessionServer, ipcServer } = await startPair(ipcPath);
    try {
      await sessionServer.createSession({
        sessionId: "flood", userId: "u", attachToken: "t", launchPlan: plan(cwd, "yes flood-line")
      });
      const socket = await stuckClient(ipcPath, "flood");

      await pollUntil(() => sessionServer.getSession("flood")?.paused === true, 15_000);
      socket.destroy();
    } finally {
      await ipcServer.stop();
      await sessionServer.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("disconnects a client whose outbound buffer exceeds the hard cap", async () => {
    if (isWin) return;
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "ss-cap-"));
    const { sessionServer, ipcServer } = await startPair(ipcPath, { maxClientBufferBytes: 1024 });
    try {
      await sessionServer.createSession({
        sessionId: "capped", userId: "u", attachToken: "t", launchPlan: plan(cwd, "yes flood-line")
      });
      const socket = await stuckClient(ipcPath, "capped");

      // The client is paused, so it never processes the FIN — observe the
      // disconnect from the server side: socket cleanup detaches the client.
      await pollUntil(() => sessionServer.getSession("capped")?.clientCount === 0);
      socket.destroy();
    } finally {
      await ipcServer.stop();
      await sessionServer.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("retired protocol surface", () => {
  it("configure_session is rejected as an unknown message type", async () => {
    const ipcPath = uniqueIpcPath();
    const { sessionServer, ipcServer } = await startPair(ipcPath);
    try {
      const socket = new Socket();
      await new Promise<void>((resolve, reject) => {
        socket.connect(ipcPath, resolve);
        socket.once("error", reject);
      });
      await performClientHello(socket, TOKEN, 5000);
      socket.setEncoding("utf8");
      const reply = new Promise<Record<string, unknown>>((resolve) => {
        let buffer = "";
        socket.on("data", (chunk: string) => {
          buffer += chunk;
          const idx = buffer.indexOf("\n");
          if (idx === -1) return;
          resolve(JSON.parse(buffer.slice(0, idx)) as Record<string, unknown>);
        });
      });
      socket.write(`${JSON.stringify({ id: "cfg1", type: "configure_session", sessionId: "s" })}\n`);
      const msg = await reply;
      assert.strictEqual(msg.type, "error");
      assert.match(String(msg.message), /Invalid IPC request/);
      socket.destroy();
    } finally {
      await ipcServer.stop();
      await sessionServer.destroy();
    }
  });
});

describe("flood integrity (slow)", () => {
  it("engages pty pause under a flood with tight watermarks", { timeout: 120_000 }, async () => {
    if (isWin) return;
    // Tiny watermarks: any full-size pty read chunk exceeds the high water,
    // so the flow-control loop must engage regardless of machine speed.
    const server = new SessionServer({
      screenFlowControl: { highWaterBytes: 1024, lowWaterBytes: 256 }
    });
    const cwd = mkdtempSync(join(tmpdir(), "ss-flood-pause-"));
    try {
      await server.createSession({
        sessionId: "pauseflood", userId: "u", attachToken: "t",
        launchPlan: plan(cwd, "awk 'BEGIN{for(i=1;i<=500000;i++) print \"flood-payload-line-\" i}'")
      });
      await pollUntil(() => (server.getSession("pauseflood")?.pauseActivations ?? 0) > 0, 60_000);
      // The flood must still complete (pause is backpressure, not a stall).
      await pollUntil(async () => {
        const snap = await server.inspectPane("pauseflood");
        return snap.content.includes("flood-payload-line-500000");
      }, 90_000);
    } finally {
      await server.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("parses a >50MB flood without silent data loss", { timeout: 180_000 }, async () => {
    if (isWin) return;
    const total = 8_000_000; // ~68MB of "N\n" lines, past xterm's 50MB internal guard
    const server = new SessionServer();
    const cwd = mkdtempSync(join(tmpdir(), "ss-flood-"));
    try {
      await server.createSession({
        sessionId: "bigflood", userId: "u", attachToken: "t",
        // awk prints exact integers (BSD seq would emit %g notation like 8e+06)
        launchPlan: plan(cwd, `awk 'BEGIN{for(i=1;i<=${total};i++) print i}'`)
      });
      await pollUntil(async () => {
        const snap = await server.inspectPane("bigflood");
        return snap.content.split("\n").some((line) => line.trim() === String(total));
      }, 150_000);

      const capture = await server.capturePane("bigflood");
      const numbers: number[] = [];
      for (const raw of capture.split(/\r\n|\r|\n/)) {
        if (/^\d+$/.test(raw)) numbers.push(Number(raw));
      }
      const tail = numbers.slice(-200);
      assert.strictEqual(tail.length, 200, "expected a numeric tail in the capture");
      assert.strictEqual(tail[tail.length - 1], total);
      for (let i = 1; i < tail.length; i += 1) {
        assert.strictEqual(
          tail[i],
          (tail[i - 1] ?? 0) + 1,
          `silent drop detected: ${tail[i - 1]} -> ${tail[i]} (flow control must prevent xterm's internal overflow)`
        );
      }
    } finally {
      await server.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
