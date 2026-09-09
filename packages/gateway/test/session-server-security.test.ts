/**
 * Security tests for the Session Server P1 hardening:
 *   - buildSanitizedEnv allowlist + secret stripping
 *   - hello handshake (token / version / timeout / ordering)
 *   - socket file + directory permissions, stale-file lstat guard
 *   - inbound line/buffer limits
 *   - concurrent create_session race guard
 *   - handshake token file permissions
 */
import { describe, it, after } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildSanitizedEnv } from "../src/services/session-server/env-policy.js";
import {
  generateSessionServerToken,
  readSessionServerTokenFile,
  resolveSessionServerTokenPath,
  writeSessionServerTokenFile
} from "../src/services/session-server/auth-token.js";
import { PROTOCOL_VERSION } from "../src/services/session-server/ipc-protocol.js";
import { SessionServer } from "../src/services/session-server/session-server.js";
import { IpcServer } from "../src/services/session-server/ipc-server.js";
import type { LaunchPlanPayload } from "../src/services/session-server/ipc-protocol.js";

const isWin = process.platform === "win32";
const TOKEN = "0123456789abcdef".repeat(4);

let counter = 0;
const tempDirs: string[] = [];

function uniqueIpcPath(): { ipcPath: string; dir: string } {
  counter++;
  if (isWin) {
    return { ipcPath: `\\\\.\\pipe\\fb-ss-sec-${process.pid}-${counter}`, dir: "" };
  }
  const dir = mkdtempSync(join(tmpdir(), "fb-ss-sec-"));
  tempDirs.push(dir);
  return { ipcPath: join(dir, "server.sock"), dir };
}

after(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

async function startIpcServer(
  ipcPath: string,
  options: { token?: string; helloTimeoutMs?: number } = {}
): Promise<{ ipcServer: IpcServer; sessionServer: SessionServer }> {
  const sessionServer = new SessionServer();
  const ipcServer = new IpcServer({
    ipcPath,
    sessionServer,
    token: options.token ?? TOKEN,
    ...(options.helloTimeoutMs !== undefined ? { helloTimeoutMs: options.helloTimeoutMs } : {})
  });
  await ipcServer.start();
  // Give the pipe time to be fully ready on Windows
  await new Promise((r) => setTimeout(r, 150));
  return { ipcServer, sessionServer };
}

function connectRaw(ipcPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.connect(ipcPath, () => resolve(socket));
  });
}

/** Collect lines until the socket closes; returns received lines. */
function readUntilClose(socket: Socket): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        lines.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
    socket.on("error", () => { /* server-initiated destroy may reset */ });
    socket.on("close", () => resolve(lines));
  });
}

function helloLine(token: string, protocolVersion: number = PROTOCOL_VERSION): string {
  return `${JSON.stringify({ type: "hello", protocolVersion, token })}\n`;
}

describe("buildSanitizedEnv", () => {
  it("keeps allowlisted base variables", () => {
    const env = buildSanitizedEnv({
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      TERM: "xterm"
    });
    assert.deepStrictEqual(env, {
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      TERM: "xterm"
    });
  });

  it("strips Gateway secrets and unknown variables", () => {
    const env = buildSanitizedEnv({
      PATH: "/usr/bin",
      FORGEBADGER_MASTER_KEY: "abcdef0123456789".repeat(4),
      FORGEBADGER_JWT_SECRET: "x".repeat(32),
      AWS_SECRET_ACCESS_KEY: "secret",
      SOME_RANDOM_TOKEN: "secret",
      npm_config_cache: "/tmp/x"
    });
    assert.deepStrictEqual(env, { PATH: "/usr/bin" });
  });

  it("drops undefined values", () => {
    const env = buildSanitizedEnv({ PATH: "/usr/bin", HOME: undefined });
    assert.deepStrictEqual(env, { PATH: "/usr/bin" });
  });
});

describe("hello handshake", () => {
  it("accepts a correct token + protocol version", async () => {
    const { ipcPath } = uniqueIpcPath();
    const { ipcServer } = await startIpcServer(ipcPath);
    try {
      const socket = await connectRaw(ipcPath);
      const linesPromise = readUntilClose(socket);
      socket.write(helloLine(TOKEN));
      const helloOk = await new Promise<string>((resolve) => {
        socket.once("data", (chunk: string) => resolve(chunk));
      });
      const msg = JSON.parse(helloOk.trim()) as { type: string; protocolVersion: number };
      assert.strictEqual(msg.type, "hello_ok");
      assert.strictEqual(msg.protocolVersion, PROTOCOL_VERSION);

      // After hello, normal management messages are accepted
      socket.write(`${JSON.stringify({ id: "r1", type: "list_sessions" })}\n`);
      const response = await new Promise<string>((resolve) => {
        let buf = "";
        socket.on("data", function onData(chunk: string) {
          buf += chunk;
          if (buf.includes("\n")) {
            socket.off("data", onData);
            resolve(buf);
          }
        });
      });
      assert.strictEqual((JSON.parse(response.trim()) as { type: string }).type, "ok");
      socket.destroy();
      await linesPromise;
    } finally {
      await ipcServer.stop();
    }
  });

  it("rejects a wrong token and closes the connection", async () => {
    const { ipcPath } = uniqueIpcPath();
    const { ipcServer } = await startIpcServer(ipcPath);
    try {
      const socket = await connectRaw(ipcPath);
      const linesPromise = readUntilClose(socket);
      socket.write(helloLine("wrong-token"));
      const lines = await linesPromise;
      assert.strictEqual(lines.length, 1);
      const msg = JSON.parse(lines[0]!) as { type: string; message: string; protocolVersion: number };
      assert.strictEqual(msg.type, "hello_error");
      assert.match(msg.message, /invalid token/);
      assert.strictEqual(msg.protocolVersion, PROTOCOL_VERSION);
    } finally {
      await ipcServer.stop();
    }
  });

  it("rejects a mismatched protocol major version and reports the server version", async () => {
    const { ipcPath } = uniqueIpcPath();
    const { ipcServer } = await startIpcServer(ipcPath);
    try {
      const socket = await connectRaw(ipcPath);
      const linesPromise = readUntilClose(socket);
      socket.write(helloLine(TOKEN, PROTOCOL_VERSION + 1));
      const lines = await linesPromise;
      assert.strictEqual(lines.length, 1);
      const msg = JSON.parse(lines[0]!) as { type: string; message: string; protocolVersion: number };
      assert.strictEqual(msg.type, "hello_error");
      assert.match(msg.message, /unsupported protocol version/);
      assert.strictEqual(msg.protocolVersion, PROTOCOL_VERSION);
    } finally {
      await ipcServer.stop();
    }
  });

  it("disconnects a connection that does not hello within the timeout", async () => {
    const { ipcPath } = uniqueIpcPath();
    const { ipcServer } = await startIpcServer(ipcPath, { helloTimeoutMs: 200 });
    try {
      const socket = await connectRaw(ipcPath);
      const lines = await readUntilClose(socket);
      const msg = JSON.parse(lines[0] ?? "{}") as { type?: string; message?: string };
      assert.strictEqual(msg.type, "hello_error");
      assert.match(msg.message ?? "", /timeout/);
    } finally {
      await ipcServer.stop();
    }
  });

  it("rejects a non-hello first message", async () => {
    const { ipcPath } = uniqueIpcPath();
    const { ipcServer } = await startIpcServer(ipcPath);
    try {
      const socket = await connectRaw(ipcPath);
      const linesPromise = readUntilClose(socket);
      socket.write(`${JSON.stringify({ id: "r1", type: "list_sessions" })}\n`);
      const lines = await linesPromise;
      assert.strictEqual(lines.length, 1);
      const msg = JSON.parse(lines[0]!) as { type: string; message: string };
      assert.strictEqual(msg.type, "hello_error");
      assert.match(msg.message, /first message must be hello/);
    } finally {
      await ipcServer.stop();
    }
  });
});

describe("IPC endpoint permissions", () => {
  it("creates the socket directory 0700 and socket file 0600 (POSIX)", async () => {
    if (isWin) return;
    const dir = mkdtempSync(join(tmpdir(), "fb-ss-perm-"));
    tempDirs.push(dir);
    const nested = join(dir, "nested");
    const ipcPath = join(nested, "server.sock");
    const { ipcServer } = await startIpcServer(ipcPath);
    try {
      assert.strictEqual(statSync(nested).mode & 0o777, 0o700);
      assert.strictEqual(statSync(ipcPath).mode & 0o777, 0o600);
    } finally {
      await ipcServer.stop();
    }
  });

  it("refuses to start when the IPC path is a non-socket file (POSIX)", async () => {
    if (isWin) return;
    const { ipcPath } = uniqueIpcPath();
    writeFileSync(ipcPath, "not a socket");
    const sessionServer = new SessionServer();
    const ipcServer = new IpcServer({ ipcPath, sessionServer, token: TOKEN });
    await assert.rejects(() => ipcServer.start(), /non-socket file/);
    // The regular file must not have been deleted
    assert.ok(existsSync(ipcPath));
  });
});

describe("inbound size limits", () => {
  it("disconnects a client that sends an over-limit line", async () => {
    const { ipcPath } = uniqueIpcPath();
    const { ipcServer } = await startIpcServer(ipcPath);
    try {
      const socket = await connectRaw(ipcPath);
      const closed = readUntilClose(socket);
      socket.write(helloLine(TOKEN));
      await new Promise((r) => setTimeout(r, 100));
      // 5 MiB single line (over the 4 MiB limit), newline-terminated
      socket.write(`${"x".repeat(5 * 1024 * 1024)}\n`);
      await closed;
      assert.strictEqual(socket.destroyed, true);
    } finally {
      await ipcServer.stop();
    }
  });

  it("disconnects a client that buffers over the connection limit without a newline", async () => {
    const { ipcPath } = uniqueIpcPath();
    const { ipcServer } = await startIpcServer(ipcPath);
    try {
      const socket = await connectRaw(ipcPath);
      const closed = readUntilClose(socket);
      socket.write(helloLine(TOKEN));
      await new Promise((r) => setTimeout(r, 100));
      // 9 MiB with no newline (over the 8 MiB connection buffer limit)
      socket.write("x".repeat(9 * 1024 * 1024));
      await closed;
      assert.strictEqual(socket.destroyed, true);
    } finally {
      await ipcServer.stop();
    }
  });
});

describe("session env sanitization", () => {
  it("does not leak Gateway secrets into the pty process environment", async () => {
    const masterKey = "abcdef0123456789".repeat(4);
    const jwtSecret = "y".repeat(32);
    process.env.FORGEBADGER_MASTER_KEY = masterKey;
    process.env.FORGEBADGER_JWT_SECRET = jwtSecret;

    const cwd = mkdtempSync(join(tmpdir(), "fb-ss-env-"));
    tempDirs.push(cwd);
    const server = new SessionServer();
    const plan: LaunchPlanPayload = isWin
      ? { command: "cmd.exe", args: ["/c", "set"], cwd, env: {}, secretEnvNames: [], credentialMode: "host_environment" }
      : { command: "bash", args: ["-c", "env"], cwd, env: {}, secretEnvNames: [], credentialMode: "host_environment" };

    try {
      await server.createSession({ sessionId: "env-check", userId: "u", attachToken: "t", launchPlan: plan });

      let content = "";
      const start = Date.now();
      while (!content.includes("PATH") && Date.now() - start < 10_000) {
        await new Promise((r) => setTimeout(r, 100));
        content = server.capturePane("env-check");
      }
      assert.ok(content.includes("PATH"), `expected sanitized PATH in pty env, got: ${content.slice(0, 500)}`);
      assert.ok(!content.includes("FORGEBADGER_MASTER_KEY"), "pty env leaked FORGEBADGER_MASTER_KEY");
      assert.ok(!content.includes("FORGEBADGER_JWT_SECRET"), "pty env leaked FORGEBADGER_JWT_SECRET");
      assert.ok(!content.includes(masterKey), "pty env contained the master key value");
      assert.ok(!content.includes(jwtSecret), "pty env contained the JWT secret value");
    } finally {
      delete process.env.FORGEBADGER_MASTER_KEY;
      delete process.env.FORGEBADGER_JWT_SECRET;
      await server.destroy();
    }
  });
});

describe("concurrent create_session", () => {
  it("rejects a concurrent duplicate create instead of double-spawning", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "fb-ss-race-"));
    tempDirs.push(cwd);
    const server = new SessionServer();
    const plan: LaunchPlanPayload = isWin
      ? { command: "cmd.exe", args: ["/c", "echo race"], cwd, env: {}, secretEnvNames: [], credentialMode: "host_environment" }
      : { command: "bash", args: ["-c", "echo race"], cwd, env: {}, secretEnvNames: [], credentialMode: "host_environment" };

    try {
      const results = await Promise.allSettled([
        server.createSession({ sessionId: "race", userId: "u", attachToken: "t", launchPlan: plan }),
        server.createSession({ sessionId: "race", userId: "u", attachToken: "t", launchPlan: plan })
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.strictEqual(fulfilled.length, 1, "exactly one create should succeed");
      assert.strictEqual(rejected.length, 1, "exactly one create should be rejected");
      assert.match(
        (rejected[0] as PromiseRejectedResult).reason.message,
        /Session already exists/
      );
      assert.strictEqual(server.listSessions().length, 1);
    } finally {
      await server.destroy();
    }
  });
});

describe("handshake token file", () => {
  it("writes and reads back a 0600 token file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fb-ss-token-"));
    tempDirs.push(dir);
    const tokenPath = resolveSessionServerTokenPath(dir);
    const token = generateSessionServerToken();

    writeSessionServerTokenFile(tokenPath, token);

    if (!isWin) {
      assert.strictEqual(statSync(tokenPath).mode & 0o777, 0o600);
    }
    assert.strictEqual(readSessionServerTokenFile(tokenPath), token);
  });

  it("rejects a token file with invalid content", () => {
    const dir = mkdtempSync(join(tmpdir(), "fb-ss-token-bad-"));
    tempDirs.push(dir);
    const tokenPath = resolveSessionServerTokenPath(dir);
    writeFileSync(tokenPath, "too-short", { mode: 0o600 });
    assert.throws(() => readSessionServerTokenFile(tokenPath), /Invalid Session Server token file/);
  });
});
