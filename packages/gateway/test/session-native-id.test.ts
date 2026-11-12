import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isNativeSessionResolvable,
  probeLatestNativeSessionId
} from "../src/services/session-native-id.js";

function makeHome(): { env: NodeJS.ProcessEnv; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "fb-native-id-"));
  return {
    env: {} as NodeJS.ProcessEnv,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

function write(root: string, relative: string, content: string): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

const WORKING_DIR = "D:/Project/demo/app";

describe("native session probe (codex)", () => {
  it("returns the rollout session_id whose cwd matches the session working dir", async () => {
    const home = makeHome();
    try {
      write(home.dir, "sessions/2026/10/26/rollout-2026-10-26T14-57-18-01a176ff-ce02-7683-9a74-8df8c5f8e0fb.jsonl",
        JSON.stringify({ type: "session_meta", payload: { session_id: "01a176ff-ce02-7683-9a74-8df8c5f8e0fb", cwd: WORKING_DIR, timestamp: "2026-10-26T06:57:18.858Z" } }) + "\n");
      write(home.dir, "sessions/2026/10/26/rollout-2026-10-26T14-58-18-01a17700-0000-0000-0000-000000000000.jsonl",
        JSON.stringify({ type: "session_meta", payload: { session_id: "01a17700-0000-0000-0000-000000000000", cwd: "/other/project", timestamp: "2026-10-26T06:58:18.858Z" } }) + "\n");
      const id = await probeLatestNativeSessionId("codex", WORKING_DIR, { env: { ...home.env, CODEX_HOME: home.dir } });
      assert.equal(id, "01a176ff-ce02-7683-9a74-8df8c5f8e0fb");
    } finally {
      home.cleanup();
    }
  });
});

describe("native session probe (kimi)", () => {
  it("returns the state.json id of the newest matching workspace session", async () => {
    const home = makeHome();
    try {
      write(home.dir, "sessions/wd_demo_1234/session_11111111-aaaa-4bbb-8ccc-111111111111/state.json",
        JSON.stringify({ id: "session_11111111-aaaa-4bbb-8ccc-111111111111", cwd: "/stale/project", updatedAt: 2000 }));
      write(home.dir, "sessions/wd_demo_1234/session_22222222-bbbb-4ccc-8ddd-222222222222/state.json",
        JSON.stringify({ id: "session_22222222-bbbb-4ccc-8ddd-222222222222", cwd: WORKING_DIR, updatedAt: 3000 }));
      const id = await probeLatestNativeSessionId("kimi", WORKING_DIR, { env: { ...home.env, KIMI_CODE_HOME: home.dir } });
      assert.equal(id, "session_22222222-bbbb-4ccc-8ddd-222222222222");
    } finally {
      home.cleanup();
    }
  });
});

describe("native session probe (pi)", () => {
  it("returns the session-file header id for the matching cwd", async () => {
    const home = makeHome();
    try {
      const encoded = "--D--Project-demo-app--";
      write(home.dir, `sessions/${encoded}/2026-09-20T06-45-08-954Z_99999999-0000-4000-8000-111111111111.jsonl`,
        JSON.stringify({ type: "session", version: 3, id: "99999999-0000-4000-8000-111111111111", cwd: WORKING_DIR }) + "\n");
      write(home.dir, `sessions/other/2026-09-20T06-45-08-954Z_88888888-0000-4000-8000-111111111111.jsonl`,
        JSON.stringify({ type: "session", version: 3, id: "88888888-0000-4000-8000-111111111111", cwd: "/elsewhere" }) + "\n");
      const id = await probeLatestNativeSessionId("pi", WORKING_DIR, { env: { ...home.env, PI_CODING_AGENT_DIR: home.dir } });
      assert.equal(id, "99999999-0000-4000-8000-111111111111");
    } finally {
      home.cleanup();
    }
  });
});

describe("native session probe (claude)", () => {
  it("returns the sessionId of the newest matching transcript", async () => {
    const home = makeHome();
    try {
      write(home.dir, "projects/-d-project-demo-app/77777777-0000-4000-8000-111111111111.jsonl",
        JSON.stringify({ type: "user", sessionId: "77777777-0000-4000-8000-111111111111", cwd: WORKING_DIR }) + "\n");
      write(home.dir, "projects/-other/66666666-0000-4000-8000-111111111111.jsonl",
        JSON.stringify({ type: "user", sessionId: "66666666-0000-4000-8000-111111111111", cwd: "/nope" }) + "\n");
      const id = await probeLatestNativeSessionId("claude", WORKING_DIR, { env: { ...home.env, CLAUDE_CONFIG_DIR: home.dir } });
      assert.equal(id, "77777777-0000-4000-8000-111111111111");
    } finally {
      home.cleanup();
    }
  });
});

describe("isNativeSessionResolvable", () => {
  it("codex: true while the rollout file exists, false once it is gone", async () => {
    const home = makeHome();
    try {
      const env = { ...home.env, CODEX_HOME: home.dir };
      const id = "01a176ff-ce02-7683-9a74-8df8c5f8e0fb";
      assert.equal(await isNativeSessionResolvable("codex", id, WORKING_DIR, { env }), false);
      write(home.dir, `sessions/2026/10/26/rollout-2026-10-26T14-57-18-${id}.jsonl`, "{}\n");
      assert.equal(await isNativeSessionResolvable("codex", id, WORKING_DIR, { env }), true);
    } finally {
      home.cleanup();
    }
  });

  it("kimi: accepts the session_-prefixed id and the bare uuid", async () => {
    const home = makeHome();
    try {
      const env = { ...home.env, KIMI_CODE_HOME: home.dir };
      write(home.dir, "sessions/wd_demo_1234/session_22222222-bbbb-4ccc-8ddd-222222222222/state.json",
        JSON.stringify({ id: "session_22222222-bbbb-4ccc-8ddd-222222222222", cwd: WORKING_DIR }));
      assert.equal(await isNativeSessionResolvable("kimi", "session_22222222-bbbb-4ccc-8ddd-222222222222", WORKING_DIR, { env }), true);
      assert.equal(await isNativeSessionResolvable("kimi", "22222222-bbbb-4ccc-8ddd-222222222222", WORKING_DIR, { env }), true);
      assert.equal(await isNativeSessionResolvable("kimi", "00000000-dead-beef-0000-000000000000", WORKING_DIR, { env }), false);
    } finally {
      home.cleanup();
    }
  });

  it("opencode always resolves (resume flag auto-creates a missing session); grok never resolves", async () => {
    assert.equal(await isNativeSessionResolvable("opencode", "any-id", WORKING_DIR), true);
    assert.equal(await isNativeSessionResolvable("grok", "any-id", WORKING_DIR), false);
  });
});
