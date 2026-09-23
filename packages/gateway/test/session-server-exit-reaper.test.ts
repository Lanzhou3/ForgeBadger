/**
 * Exit-reaper tests: sessions whose CLI leader exits while a descendant still
 * holds the process group cannot retire at onExit time. The reaper retries
 * retirement so the stop receipt becomes issuable once the group is gone —
 * and must never retire while the group lives or touch running sessions.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionServer } from "../src/services/session-server/session-server.js";

const posixOnly = { skip: process.platform === "win32" };

function launchPlan(shellCommand: string) {
  return {
    command: "/bin/sh",
    args: ["-c", shellCommand],
    cwd: process.cwd(),
    env: {},
    secretEnvNames: [],
    credentialMode: "host_environment" as const
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

it("exit reaper retires an exited session once its process group is gone", posixOnly, async () => {
  const server = new SessionServer();
  const dir = mkdtempSync(join(tmpdir(), "fb-reaper-"));
  try {
    const handle = await server.createSession({
      sessionId: "reap-quick",
      userId: "u1",
      attachToken: "tok",
      launchPlan: launchPlan("exit 0")
    });
    await waitFor(() => handle.status === "exited");
    const stop = server.startExitReaper(20);
    try {
      await waitFor(() => !server.hasSession("reap-quick"));
    } finally {
      stop();
    }
  } finally {
    await server.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("exit reaper keeps an exited session while its process group has survivors", posixOnly, async () => {
  const server = new SessionServer();
  try {
    const handle = await server.createSession({
      sessionId: "reap-linger",
      userId: "u1",
      attachToken: "tok",
      launchPlan: launchPlan("(trap '' HUP; sleep 30) & exit 0")
    });
    await waitFor(() => handle.status === "exited");
    const stop = server.startExitReaper(20);
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(server.hasSession("reap-linger"), true, "lingering group blocks retirement");
    } finally {
      stop();
    }
    // Once the survivor is gone, retirement succeeds and the receipt is recorded.
    process.kill(-handle.pty.pid, "SIGKILL");
    await waitFor(() => server.removeSession("reap-linger"));
    assert.equal(server.hasSession("reap-linger"), false);
  } finally {
    await server.destroy();
  }
});

it("exit reaper never touches running sessions", posixOnly, async () => {
  const server = new SessionServer();
  try {
    await server.createSession({
      sessionId: "reap-running",
      userId: "u1",
      attachToken: "tok",
      launchPlan: launchPlan("sleep 30")
    });
    const stop = server.startExitReaper(20);
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(server.hasSession("reap-running"), true);
      assert.equal(server.getSession("reap-running")?.status, "running");
    } finally {
      stop();
    }
  } finally {
    await server.destroy();
  }
});
