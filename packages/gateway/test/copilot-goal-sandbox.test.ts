import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { diffGoalSandbox, ensureGoalSandbox, goalSandboxDir, editSandboxFile, readSandboxFile, runSandboxCommand, sandboxCommandEnv, writeSandboxFile } from "../src/services/agent/goal-sandbox.js";
import { createGoalSandboxTools } from "../src/services/agent/tools/goal-sandbox.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";
import { AgentError } from "../src/services/agent/types.js";

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-sandbox-state-"));
process.env.FORGEBADGER_STATE_DIR = stateRoot;

interface SandboxFixture {
  db: Database.Database;
  userId: string;
  projectDir: string;
  goalId: string;
  runId: string;
  sandboxDir: string;
  tool(name: string): { execute(input: unknown, context: AgentToolContext): Promise<unknown> };
  context: AgentToolContext;
}

function createFixture(): SandboxFixture {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create("goal-sandbox@example.com", "hash");
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-project-"));
  fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "README.md"), "# Demo\nline2\nline3\n");
  fs.writeFileSync(path.join(projectDir, "src", "app.txt"), "original app\n");
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
    .run(projectId, user.id, "demo", projectDir, "claude", "active");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Sandbox goal", spec: "edit files" }).id;
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(runId, user.id, conversation.id, goalId, Date.now(), Date.now());
  const tools = new Map(createGoalSandboxTools().map(tool => [tool.name, tool]));
  const context = { db, userId: user.id, masterKey: "k", runId } as AgentToolContext;
  return { db, userId: user.id, projectDir, goalId, runId, sandboxDir: goalSandboxDir(db, goalId), tool: name => tools.get(name)!, context };
}

describe("goal sandbox", () => {
  const fixtures: Database.Database[] = [];
  function tracked(): SandboxFixture { const fixture = createFixture(); fixtures.push(fixture.db); return fixture; }

  after(() => { for (const db of fixtures) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  it("creates the sandbox lazily as a project copy and reuses it idempotently", () => {
    const fixture = tracked();
    const first = ensureGoalSandbox(fixture.projectDir, fixture.sandboxDir);
    assert.equal(first, fixture.sandboxDir);
    assert.equal(fs.readFileSync(path.join(first, "README.md"), "utf8"), "# Demo\nline2\nline3\n");
    const second = ensureGoalSandbox(fixture.projectDir, fixture.sandboxDir);
    assert.equal(second, first);
    // The copy includes nested files.
    assert.equal(fs.readFileSync(path.join(first, "src", "app.txt"), "utf8"), "original app\n");
  });

  it("writes, reads and edits sandbox files without touching the real project", async () => {
    const fixture = tracked();
    const write = fixture.tool("goal_file_write");
    const read = fixture.tool("goal_file_read");
    const edit = fixture.tool("goal_file_edit");
    await write.execute({ path: "docs/guide.md", content: "# Guide\nstep one\n" }, fixture.context);
    assert.equal(fs.readFileSync(path.join(fixture.sandboxDir, "docs", "guide.md"), "utf8"), "# Guide\nstep one\n");
    assert.equal(fs.existsSync(path.join(fixture.projectDir, "docs", "guide.md")), false);
    const readBack = await read.execute({ path: "docs/guide.md" }, fixture.context) as { content: string; totalLines: number; truncated: boolean };
    assert.equal(readBack.content, "# Guide\nstep one\n");
    assert.equal(readBack.totalLines, 3);
    const edited = await edit.execute({ path: "docs/guide.md", old_string: "step one", new_string: "step two" }, fixture.context) as { replacements: number };
    assert.equal(edited.replacements, 1);
    assert.equal(fs.readFileSync(path.join(fixture.sandboxDir, "docs", "guide.md"), "utf8"), "# Guide\nstep two\n");
  });

  it("rejects edit when old_string is missing or ambiguous", async () => {
    const fixture = tracked();
    const write = fixture.tool("goal_file_write");
    const edit = fixture.tool("goal_file_edit");
    await write.execute({ path: "a.txt", content: "one two one\n" }, fixture.context);
    await assert.rejects(edit.execute({ path: "a.txt", old_string: "three", new_string: "x" }, fixture.context),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_EDIT_NO_MATCH");
    await assert.rejects(edit.execute({ path: "a.txt", old_string: "one", new_string: "x" }, fixture.context),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_EDIT_AMBIGUOUS");
  });

  it("rejects traversal, absolute paths and symlink escapes", async () => {
    const fixture = tracked();
    ensureGoalSandbox(fixture.projectDir, fixture.sandboxDir);
    const outside = path.join(stateRoot, "outside-secret.txt");
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(fixture.sandboxDir, "escape-link"));
    assert.throws(() => writeSandboxFile(fixture.sandboxDir, "../outside-write.txt", "nope"), /escapes approved project root/);
    assert.throws(() => writeSandboxFile(fixture.sandboxDir, "/etc/goal-abs", "nope"), /absolute paths are not allowed/);
    // Symlink escapes fail closed; safeResolve may reject the resolved realpath
    // before the per-component symlink guard runs — any refusal is correct.
    assert.throws(() => readSandboxFile(fixture.sandboxDir, "escape-link"));
    assert.throws(() => writeSandboxFile(fixture.sandboxDir, "escape-link", "overwrite"));
    assert.throws(() => writeSandboxFile(fixture.sandboxDir, "escape-link/nested.txt", "x"));
    assert.equal(fs.readFileSync(outside, "utf8"), "secret");
  });

  it("produces added/modified/deleted diffs against the project root", async () => {
    const fixture = tracked();
    const write = fixture.tool("goal_file_write");
    await write.execute({ path: "added.txt", content: "brand new\n" }, fixture.context);
    await write.execute({ path: "README.md", content: "# Demo\nline2\nline3 changed\n" }, fixture.context);
    fs.rmSync(path.join(fixture.sandboxDir, "src", "app.txt"));
    const { files } = diffGoalSandbox(fixture.sandboxDir, fixture.projectDir);
    const byPath = new Map(files.map(file => [file.path, file]));
    assert.equal(byPath.get("added.txt")?.status, "added");
    assert.match(byPath.get("added.txt")?.diff ?? "", /\+brand new/);
    assert.equal(byPath.get("README.md")?.status, "modified");
    assert.match(byPath.get("README.md")?.diff ?? "", /-line3$/m);
    assert.match(byPath.get("README.md")?.diff ?? "", /\+line3 changed/);
    assert.equal(byPath.get("src/app.txt")?.status, "deleted");
    assert.match(byPath.get("src/app.txt")?.diff ?? "", /-original app/);
  });

  it("runs commands with a minimal secret-free environment (P0)", async () => {
    const fixture = tracked();
    ensureGoalSandbox(fixture.projectDir, fixture.sandboxDir);
    process.env.FORGEBADGER_MASTER_KEY_SENTINEL = "super-secret-value";
    process.env.RANDOM_API_TOKEN = "token-value";
    try {
      const direct = sandboxCommandEnv();
      assert.equal(direct.FORGEBADGER_MASTER_KEY_SENTINEL, undefined);
      assert.equal(direct.RANDOM_API_TOKEN, undefined);
      assert.equal(direct.PATH !== undefined, true);
      assert.equal(direct.HOME !== undefined, true);
      const result = await runSandboxCommand(fixture.sandboxDir, "printenv");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.includes("super-secret-value"), false);
      assert.equal(result.stdout.includes("token-value"), false);
      assert.equal(/FORGEBADGER_/u.test(result.stdout), false);
      assert.equal(result.stdout.includes("PATH="), true);
    } finally {
      delete process.env.FORGEBADGER_MASTER_KEY_SENTINEL;
      delete process.env.RANDOM_API_TOKEN;
    }
  });

  it("refuses sandbox tools outside a goal run context", async () => {
    const fixture = tracked();
    // A run id that belongs to no goal row resolves to no goal context.
    const read = fixture.tool("goal_file_read");
    await assert.rejects(read.execute({ path: "README.md" }, { ...fixture.context, runId: randomUUID() }),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_CONTEXT_REQUIRED");
  });
});
