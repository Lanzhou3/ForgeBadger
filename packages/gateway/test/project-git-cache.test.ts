import assert from "node:assert/strict";
import { it } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { getProjectGitChangesCached } from "../src/services/project-git.js";
import { ProjectGitChangesCache } from "../src/services/project-git-cache.js";

const empty = { isGitRepo: false, changed: [], commits: [] };

it("releases expired payloads without a subsequent read", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  t.after(() => t.mock.timers.reset());
  const cache = new ProjectGitChangesCache({ ttlMs: 50, maxEntries: 2, maxBytes: 1024 });
  cache.set("idle", empty);
  t.mock.timers.tick(50);
  assert.equal(cache.size, 0);
  assert.equal(cache.get("idle"), undefined);
});

it("bounds payload bytes and does not retain an oversized result", () => {
  const bytes = Buffer.byteLength(JSON.stringify(empty));
  const cache = new ProjectGitChangesCache({ ttlMs: 5_000, maxEntries: 64, maxBytes: bytes });
  cache.set("old", empty);
  cache.set("recent", empty);
  assert.equal(cache.get("old"), undefined);
  assert.equal(cache.get("recent"), empty);
  cache.set("recent", { ...empty, branch: "x".repeat(bytes) });
  assert.equal(cache.size, 0);
});

it("touches LRU order without extending TTL and cancels replaced entry timers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  t.after(() => t.mock.timers.reset());
  const cache = new ProjectGitChangesCache({ ttlMs: 50, maxEntries: 2, maxBytes: 1024 });
  cache.set("a", empty);
  cache.set("b", empty);
  cache.get("a");
  cache.set("c", empty);
  assert.equal(cache.get("b"), undefined);
  t.mock.timers.tick(25);
  cache.set("a", { ...empty, branch: "new" });
  t.mock.timers.tick(25);
  assert.equal(cache.get("a")?.branch, "new");
  assert.equal(cache.get("c"), undefined);
  t.mock.timers.tick(25);
  assert.equal(cache.size, 0);
});

it("evicts the least recently used project when the cache reaches its entry limit", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "forgebadger-git-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = path.join(root, "first");
  await mkdir(first);
  assert.equal((await getProjectGitChangesCached(first)).isGitRepo, false);
  await promisify(execFile)("git", ["init", "-b", "main"], { cwd: first });
  assert.equal((await getProjectGitChangesCached(first)).isGitRepo, false, "initial read is cached");

  for (let index = 0; index < 64; index++) {
    const other = path.join(root, String(index));
    await mkdir(other);
    await getProjectGitChangesCached(other);
  }

  assert.equal((await getProjectGitChangesCached(first)).isGitRepo, true, "eviction forces a fresh Git read");
});
