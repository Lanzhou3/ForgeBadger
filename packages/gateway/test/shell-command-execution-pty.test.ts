import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { SessionServer } from "../src/services/session-server/session-server.js";
import { IpcServer } from "../src/services/session-server/ipc-server.js";
import { SessionServerClient } from "../src/services/session-server-client.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { COPILOT_SHELL_NAME, runShellCommand, runShellCommandInSession } from "../src/services/shell-command-execution.js";

for (const binary of ["/bin/bash", "/bin/zsh", "/bin/sh"]) {
  it(`executes real PTY commands in ${binary} without echo completion or losing state`, {
    skip: process.platform === "win32" || !existsSync(binary), timeout: 20_000
  }, async () => {
    const root = mkdtempSync("/tmp/fb-shell-");
    const db = new Database(":memory:");
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
    const user = new UserRepository(db).create("pty@test.dev", "hash");
    const project = new ProjectRepository(db, user.id).create({ name: "PTY", path: root, aiTool: "claude" });
    const repo = new SessionRepository(db, user.id);
    const row = repo.create({ projectId: project.id, name: COPILOT_SHELL_NAME, aiTool: "terminal", workingDir: root, credentialMode: "host_environment" });
    const server = new SessionServer();
    const token = randomUUID();
    const ipc = new IpcServer({ ipcPath: join(root, "ipc.sock"), sessionServer: server, token });
    const client = new SessionServerClient({ ipcPath: join(root, "ipc.sock"), token });
    try {
      await ipc.start();
      await client.connect();
      const manager = new InMemorySessionManager(client, undefined, undefined, { db });
      const session = await manager.createSession({ userId: user.id, sessionId: row.id,
        launchPlan: { command: binary, args: binary.endsWith("bash") ? ["--noprofile", "--norc"] : binary.endsWith("zsh") ? ["-f"] : [], cwd: root, env: {}, secretEnvNames: [], credentialMode: "host_environment" } });
      repo.update(row.id, { runtimeSessionName: session.runtimeSessionName, status: "running" });
      const input = { db, userId: user.id, projectId: project.id, sessionManager: manager, sessionId: row.id, timeoutMs: 5_000 };
      const start = Date.now();
      const first = await runShellCommandInSession({ ...input, command: "sleep 0.4; printf 'no_newline'; false" });
      assert.equal(first.exitCode, 1);
      assert.ok(Date.now() - start >= 400, "input echo must not finish the call");
      assert.equal(first.output, "no_newline");
      assert.equal((await runShellCommandInSession({ ...input, command: "export FB_TEST_VALUE='你好 quoted\nsecond line'; cd /tmp" })).exitCode, 0);
      const second = await runShellCommandInSession({ ...input, command: "printf '%s\\n' \"$FB_TEST_VALUE\"; pwd" });
      assert.match(second.output, /你好 quoted\nsecond line\n\/?(?:private\/)?tmp/);
      assert.doesNotMatch(second.output, /no_newline|__FB_DONE_|printf '%b'/);
      const long = await runShellCommandInSession({ ...input, command: `printf '%s' '${"x".repeat(3900)}'` });
      assert.equal(long.exitCode, 0);
      assert.equal(long.output, "x".repeat(3900));
      const timed = await runShellCommandInSession({ ...input, command: `printf waiting; sleep 10; touch ${root}/should-not-exist`, timeoutMs: 100 });
      assert.equal(timed.timedOut, true);
      assert.match(timed.output, /waiting/);
      assert.equal(await client.hasSession(session.runtimeSessionName), false);
      assert.equal(repo.getById(row.id)?.status, "exited");
      assert.equal(existsSync(join(root, "should-not-exist")), false);
      const count = repo.list().length;
      const temporary = await runShellCommand({ db, userId: user.id, projectId: project.id, projectRoot: root, sessionManager: manager, command: "sleep 0.3; printf ephemeral", timeoutMs: 5_000 });
      assert.equal(temporary.exitCode, 0);
      assert.equal(temporary.output, "ephemeral");
      assert.equal(repo.list().length, count);
    } finally {
      await client.disconnect();
      await ipc.stop();
      await server.destroy();
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
