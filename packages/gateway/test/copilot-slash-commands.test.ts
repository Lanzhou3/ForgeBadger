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
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { CopilotPreferencesRepository } from "../src/db/repositories/copilot-preferences-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotFollowups } from "../src/services/agent/followups.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { ensureGoalSandbox, goalSandboxDir } from "../src/services/agent/goal-sandbox.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient } from "../src/services/agent/orchestrator-types.js";
import { parseSlashInput, resolveLocalCommandReply, suggestCommands, listSlashCommands, helpText } from "../src/services/agent/slash-commands.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";

const masterKey = "abcdef0123456789abcdef0123456789";
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fb-slash-state-"));
process.env.FORGEBADGER_STATE_DIR = stateRoot;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function textLlm(reply: string): AgentLlmClient {
  return {
    async stream() { return { message: reply }; },
    async summarize() { return ""; },
    async generateTitle() { return ""; }
  };
}

interface CommandFixture {
  db: Database.Database;
  userId: string;
  conversationId: string;
  store: CopilotGoalStore;
  log: CopilotConversationLog;
  run(userText: string): Promise<string>;
}

function createFixture(): CommandFixture {
  const db = createTestDb();
  const user = new UserRepository(db).create("slash@example.com", "hash");
  const log = new CopilotConversationLog(db, user.id);
  const conversation = log.createConversation();
  const orchestrator = createCopilotOrchestrator({
    db, masterKey,
    toolRegistry: createAgentToolRegistry([]),
    llm: textLlm("model reply"),
    eventBus: new ForgeBadgerEventBus()
  });
  return {
    db, userId: user.id, conversationId: conversation.id,
    store: new CopilotGoalStore(db, user.id), log,
    async run(userText: string) {
      const runId = await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, userText });
      const messages = log.listMessages(conversation.id).filter(message => message.runId === runId && message.role === "assistant");
      return messages.at(-1)?.content ?? "";
    }
  };
}

describe("slash command registry parsing and matching", () => {
  it("parses line-start /name case-insensitively and keeps the rest as args", () => {
    assert.deepEqual(parseSlashInput("/GOAL do the thing"), { name: "goal", args: "do the thing" });
    assert.deepEqual(parseSlashInput("  /status \t"), { name: "status", args: "" });
    assert.deepEqual(parseSlashInput("/"), { name: "", args: "" });
    assert.equal(parseSlashInput("look /status"), undefined);
    assert.equal(parseSlashInput("status"), undefined);
  });

  it("suggests close commands by edit distance or subsequence", () => {
    assert.deepEqual(suggestCommands("skillz"), ["/skills"]);
    assert.ok(suggestCommands("goals").includes("/goals"));
    assert.deepEqual(suggestCommands(""), []);
    assert.deepEqual(suggestCommands("zzzz"), []);
  });

  it("unknown commands reply with suggestions instead of hitting the model", () => {
    const reply = resolveLocalCommandReply("/goel do x", () => []);
    assert.match(reply ?? "", /未知命令/);
    assert.match(reply ?? "", /\/goal/);
    assert.match(reply ?? "", /\/help/);
  });

  it("help text groups every command by category", () => {
    const text = helpText();
    for (const category of ["goal", "session", "model", "info"]) assert.match(text, new RegExp(`\\[${category}\\]`));
    for (const command of listSlashCommands()) assert.ok(text.includes(command.usage), `${command.usage} missing from /help`);
  });
});

describe("slash commands end to end", () => {
  const dbs: Database.Database[] = [];
  function tracked(): CommandFixture { const fixture = createFixture(); dbs.push(fixture.db); return fixture; }

  after(() => { for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  it("/goal creates the goal and binds it to the current run without short-circuiting", async () => {
    const fixture = tracked();
    const spec = "把 README 翻译成英文并补充示例";
    const reply = await fixture.run(`/goal ${spec}`);
    assert.equal(reply, "model reply");
    const goal = fixture.store.listGoals(fixture.conversationId)[0]!;
    assert.ok(goal);
    assert.equal(goal.title, spec.slice(0, 50));
    assert.equal(goal.status, "active");
    const run = fixture.log.listRuns(fixture.conversationId)[0]!;
    assert.equal((run as { goalId?: string }).goalId ?? (fixture.db.prepare("SELECT goal_id FROM copilot_runs WHERE id=?").get(run.id) as { goal_id: string | null }).goal_id, goal.id);
    const stored = JSON.parse((fixture.db.prepare("SELECT input_json FROM copilot_runs WHERE id=?").get(run.id) as { input_json: string }).input_json) as { goalId?: string };
    assert.equal(stored.goalId, goal.id);
  });

  it("/goal without spec replies with usage and creates nothing", async () => {
    const fixture = tracked();
    const reply = await fixture.run("/goal");
    assert.match(reply, /用法/);
    assert.equal(fixture.store.listGoals().length, 0);
  });

  it("/goals lists goals with status, progress and links", async () => {
    const fixture = tracked();
    const first = fixture.store.createGoal({ conversationId: fixture.conversationId, title: "First goal", spec: "s1" });
    fixture.store.createGoal({ conversationId: fixture.conversationId, title: "Second goal", spec: "s2" });
    const [task] = fixture.store.addTasks(first.id, ["t1"]);
    fixture.store.updateTask(first.id, task.id, "passes", "done");
    const reply = await fixture.run("/goals");
    assert.match(reply, /First goal/);
    assert.match(reply, /Second goal/);
    assert.match(reply, /任务 1\/1/);
    assert.match(reply, new RegExp(`/copilot/goals/${first.id}`));
  });

  it("/goal pause|resume|cancel drives the latest non-terminal goal", async () => {
    const fixture = tracked();
    fixture.store.createGoal({ conversationId: fixture.conversationId, title: "Lifecycle goal", spec: "s" });
    assert.match(await fixture.run("/goal pause"), /已暂停/);
    assert.equal(fixture.store.listGoals()[0]!.status, "paused");
    assert.match(await fixture.run("/GOAL RESUME"), /已恢复/);
    assert.equal(fixture.store.listGoals()[0]!.status, "active");
    assert.match(await fixture.run("/goal cancel"), /已取消/);
    assert.equal(fixture.store.listGoals()[0]!.status, "cancelled");
    const empty = tracked();
    assert.match(await empty.run("/goal pause"), /没有进行中的 Goal/);
  });

  it("/diff summarizes sandbox changes and guides when no sandbox exists", async () => {
    const fixture = tracked();
    assert.match(await fixture.run("/diff"), /没有可用的沙箱 diff/);
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-slash-project-"));
    fs.writeFileSync(path.join(projectDir, "a.txt"), "original\n");
    const projectId = randomUUID();
    fixture.db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
      .run(projectId, fixture.userId, "p", projectDir, "claude", "active");
    const goal = fixture.store.createGoal({ conversationId: fixture.conversationId, projectId, title: "Diff goal", spec: "s" });
    const sandbox = goalSandboxDir(fixture.db, goal.id);
    ensureGoalSandbox(projectDir, sandbox);
    fs.writeFileSync(path.join(sandbox, "b.txt"), "added\n");
    const reply = await fixture.run("/diff");
    assert.match(reply, /Diff goal/);
    assert.match(reply, /added 1/);
    assert.match(reply, /b\.txt/);
    assert.match(reply, new RegExp(`/copilot/goals/${goal.id}`));
  });

  it("/merge refuses active goals and merges completed ones with a journal entry", async () => {
    const fixture = tracked();
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-slash-merge-project-"));
    fs.writeFileSync(path.join(projectDir, "a.txt"), "original\n");
    const projectId = randomUUID();
    fixture.db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
      .run(projectId, fixture.userId, "p", projectDir, "claude", "active");
    const goal = fixture.store.createGoal({ conversationId: fixture.conversationId, projectId, title: "Merge goal", spec: "s" });
    const sandbox = goalSandboxDir(fixture.db, goal.id);
    ensureGoalSandbox(projectDir, sandbox);
    fs.writeFileSync(path.join(sandbox, "a.txt"), "rewritten\n");
    assert.match(await fixture.run("/merge"), /暂不能合并/);
    fixture.store.setStatus(goal.id, "completed");
    const reply = await fixture.run("/merge");
    assert.match(reply, /已合并/);
    assert.match(reply, /a\.txt/);
    assert.equal(fs.readFileSync(path.join(projectDir, "a.txt"), "utf8"), "rewritten\n");
    assert.ok(fixture.store.recentJournal(goal.id).some(entry => entry.note.includes("Merged sandbox")));
  });

  it("/answer resumes an awaiting_user goal and journals the answer", async () => {
    const fixture = tracked();
    assert.match(await fixture.run("/answer 方案A"), /没有等待答复/);
    const goal = fixture.store.createGoal({ conversationId: fixture.conversationId, title: "Asked goal", spec: "s" });
    fixture.store.setStatus(goal.id, "blocked", "awaiting_user");
    fixture.store.setPendingQuestion(goal.id, "Which one?");
    const reply = await fixture.run("/answer 方案A，选最小的改动");
    assert.match(reply, /已答复/);
    const updated = fixture.store.getGoal(goal.id)!;
    assert.equal(updated.status, "active");
    assert.equal(updated.pending_question, null);
    assert.ok(fixture.store.recentJournal(goal.id).some(entry => entry.note.includes("方案A，选最小的改动")));
  });

  it("/status reports run, model, token usage and active goals", async () => {
    const fixture = tracked();
    fixture.store.createGoal({ conversationId: fixture.conversationId, title: "Status goal", spec: "s" });
    const reply = await fixture.run("/status");
    assert.match(reply, /活跃 run/);
    assert.match(reply, /当前模型/);
    assert.match(reply, /token 用量/);
    assert.match(reply, /活跃 Goal：1 个/);
  });

  it("/stop cancels queued follow-ups", async () => {
    const fixture = tracked();
    new CopilotFollowups(fixture.db, fixture.userId).enqueue({ userId: fixture.userId, conversationId: fixture.conversationId, userText: "queued work", clientRequestId: "fq-1" });
    const reply = await fixture.run("/stop");
    assert.match(reply, /已取消 1 条排队 follow-up/);
    assert.equal(new CopilotFollowups(fixture.db, fixture.userId).list(fixture.conversationId)[0]!.status, "cancelled");
  });

  it("/usage reports conversation tokens and goal usage", async () => {
    const fixture = tracked();
    fixture.store.createGoal({ conversationId: fixture.conversationId, title: "Usage goal", spec: "s" });
    const reply = await fixture.run("/usage");
    assert.match(reply, /token 消耗/);
    assert.match(reply, /Usage goal/);
  });

  it("/model reports, lists and switches the persisted preference", async () => {
    const fixture = tracked();
    assert.match(await fixture.run("/model"), /当前模型/);
    assert.match(await fixture.run("/model list"), /尚未配置/);
    const repo = new ModelProviderRepository(fixture.db, fixture.userId, masterKey);
    const provider = repo.createProviderProfile({ name: "fixture", providerKey: "fixture", baseUrl: "https://8.8.8.8", apiFormat: "openai-compatible", authType: "api_key", supportedAdapters: ["opencode"] });
    repo.createCredential({ providerProfileId: provider.id, label: "t", plaintextSecret: "x" });
    const model = repo.createModelProfile({ providerProfileId: provider.id, name: "Fixture Model", modelId: "fixture-model", capabilities: ["chat"], isDefault: true });
    const reply = await fixture.run(`/model ${model.id}`);
    assert.match(reply, /已切换模型到 Fixture Model/);
    assert.equal(new CopilotPreferencesRepository(fixture.db, fixture.userId, masterKey).get().modelId, model.id);
    assert.match(await fixture.run("/model list"), /Fixture Model/);
    assert.match(await fixture.run("/model nope"), /没有找到模型/);
  });

  it("/goal with extra words after a lifecycle keyword creates a goal, not a lifecycle action (P2-8)", async () => {
    const fixture = tracked();
    const reply = await fixture.run("/goal cancel the legacy endpoint");
    assert.equal(reply, "model reply"); // not short-circuited
    const goal = fixture.store.listGoals(fixture.conversationId)[0]!;
    assert.equal(goal.title, "cancel the legacy endpoint");
    assert.equal(goal.status, "active");
    // Exact lifecycle forms still work.
    assert.match(await fixture.run("/goal cancel"), /已取消/);
  });

  it("/answer without content replies with usage instead of erroring (P2-14)", async () => {
    const fixture = tracked();
    const reply = await fixture.run("/answer");
    assert.match(reply, /用法：\/answer <内容>/);
  });

  it("/goal caps the spec at 20000 chars and truncates the title at 200 (P2-11)", async () => {
    const fixture = tracked();
    const longSpec = "x".repeat(20_001);
    const usage = await fixture.run(`/goal ${longSpec}`);
    assert.match(usage, /Goal spec 过长/);
    assert.equal(fixture.store.listGoals().length, 0);
    const spec200 = "题".repeat(300);
    await fixture.run(`/goal ${spec200}`);
    const goal = fixture.store.listGoals()[0]!;
    assert.equal(Array.from(goal.title).length, 200);
  });

  it("a throwing command handler answers with a failure reply instead of killing the run (P2-12)", async () => {
    const broken = createTestDb();
    const user = new UserRepository(broken).create("slash-broken@example.com", "hash");
    const conversation = new CopilotConversationLog(broken, user.id).createConversation();
    broken.close(); // every store query in the handler now fails
    const reply = await resolveLocalCommandReply("/status", () => [], {
      db: broken, masterKey: "k", userId: user.id, conversationId: conversation.id, runId: "run-1",
      args: "", listPlaybooks: () => [], continueGoal: () => undefined
    });
    assert.match(reply ?? "", /命令执行失败/);
  });

  it("/merge refuses while the goal has an active run (P1-7a slash alignment)", async () => {
    const fixture = tracked();
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-slash-merge-active-"));
    fs.writeFileSync(path.join(projectDir, "a.txt"), "original\n");
    const projectId = randomUUID();
    fixture.db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
      .run(projectId, fixture.userId, "p", projectDir, "claude", "active");
    const goal = fixture.store.createGoal({ conversationId: fixture.conversationId, projectId, title: "Merge gate", spec: "s" });
    const { ensureGoalSandbox, goalSandboxDir } = await import("../src/services/agent/goal-sandbox.js");
    ensureGoalSandbox(projectDir, goalSandboxDir(fixture.db, goal.id));
    // A delegate-style child run: active under the goal but in its own
    // conversation, so the slash turn itself can still be admitted.
    const childConversation = new CopilotConversationLog(fixture.db, fixture.userId).createConversation();
    fixture.db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
      VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(randomUUID(), fixture.userId, childConversation.id, goal.id, Date.now(), Date.now());
    const reply = await fixture.run("/merge");
    assert.match(reply, /有活跃 run/);
    fixture.db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=?")
      .run(Date.now(), fixture.userId, goal.id);
    fixture.store.setStatus(goal.id, "completed");
    assert.match(await fixture.run("/merge"), /已合并/);
  });

  it("/playbook loads content on hit and lists candidates on miss", async () => {
    const fixture = tracked();
    const miss = await fixture.run("/playbook does-not-exist");
    assert.match(miss, /没有找到 playbook/);
    const hit = await fixture.run("/playbook Session-Dispatch");
    assert.match(hit, /Playbook「session-dispatch」全文/);
  });
});

describe("GET /api/v1/copilot/commands", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let runtime: ReturnType<typeof createGatewayApp>;
  let baseUrl: string;

  before(async () => {
    const db = createTestDb();
    const app = runtime = createGatewayApp({
      sessionServerIpcPath: "/tmp/forgebadger-test-slash-commands.sock",
      jwtSecret: "0123456789abcdef0123456789abcdef",
      masterKey,
      db,
      llmFetch: (async () => { throw new Error("llm disabled"); }) as unknown as typeof fetch,
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
  });

  it("returns the registry as an authenticated envelope", async () => {
    const register = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "slash-commands@test.com", password: "password123" })
    });
    const token = ((await register.json()) as { data: { token: string } }).data.token;
    const unauthenticated = await fetch(`${baseUrl}/api/v1/copilot/commands`);
    assert.equal(unauthenticated.status, 401);
    const res = await fetch(`${baseUrl}/api/v1/copilot/commands`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { code: number; data: { commands: Array<{ name: string; usage: string; description: string; category: string }> } };
    assert.equal(body.code, 0);
    const names = body.data.commands.map(command => command.name);
    for (const expected of ["help", "goal", "goals", "diff", "merge", "answer", "model", "status", "stop", "new", "playbook", "playbooks", "usage", "skills"])
      assert.ok(names.includes(expected), `${expected} missing from /commands`);
    for (const command of body.data.commands) {
      assert.ok(["goal", "session", "model", "info"].includes(command.category), `bad category ${command.category}`);
      assert.ok(command.usage.startsWith(`/${command.name}`), `usage mismatch for ${command.name}`);
      assert.ok(command.description.length > 0);
    }
  });
});
