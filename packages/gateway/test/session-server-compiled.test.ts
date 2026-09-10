import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { it } from "node:test";

// Requires `pnpm --dir packages/gateway build` first. The npm package smoke
// independently exercises this production boundary after every package build.
it("plain Node compiled daemon creates a real PTY and renders output", {
  skip: process.env.RUN_COMPILED_SESSION_SERVER_TESTS !== "1"
}, async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "fb-built-"));
  const entry = new URL("../dist/src/services/session-server-integration.js", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { startAndConnectSessionServer } from ${JSON.stringify(entry)};
    const integration = await startAndConnectSessionServer({ stateDir: ${JSON.stringify(stateDir)} });
    try {
      await integration.client.createSession({
        name: 'compiled-session', cwd: ${JSON.stringify(stateDir)}, command: process.execPath,
        args: ['-e', 'console.log("compiled-pty-ready"); setInterval(()=>{}, 1000)'], env: {}
      });
      const deadline = Date.now() + 5000;
      while (!(await integration.client.capturePane('compiled-session')).includes('compiled-pty-ready')) {
        assert.ok(Date.now() < deadline, 'real PTY output must reach the rendered screen');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await integration.client.killSession('compiled-session');
      assert.equal(await integration.client.hasSession('compiled-session'), false);
      console.log('COMPILED_PTY_OK');
    } finally { await integration.stop(); }
  `;
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], {
      env, timeout: 20_000
    });
    assert.match(result.stdout, /COMPILED_PTY_OK/);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});
