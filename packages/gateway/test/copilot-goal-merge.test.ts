import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { ensureGoalSandbox, goalSandboxDir } from "../src/services/agent/goal-sandbox.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-merge-state-"));
process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;
process.env.FORGEBADGER_STATE_DIR = stateRoot;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

interface DiffFile { path: string; status: string; diff: string; truncated: boolean }
interface Envelope<T> { code: number; message: string; data?: T }

describe("goal diff and merge routes", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let runtime: ReturnType<typeof createGatewayApp>;
  let baseUrl: string;
  let db: Database.Database;

  before(async () => {
    db = createTestDb();
    const app = runtime = createGatewayApp({
      sessionServerIpcPath: "/tmp/forgebadger-test-goal-merge.sock",
      jwtSecret,
      masterKey,
      db,
      llmFetch: (async () => { throw new Error("llm disabled in route tests"); }) as unknown as typeof fetch,
      sessionManager: new InMemorySessionManager({
        async createSession() {}, async killSession() {}, async capturePane() { return ""; }, async listSessions() { return []; }
      } as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey })
    });
    await new Promise<void>((resolve) => {
      server = app.server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await runtime.close();
    fs.rmSync(stateRoot, { recursive: true, force: true });
  });

  const authed = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

  async function register(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    return ((await res.json()) as { data: { token: string } }).data.token;
  }

  async function setupProjectAndGoal(email: string): Promise<{ token: string; goalId: string; projectDir: string; sandboxDir: string; userId: string; conversationId: string }> {
    const token = await register(email);
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-merge-project-"));
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "README.md"), "# Project\nold line\n");
    fs.writeFileSync(path.join(projectDir, "src", "old.txt"), "to be removed\n");
    const user = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: string };
    const projectId = randomUUID();
    db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
      .run(projectId, user.id, "merge-demo", projectDir, "claude", "active");
    const conversation = await fetch(`${baseUrl}/api/v1/copilot/conversations`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
    const conversationId = ((await conversation.json()) as Envelope<{ conversation: { id: string } }>).data!.conversation.id;
    const created = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
      method: "POST", headers: authed(token),
      body: JSON.stringify({ conversationId, projectId, title: "Merge goal", spec: "update files" })
    });
    const goalId = ((await created.json()) as Envelope<{ goalId: string }>).data!.goalId;
    return { token, goalId, projectDir, sandboxDir: goalSandboxDir(db, goalId), userId: user.id, conversationId };
  }

  it("diff reports an empty file list without a sandbox", async () => {
    const { token, goalId } = await setupProjectAndGoal("goal-diff-empty@test.com");
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/diff`, { headers: authed(token) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Envelope<{ files: DiffFile[] }>;
    assert.deepEqual(body.data!.files, []);
    await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/cancel`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
  });

  it("merge 409s without a sandbox and 404s across tenants", async () => {
    const setup = await setupProjectAndGoal("goal-merge-missing@test.com");
    const missing = await fetch(`${baseUrl}/api/v1/copilot/goals/${setup.goalId}/merge`, { method: "POST", headers: authed(setup.token), body: JSON.stringify({}) });
    assert.equal(missing.status, 409);
    assert.equal(((await missing.json()) as { details: { code: string } }).details.code, "COPILOT_GOAL_SANDBOX_MISSING");
    const strangerToken = await register("goal-merge-stranger@test.com");
    const strangerDiff = await fetch(`${baseUrl}/api/v1/copilot/goals/${setup.goalId}/diff`, { headers: authed(strangerToken) });
    assert.equal(strangerDiff.status, 404);
    const strangerMerge = await fetch(`${baseUrl}/api/v1/copilot/goals/${setup.goalId}/merge`, { method: "POST", headers: authed(strangerToken), body: JSON.stringify({}) });
    assert.equal(strangerMerge.status, 404);
    await fetch(`${baseUrl}/api/v1/copilot/goals/${setup.goalId}/cancel`, { method: "POST", headers: authed(setup.token), body: JSON.stringify({}) });
  });

  it("diff shows added/modified/deleted (binary placeholder included) and merge returns merged/deleted/kept", async () => {
    const { token, goalId, projectDir, sandboxDir, userId } = await setupProjectAndGoal("goal-merge-flow@test.com");
    ensureGoalSandbox(projectDir, sandboxDir);
    fs.writeFileSync(path.join(sandboxDir, "added.txt"), "new content\n");
    fs.writeFileSync(path.join(sandboxDir, "README.md"), "# Project\nnew line\n");
    fs.writeFileSync(path.join(sandboxDir, "blob.bin"), Buffer.from([0, 1, 2, 0]));
    fs.rmSync(path.join(sandboxDir, "src", "old.txt"));
    // Project-side additions after sandbox creation must survive the merge.
    fs.writeFileSync(path.join(projectDir, "external.txt"), "added by the owner\n");

    const diffRes = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/diff`, { headers: authed(token) });
    assert.equal(diffRes.status, 200);
    const diffBody = (await diffRes.json()) as Envelope<{ files: DiffFile[]; truncated: boolean }>;
    assert.equal(typeof diffBody.data!.truncated, "boolean");
    const byPath = new Map(diffBody.data!.files.map(file => [file.path, file]));
    assert.equal(byPath.get("added.txt")?.status, "added");
    assert.match(byPath.get("added.txt")?.diff ?? "", /\+new content/);
    assert.equal(byPath.get("README.md")?.status, "modified");
    assert.match(byPath.get("README.md")?.diff ?? "", /-old line/);
    assert.equal(byPath.get("src/old.txt")?.status, "deleted");
    assert.equal(byPath.get("blob.bin")?.status, "added");
    assert.match(byPath.get("blob.bin")?.diff ?? "", /binary file omitted/);

    // Merge is gated on a settled goal: settle the initializer run + goal.
    db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=? AND status IN ('pending','running')")
      .run(Date.now(), userId, goalId);
    const store = new CopilotGoalStore(db, userId);
    store.setStatus(goalId, "completed");

    const mergeRes = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/merge`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
    assert.equal(mergeRes.status, 200);
    const mergeBody = (await mergeRes.json()) as Envelope<{ merged: string[]; deleted: string[]; kept: string[] }>;
    assert.deepEqual(mergeBody.data!.merged, ["README.md", "added.txt", "blob.bin"]);
    assert.deepEqual(mergeBody.data!.deleted, ["src/old.txt"]);
    assert.deepEqual(mergeBody.data!.kept, ["external.txt"]);
    assert.equal(fs.readFileSync(path.join(projectDir, "README.md"), "utf8"), "# Project\nnew line\n");
    assert.equal(fs.readFileSync(path.join(projectDir, "added.txt"), "utf8"), "new content\n");
    assert.equal(fs.existsSync(path.join(projectDir, "src", "old.txt")), false);
    assert.equal(fs.readFileSync(path.join(projectDir, "external.txt"), "utf8"), "added by the owner\n");
    assert.ok(store.recentJournal(goalId).some(entry => entry.note.includes("Merged sandbox into project")));
  });

  it("merge 409s while the goal has an active run", async () => {
    const { token, goalId, projectDir, sandboxDir, userId } = await setupProjectAndGoal("goal-merge-active@test.com");
    ensureGoalSandbox(projectDir, sandboxDir);
    fs.writeFileSync(path.join(sandboxDir, "a.txt"), "change\n");
    db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=? AND status IN ('pending','running')")
      .run(Date.now(), userId, goalId);
    new CopilotGoalStore(db, userId).setStatus(goalId, "completed");
    db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
      VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(crypto.randomUUID(), userId,
      (db.prepare("SELECT conversation_id FROM copilot_goals WHERE id=?").get(goalId) as { conversation_id: string }).conversation_id,
      goalId, Date.now(), Date.now());
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/merge`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { details: { code: string } }).details.code, "COPILOT_GOAL_STATE");
    // The half-merge guard kept the project untouched.
    assert.equal(fs.existsSync(path.join(projectDir, "a.txt")), false);
    await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/cancel`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
  });

  it("merge 409s on dry-run type conflicts without touching the project", async () => {
    const { token, goalId, projectDir, sandboxDir, userId } = await setupProjectAndGoal("goal-merge-conflict@test.com");
    ensureGoalSandbox(projectDir, sandboxDir);
    // Sandbox has a file where the project has a directory.
    fs.rmSync(path.join(sandboxDir, "README.md"));
    fs.mkdirSync(path.join(sandboxDir, "README.md"));
    fs.writeFileSync(path.join(sandboxDir, "README.md", "sub.txt"), "x\n");
    db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=? AND status IN ('pending','running')")
      .run(Date.now(), userId, goalId);
    new CopilotGoalStore(db, userId).setStatus(goalId, "completed");
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/merge`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { details: { code: string }; message: string };
    assert.equal(body.details.code, "COPILOT_GOAL_MERGE_CONFLICT");
    assert.match(body.message, /README\.md/);
    assert.equal(fs.readFileSync(path.join(projectDir, "README.md"), "utf8"), "# Project\nold line\n");
    await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/cancel`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
  });
});
