/**
 * Unit tests for the Session Server components:
 *   - SessionHandle
 *   - PlatformAdapter
 *   - IPC protocol encoding/decoding
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlatformAdapter } from "../src/services/session-server/platform-adapter.js";
import {
  type CreateSessionRequest,
  type ManagementResponse
} from "../src/services/session-server/ipc-protocol.js";

describe("PlatformAdapter", () => {
  it("creates a platform adapter for the current platform", () => {
    const adapter = createPlatformAdapter();
    assert.ok(adapter);
    assert.strictEqual(typeof adapter.getDefaultShell({}), "string");
    assert.strictEqual(typeof adapter.getIpcPath("/tmp"), "string");
  });

  it("POSIX adapter does not alter bare commands", () => {
    const adapter = createPlatformAdapter("linux");
    const resolved = adapter.resolveCommand("claude", {});
    assert.strictEqual(resolved.command, "claude");
    assert.deepStrictEqual(resolved.args, []);
  });

  it("Windows adapter resolves .cmd shims when present", () => {
    const adapter = createPlatformAdapter("win32");
    const dir = mkdtempSync(join(tmpdir(), "fb-winshim-"));
    try {
      const payload = join(dir, "node_modules", "example", "cli.js");
      writeFileSync(join(dir, "example.cmd"), `@node "${payload}" %*`);
      assert.deepStrictEqual(adapter.resolveCommand("example", { Path: dir }), {
        command: process.execPath, args: [payload]
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("Windows adapter resolves a bare name to its absolute .exe path", () => {
    // ConPTY's get_shell_path does exact-name matching without PATHEXT, so a
    // bare name must never reach spawn — the adapter must absolutize it.
    const dir = mkdtempSync(join(tmpdir(), "fb-winpath-"));
    try {
      const exePath = join(dir, "fakecli.exe");
      writeFileSync(exePath, "");
      const env = { Path: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
      const adapter = createPlatformAdapter("win32");
      const resolved = adapter.resolveCommand("fakecli", env);
      assert.strictEqual(resolved.command, exePath);
      assert.deepStrictEqual(resolved.args, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Windows adapter throws a descriptive error when the command is not on PATH", () => {
    const adapter = createPlatformAdapter("win32");
    assert.throws(
      () => adapter.resolveCommand("definitely-not-a-real-command-fb", {}),
      /Command not found on PATH: "definitely-not-a-real-command-fb"/u
    );
  });

  it("provides correct IPC path format", () => {
    const posixAdapter = createPlatformAdapter("linux");
    assert.ok(posixAdapter.getIpcPath("/tmp/fb").includes("session-server-v2.sock"));

    const winAdapter = createPlatformAdapter("win32");
    const winPipe = winAdapter.getIpcPath("C:\\fb");
    // Protocol-major version + stable user/state-directory digest
    assert.ok(/^\\\\\.\\pipe\\forgebadger-session-server-v2-[0-9a-f]{32}$/.test(winPipe), winPipe);
  });
});

describe("IPC Protocol", () => {
  it("encodes and decodes management requests", () => {
    const req: CreateSessionRequest = {
      id: "req-1",
      type: "create_session",
      sessionId: "s1",
      userId: "u1",
      attachToken: "tok-1",
      launchPlan: {
        command: "claude",
        args: ["--version"],
        cwd: "/tmp",
        env: { FOO: "bar" },
        secretEnvNames: [],
        credentialMode: "host_environment"
      }
    };

    const json = JSON.stringify(req);
    const decoded = JSON.parse(json) as CreateSessionRequest;

    assert.strictEqual(decoded.id, "req-1");
    assert.strictEqual(decoded.type, "create_session");
    assert.strictEqual(decoded.sessionId, "s1");
    assert.strictEqual(decoded.launchPlan.command, "claude");
  });

  it("encodes and decodes management responses", () => {
    const okResp: ManagementResponse = {
      id: "req-1",
      type: "ok",
      data: { content: "hello world" }
    };

    const errResp: ManagementResponse = {
      id: "req-2",
      type: "error",
      message: "Session not found"
    };

    assert.strictEqual(JSON.parse(JSON.stringify(okResp)).type, "ok");
    assert.strictEqual(JSON.parse(JSON.stringify(errResp)).type, "error");
  });
});
