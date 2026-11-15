import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { signJwt } from "../src/auth/jwt.js";
import { loadEnv } from "../src/config/env.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { createGatewayApp } from "../src/server.js";
import { createRuntimeSettingsStore } from "../src/services/runtime-settings.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import {
  SANDBOX_FAILURE_HINT, buildSeatbeltProfile, goalCheckSandboxCapability, goalCheckSandboxMode, isUnsandboxedCheckRequest,
  prepareCheckSandbox, setGoalCheckSandboxMode, toolchainReadRoots
} from "../src/services/agent/command-sandbox.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { ensureGoalSandbox, goalSandboxDir, runSandboxCommand, sandboxCommandEnv } from "../src/services/agent/goal-sandbox.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient, AgentLlmStreamEvent } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry, type AgentToolContext } from "../src/services/agent/tool-registry.js";
import { createGoalSandboxTools } from "../src/services/agent/tools/goal-sandbox.js";
import { AgentError } from "../src/services/agent/types.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";

const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-check-sandbox-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;
process.env.FORGEBADGER_JWT_SECRET = "0123456789abcdef0123456789abcdef";
process.env.FORGEBADGER_MASTER_KEY = "abcdef0123456789abcdef0123456789";

const isolationAvailable = goalCheckSandboxCapability().available;
const darwinOnly = { skip: isolationAvailable ? false : "macOS sandbox-exec is not available on this host" };

function setMode(mode: "on" | "off" | undefined): void {
  setGoalCheckSandboxMode(mode ?? "off");
}

function createDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  return db;
}

const profileInput = {
  workspace: "/state/goal-worktrees/g1", scratch: "/state/goal-check-scratch/ab12", home: "/Users/owner",
  denyRead: ["/state", "/Users/owner/project"], allowRead: ["/Users/owner/project/.git", "/Users/owner/.nvm/versions"]
};

describe("goal check sandbox profile", () => {
  it("orders rules so the write denies and read re-allows win", () => {
    const lines = buildSeatbeltProfile(profileInput).split("\n");
    const index = (prefix: string) => lines.findIndex(line => line.startsWith(prefix));
    assert.equal(lines[1], "(allow default)");
    assert.ok(index("(deny file-write*)") < index("(allow file-write* ") && index("(allow file-write* ") < index("(deny file-write* "));
    assert.ok(index("(deny file-read* ") < index("(allow file-read* "));
    assert.ok(index("(deny sysctl-read)") < index("(allow sysctl-read "));
    assert.ok(index("(deny process-info*)") < index("(allow process-info* (target self))"));
    assert.ok(index("(deny network*)") >= 0 && index("(deny mach-priv-task-port)") >= 0 && index("(deny signal)") >= 0);
  });

  it("denies Git metadata, the merge manifest and CLI configuration inside the workspace", () => {
    const deny = buildSeatbeltProfile(profileInput).split("\n").find(line => line.startsWith("(deny file-write* "))!;
    for (const entry of [".git", ".goal-manifest.json", ".claude/settings.json", ".claude/settings.local.json", ".mcp.json", "opencode.json", ".codex", ".claude/hooks"])
      assert.ok(deny.includes(`(literal "/state/goal-worktrees/g1/${entry}")`), entry);
    for (const entry of [".git", ".codex", ".opencode", ".claude/hooks"])
      assert.ok(deny.includes(`(subpath "/state/goal-worktrees/g1/${entry}")`), entry);
  });

  it("hides the home, state and project trees and re-opens only the listed roots", () => {
    const lines = buildSeatbeltProfile(profileInput).split("\n");
    const deny = lines.find(line => line.startsWith("(deny file-read* "))!;
    const allow = lines.find(line => line.startsWith("(allow file-read* "))!;
    for (const entry of ["/Users/owner", "/state", "/Users/owner/project", "/private/var/folders", "/Library/Keychains"])
      assert.ok(deny.includes(`(subpath "${entry}")`), entry);
    assert.equal(allow, '(allow file-read* (subpath "/state/goal-worktrees/g1") (subpath "/state/goal-check-scratch/ab12") (subpath "/Users/owner/project/.git") (subpath "/Users/owner/.nvm/versions"))');
    assert.ok(!allow.includes('(subpath "/Users/owner")'));
    const storeDeny = lines.findIndex(line => line.startsWith('(deny file-read* (subpath "/Users/owner/Library/pnpm/store")'));
    assert.ok(storeDeny > lines.indexOf(allow), "package stores are closed again after the toolchain allows");
  });

  it("pins the .claude directory itself after the workspace write allow", () => {
    const lines = buildSeatbeltProfile(profileInput).split("\n");
    const pin = lines.indexOf('(deny file-write-create file-write-unlink (literal "/state/goal-worktrees/g1/.claude"))');
    assert.ok(pin > lines.findIndex(line => line.startsWith("(allow file-write* ")));
  });

  it("allows only the user-lookup Mach service and no IP networking", () => {
    const profile = buildSeatbeltProfile(profileInput);
    assert.equal((profile.match(/allow mach-lookup/gu) ?? []).length, 1);
    assert.ok(profile.includes('(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))'));
    assert.ok(!/remote ip|local ip/u.test(profile));
    assert.ok(profile.includes('(allow network* (local unix-socket (subpath "/state/goal-check-scratch/ab12"))'));
    assert.ok(!profile.includes("kern.procargs"));
  });

  it("escapes unusual paths and refuses control characters or relative paths", () => {
    const odd = '/state/goal "quoted"\\dir (x); $HOME';
    const profile = buildSeatbeltProfile({ ...profileInput, workspace: odd });
    assert.ok(profile.includes(`(subpath ${JSON.stringify(odd)})`));
    for (const workspace of ["/state/line\nbreak", "/state/nul\u0000", "relative/path"])
      assert.throws(() => buildSeatbeltProfile({ ...profileInput, workspace }),
        (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_SANDBOX_UNAVAILABLE");
  });
});

describe("toolchain read roots", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-check-sandbox-home-")));
  after(() => fs.rmSync(home, { recursive: true, force: true }));
  const make = (relative: string) => { const target = path.join(home, relative); fs.mkdirSync(target, { recursive: true }); return target; };

  it("keeps PATH entries and a deep Node prefix under the home directory", () => {
    const bin = make(".local/bin");
    const nodeBin = make(".nvm/versions/node/v22/bin");
    fs.writeFileSync(path.join(nodeBin, "node"), "");
    const roots = toolchainReadRoots({ home, protectedRoots: [], pathValue: `${bin}:/usr/bin:relative`, execPath: path.join(nodeBin, "node") });
    assert.ok(roots.includes(bin));
    assert.ok(roots.includes(path.join(home, ".nvm/versions/node/v22")));
    assert.ok(roots.includes(path.join(home, ".nvm/versions")), "known version-manager tree");
    assert.ok(!roots.includes("/usr/bin"));
  });

  it("never re-opens the home directory, a shallow prefix or a protected tree", () => {
    const shallowBin = make("bin");
    fs.writeFileSync(path.join(shallowBin, "node"), "");
    const state = make(".forgebadger");
    const insideState = make(".forgebadger/tools/bin");
    const roots = toolchainReadRoots({ home, protectedRoots: [state], pathValue: `${home}:${insideState}:${make(".config")}`, execPath: path.join(shallowBin, "node") });
    assert.ok(!roots.includes(home), "PATH entry equal to home");
    assert.ok(!roots.some(root => root === state || root.startsWith(`${state}${path.sep}`)), "root inside the state directory");
    assert.ok(!roots.includes(path.join(home, ".config")), "single-segment PATH entry under home");
    // execPath ~/bin/node resolves its prefix to the home directory itself.
    assert.ok(roots.every(root => root !== home && path.relative(home, root).split(path.sep).length >= 2));
  });
});

describe("goal check sandbox mode", () => {
  afterEach(() => setMode(undefined));

  it("is off until the setting turns it on, and ignores the retired environment variable", () => {
    assert.equal(goalCheckSandboxMode(), "off");
    process.env.FORGEBADGER_GOAL_CHECK_SANDBOX = "on";
    try {
      assert.equal(goalCheckSandboxMode(), "off");
    } finally {
      delete process.env.FORGEBADGER_GOAL_CHECK_SANDBOX;
    }
    setMode("on");
    assert.equal(goalCheckSandboxMode(), "on");
  });

  it("treats unsandboxed as a host-run request only when isolation is enabled", () => {
    setMode("on");
    assert.equal(isUnsandboxedCheckRequest({ command: "x", unsandboxed: true }), true);
    assert.equal(isUnsandboxedCheckRequest({ command: "x", unsandboxed: "true" }), false);
    assert.equal(isUnsandboxedCheckRequest({ command: "x" }), false);
    assert.equal(isUnsandboxedCheckRequest(null), false);
    setMode("off");
    assert.equal(isUnsandboxedCheckRequest({ command: "x", unsandboxed: true }), false);
  });

  it("follows the saved settings-page switch when the Gateway starts and on later updates", async () => {
    const db = createDb();
    const env = loadEnv({ FORGEBADGER_JWT_SECRET: process.env.FORGEBADGER_JWT_SECRET, FORGEBADGER_MASTER_KEY: process.env.FORGEBADGER_MASTER_KEY });
    const admin = new UserRepository(db).create("sandbox-switch@example.com", "hash", { role: "admin" });
    createRuntimeSettingsStore(db, { env }).update(admin.id, { goal_check_sandbox: true });
    const masterKey = process.env.FORGEBADGER_MASTER_KEY!;
    const gateway = createGatewayApp({
      db, env, jwtSecret: process.env.FORGEBADGER_JWT_SECRET!, masterKey,
      sessionManager: new InMemorySessionManager({} as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      eventBus: new ForgeBadgerEventBus(),
      sessionServerIpcPath: "/tmp/forgebadger-test-check-sandbox.sock"
    });
    try {
      assert.equal(goalCheckSandboxMode(), "on");
      await new Promise<void>((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
      const port = (gateway.server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/runtime-settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${signJwt({ userId: admin.id, email: admin.email }, process.env.FORGEBADGER_JWT_SECRET!)}`
        },
        body: JSON.stringify({ goal_check_sandbox: false })
      });
      assert.equal(response.status, 200);
      assert.equal(goalCheckSandboxMode(), "off");
    } finally {
      await gateway.close();
      db.close();
    }
  });
});

/** LLM that requests goal_run_checks exactly once, then answers with text. */
function checkCallingLlm(argumentsJson: string): AgentLlmClient {
  let calls = 0;
  return {
    async stream(request) {
      calls += 1;
      if (calls === 1) {
        (request.onEvent as (event: AgentLlmStreamEvent) => void)({ type: "tool_call", toolCall: { id: "op-1", name: "goal_run_checks", arguments: argumentsJson } });
        return { message: "" };
      }
      return { message: "done" };
    },
    async summarize() { return ""; },
    async generateTitle() { return ""; }
  };
}

describe("unsandboxed checks in the approval gate", () => {
  const dbs: Database.Database[] = [];
  after(() => { for (const db of dbs) if (db.open) db.close(); });
  afterEach(() => setMode(undefined));

  /** A granted goal run whose model asks for one goal_run_checks call; the tool body is a stub, the gate is real. */
  async function gateRun(input: Record<string, unknown>, admission: { executionMode?: "coding" } = {}) {
    const db = createDb();
    dbs.push(db);
    const user = new UserRepository(db).create(`gate-${randomUUID()}@example.com`, "hash");
    const log = new CopilotConversationLog(db, user.id);
    const conversation = log.createConversation();
    let executed = 0;
    const registry = createAgentToolRegistry([{
      name: "goal_run_checks", description: "gate fixture", risk: "operate", requiresApproval: true,
      inputSchema: z.object({ command: z.string(), unsandboxed: z.boolean().optional() }).strict(),
      async execute() { executed += 1; return { exitCode: 0 }; }
    }]);
    const orchestrator = createCopilotOrchestrator({
      db, masterKey: process.env.FORGEBADGER_MASTER_KEY!, toolRegistry: registry, llm: checkCallingLlm(JSON.stringify(input)), eventBus: new ForgeBadgerEventBus()
    });
    const goalId = new CopilotGoalStore(db, user.id).createGoal({ conversationId: conversation.id, title: "Granted", spec: "s", grants: ["sandbox_checks"] }).id;
    // A coding sub-run is admitted under a live parent goal run of the same project (as goal_delegate does).
    let delegation = {};
    let runConversationId = conversation.id;
    if (admission.executionMode === "coding") {
      const projectId = randomUUID();
      const parentRunId = randomUUID();
      db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)").run(projectId, user.id, "p", "/tmp/fb-gate-project", "claude", "active");
      db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
        VALUES(?,?,?,'running',?,1,?,?,?)`).run(parentRunId, user.id, conversation.id, goalId, JSON.stringify({ userId: user.id, conversationId: conversation.id, userText: "goal", source: "user", projectId, goalId }), Date.now(), Date.now());
      delegation = { executionMode: "coding", projectId, parentRunId };
      runConversationId = log.createConversation("Goal coding").id;
    }
    const coding = admission.executionMode === "coding";
    const runId = await orchestrator.enqueue({ userId: user.id, conversationId: runConversationId, userText: "verify", source: "user", clientRequestId: randomUUID(), ...(coding ? {} : { goalId }), ...delegation });
    // goal_delegate binds the goal to the child run row after admission; the sub-run input never names it.
    if (coding) db.prepare("UPDATE copilot_runs SET goal_id=? WHERE user_id=? AND id=?").run(goalId, user.id, runId);
    await new Promise(resolve => setImmediate(resolve));
    await orchestrator.executeRun(user.id, runId);
    return {
      status: log.getRun(runId)?.status, pending: log.listPendingActions(runId), executed: () => executed,
      toolResults: () => log.listMessages(runConversationId).filter(message => message.kind === "tool_result").map(message => JSON.stringify(message)),
      async decide(approved: boolean) {
        const actionId = log.listPendingActions(runId)[0]!.id;
        await orchestrator.resumeAfterApproval({ userId: user.id, runId, actionId, approved });
        return log.getRun(runId)?.status;
      }
    };
  }

  it("lets the sandbox_checks grant cover an isolated check", async () => {
    setMode("on");
    const run = await gateRun({ command: "true" });
    assert.equal(run.pending.length, 0);
    assert.equal(run.executed(), 1);
    assert.equal(run.status, "completed");
  });

  it("parks an unsandboxed check for per-call owner approval despite the grant", async () => {
    setMode("on");
    const run = await gateRun({ command: "pnpm install", unsandboxed: true });
    assert.equal(run.executed(), 0, "the command must not run before the owner decides");
    assert.equal(run.pending.length, 1);
    assert.equal(run.pending[0]!.status, "pending");
    assert.equal(JSON.parse(run.pending[0]!.inputJson).unsandboxed, true, "the approval is bound to the unsandboxed input");
    assert.notEqual(run.status, "completed");
    assert.equal(await run.decide(true), "completed");
    assert.equal(run.executed(), 1, "the approved call runs exactly once");
  });

  it("never runs an unsandboxed check the owner rejected", async () => {
    setMode("on");
    const run = await gateRun({ command: "pnpm install", unsandboxed: true });
    await run.decide(false);
    assert.equal(run.executed(), 0);
  });

  it("refuses an unsandboxed check in a delegated coding sub-run and tells the model to hand it to the parent", async () => {
    setMode("on");
    const run = await gateRun({ command: "pnpm install", unsandboxed: true }, { executionMode: "coding" });
    assert.equal(run.executed(), 0);
    assert.equal(run.pending.length, 0, "a sub-run must never park on an approval");
    const results = run.toolResults().join("\n");
    assert.match(results, /unsandboxed: true needs the owner to approve that exact call/);
    assert.match(results, /parent goal run must perform the unsandboxed step/);
  });

  it("keeps today's grant behaviour when isolation is off", async () => {
    setMode("off");
    const run = await gateRun({ command: "pnpm install", unsandboxed: true });
    assert.equal(run.pending.length, 0);
    assert.equal(run.executed(), 1);
  });
});

interface ToolFixture {
  db: Database.Database;
  goalId: string;
  projectDir: string;
  sandboxDir: string;
  store: CopilotGoalStore;
  run(input: unknown, context?: Partial<AgentToolContext>): Promise<Record<string, unknown>>;
}

function toolFixture(): ToolFixture {
  const db = createDb();
  const user = new UserRepository(db).create(`tool-${randomUUID()}@example.com`, "hash");
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-check-sandbox-project-")));
  fs.writeFileSync(path.join(projectDir, "calc.txt"), "1+1\n");
  fs.writeFileSync(path.join(projectDir, ".env"), "PROJECT_SECRET=1\n");
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)").run(projectId, user.id, "checks", projectDir, "claude", "active");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Sandbox goal", spec: "verify" }).id;
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(runId, user.id, conversation.id, goalId, Date.now(), Date.now());
  const sandboxDir = goalSandboxDir(db, goalId);
  ensureGoalSandbox(projectDir, sandboxDir);
  const tool = createGoalSandboxTools().find(entry => entry.name === "goal_run_checks")!;
  const base = { db, userId: user.id, masterKey: "k", runId } as AgentToolContext;
  return { db, goalId, projectDir, sandboxDir, store, run: (input, context) => tool.execute(input, { ...base, ...context }) as Promise<Record<string, unknown>> };
}

describe("goal_run_checks under the isolation mode", () => {
  const dbs: Database.Database[] = [];
  function tracked(): ToolFixture { const fixture = toolFixture(); dbs.push(fixture.db); return fixture; }
  after(() => { for (const db of dbs) if (db.open) db.close(); });
  afterEach(() => setMode(undefined));

  it("returns today's result shape and verify record when isolation is off", async () => {
    setMode("off");
    const fixture = tracked();
    const taskId = fixture.store.addTasks(fixture.goalId, [{ description: "calc", verifyCommand: "cat calc.txt" }])[0]!.id;
    const result = await fixture.run({ command: "cat calc.txt", taskId, unsandboxed: true });
    assert.equal(result.exitCode, 0);
    assert.ok(!("isolation" in result) && !("sandboxHint" in result));
    const summary = fixture.store.listTasks(fixture.goalId)[0]!.evidence ?? "";
    assert.match(summary, /^verify: cat calc\.txt \(exit 0, \d+ms\)\n/u);
  });

  it("refuses an unsandboxed call that is not an owner-approved action or comes from a sub-run", async () => {
    setMode("on");
    const fixture = tracked();
    const marker = path.join(fixture.sandboxDir, "ran.txt");
    const refused = (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_UNSANDBOXED_APPROVAL";
    await assert.rejects(fixture.run({ command: "touch ran.txt", unsandboxed: true }), refused);
    await assert.rejects(fixture.run({ command: "touch ran.txt", unsandboxed: true }, { externalActionId: "action-1", executionMode: "coding" }), refused);
    assert.equal(fs.existsSync(marker), false);
    const approved = await fixture.run({ command: "touch ran.txt", unsandboxed: true }, { externalActionId: "action-1" });
    assert.equal(approved.isolation, "none");
    assert.equal(fs.existsSync(marker), true);
  });

  it("refuses to run instead of falling back when the host cannot isolate", { skip: isolationAvailable ? "host can isolate" : false }, async () => {
    setMode("on");
    const fixture = tracked();
    await assert.rejects(fixture.run({ command: "touch ran.txt" }),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_SANDBOX_UNAVAILABLE" && /unsandboxed: true/u.test(error.message));
    assert.equal(fs.existsSync(path.join(fixture.sandboxDir, "ran.txt")), false);
  });

  it("runs the check inside the sandbox and marks the verify record", darwinOnly, async () => {
    setMode("on");
    const fixture = tracked();
    const taskId = fixture.store.addTasks(fixture.goalId, [{ description: "calc", verifyCommand: "cat calc.txt && echo ok > out.txt" }])[0]!.id;
    const result = await fixture.run({ command: "cat calc.txt && echo ok > out.txt", taskId });
    assert.equal(result.exitCode, 0, String(result.stderr));
    assert.equal(result.isolation, "seatbelt");
    assert.ok(!("sandboxHint" in result));
    assert.match(fixture.store.listTasks(fixture.goalId)[0]!.evidence ?? "", /\(exit 0, \d+ms, sandboxed\)/u);
    const denied = await fixture.run({ command: `cat ${JSON.stringify(path.join(fixture.projectDir, ".env"))}` });
    assert.notEqual(denied.exitCode, 0);
    assert.equal(denied.sandboxHint, SANDBOX_FAILURE_HINT);
    assert.deepEqual(fs.readdirSync(path.join(stateRoot, "goal-check-scratch")), [], "scratch directories are removed after each call");
  });
});

describe("seatbelt enforcement on a linked worktree", darwinOnly, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-check-sandbox-wt-")));
  const project = path.join(root, "project");
  const workspace = path.join(root, "state", "goal-worktrees", "g1");
  const outside = path.join(root, "outside");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" });

  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(outside);
  fs.mkdirSync(path.dirname(workspace), { recursive: true });
  if (isolationAvailable) {
    git(project, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(project, "a.txt"), "a\n");
    fs.writeFileSync(path.join(project, ".gitignore"), ".env\n");
    fs.writeFileSync(path.join(project, ".env"), "PROJECT_SECRET=1\n");
    git(project, "add", "a.txt", ".gitignore");
    git(project, "commit", "-qm", "init");
    git(project, "worktree", "add", "-q", "-b", "forgebadger/goal-g1", workspace);
    fs.writeFileSync(path.join(root, "state", "forgebadger.db"), "db\n");
  }
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  async function sandboxed(command: string, timeoutMs?: number) {
    const plan = prepareCheckSandbox({ workspace, projectRoot: project, command, env: sandboxCommandEnv() });
    try { return await runSandboxCommand(workspace, command, timeoutMs, undefined, plan); } finally { plan.cleanup(); }
  }
  const expectDenied = async (command: string) => {
    const result = await sandboxed(command);
    assert.notEqual(result.exitCode, 0, `expected the sandbox to refuse: ${command}\n${result.stdout}${result.stderr}`);
  };
  const expectAllowed = async (command: string) => {
    const result = await sandboxed(command);
    assert.equal(result.exitCode, 0, `expected success: ${command}\n${result.stdout}${result.stderr}`);
    return result;
  };

  it("allows workspace and scratch writes and read-only git", async () => {
    await expectAllowed('echo x > new.txt && cat new.txt && echo y > "$TMPDIR/t" && test "$HOME" = "$TMPDIR"');
    const status = await expectAllowed("git status --short && git log --oneline -1");
    assert.match(status.stdout, /new\.txt/u);
  });

  it("keeps Git metadata read-only, including the worktree pointer and shared hooks", async () => {
    await expectDenied("git add new.txt && git -c user.email=t@example.com -c user.name=t commit -qm x");
    await expectDenied('echo "gitdir: /tmp/evil" > .git');
    await expectDenied("rm .git");
    await expectDenied("mv .git .git2");
    await expectDenied('echo x > .GIT');
    await expectDenied(`echo x > ${JSON.stringify(path.join(project, ".git", "hooks", "pre-commit"))}`);
    await expectDenied(`echo x > ${JSON.stringify(path.join(project, ".git", "worktrees", "g1", "commondir"))}`);
    assert.match(fs.readFileSync(path.join(workspace, ".git"), "utf8"), /^gitdir: /u);
  });

  it("blocks CLI configuration a dispatched CLI would execute from", async () => {
    await expectDenied("mkdir -p .claude && echo '{}' > .claude/settings.json");
    await expectDenied("echo '{}' > .mcp.json");
    await expectDenied("mkdir .codex");
    await expectDenied("mkdir -p .claude/hooks");
  });

  it("does not let the .claude directory be renamed away, replaced or created as a symlink", async () => {
    // A workspace whose project already ships CLI settings and hooks.
    fs.mkdirSync(path.join(workspace, ".claude", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".claude", "settings.json"), '{"hooks":{}}\n');
    fs.writeFileSync(path.join(workspace, ".claude", "hooks", "h.sh"), "true\n");
    await expectDenied("mv .claude .cl && echo evil > .cl/settings.json && mv .cl .claude");
    await expectDenied("mv .claude .cl2 && mkdir sneak && ln -s sneak .claude && echo evil > .claude/settings.json");
    await expectDenied("rm -rf .claude");
    await expectDenied("echo evil > .claude/hooks/h.sh");
    assert.equal(fs.lstatSync(path.join(workspace, ".claude")).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(workspace, ".claude", "settings.json"), "utf8"), '{"hooks":{}}\n');
    assert.equal(fs.readFileSync(path.join(workspace, ".claude", "hooks", "h.sh"), "utf8"), "true\n");
    await expectAllowed("echo notes > .claude/notes.md");
    fs.rmSync(path.join(workspace, ".claude"), { recursive: true, force: true });
    // Without the directory, the sandbox cannot plant one (a symlink would redirect the protected leaves).
    await expectDenied("mkdir sneak2 && ln -s sneak2 .claude");
    await expectDenied("mkdir .claude");
  });

  it("blocks writes outside the workspace, including through a symlink", async () => {
    await expectDenied(`echo x > ${JSON.stringify(path.join(outside, "pwn"))}`);
    await expectDenied(`echo x > ${JSON.stringify(path.join(project, "pwn"))}`);
    await expectDenied(`ln -s ${JSON.stringify(outside)} lnk && echo x > lnk/pwn`);
    await expectDenied(`ln ${JSON.stringify(path.join(project, "a.txt"))} hard && echo x > hard`);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(fs.readFileSync(path.join(project, "a.txt"), "utf8"), "a\n");
  });

  it("hides the project secrets, the state directory and the home directory", async () => {
    await expectDenied(`cat ${JSON.stringify(path.join(project, ".env"))}`);
    await expectDenied(`cat ${JSON.stringify(path.join(root, "state", "forgebadger.db"))}`);
    await expectDenied(`ls ${JSON.stringify(os.homedir())}`);
  });

  it("blocks IP networking, including a local listener", async () => {
    const server = net.createServer(socket => socket.end("hi"));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      await expectDenied(`${JSON.stringify(process.execPath)} -e "require('net').connect(${port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"`);
      await expectDenied(`${JSON.stringify(process.execPath)} -e "require('net').createServer().listen(0,'127.0.0.1',()=>process.exit(0)).on('error',()=>process.exit(1))"`);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  it("cannot signal or inspect processes outside the sandbox", async t => {
    await expectDenied(`kill -0 ${process.pid}`);
    // KERN_PROCARGS2 returns the exec-time environment of any same-user process; the Gateway's holds its secrets.
    const victim = spawn(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { env: { ...process.env, FB_SANDBOX_TEST_SECRET: "topsecret" }, stdio: "ignore" });
    try {
      await new Promise(resolve => victim.once("spawn", resolve));
      const script = path.join(workspace, "procargs.py");
      fs.writeFileSync(script, `import ctypes,ctypes.util,sys
l=ctypes.CDLL(ctypes.util.find_library('c'),use_errno=True)
mib=(ctypes.c_int*3)(1,49,${victim.pid});n=ctypes.c_size_t(1<<20);b=ctypes.create_string_buffer(1<<20)
r=l.sysctl(mib,3,b,ctypes.byref(n),None,0)
sys.exit(0 if r==0 and b'FB_SANDBOX_TEST_SECRET=topsecret' in b.raw else 7)`);
      let readableOutside = false;
      try { execFileSync("/usr/bin/python3", [script], { stdio: "ignore" }); readableOutside = true; } catch { /* no usable python3 on this host */ }
      // Exit 7 is the probe's own "could not read it": python started and the sandbox refused the sysctl.
      if (readableOutside) assert.equal((await sandboxed("/usr/bin/python3 procargs.py")).exitCode, 7);
      else t.diagnostic("python3 probe unavailable: environment-leak assertion skipped");
    } finally { victim.kill("SIGKILL"); }
    await expectDenied(`ps eww -p ${process.pid}`);
  });

  it("reaps background children when the command exits and removes its scratch directory", async () => {
    const result = await sandboxed("(sleep 30; echo late > late.txt) & echo started");
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /started/u);
    assert.ok(result.durationMs < 10_000, "the pipe held by the background child must not delay the result");
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(fs.existsSync(path.join(workspace, "late.txt")), false);
    assert.deepEqual(fs.readdirSync(path.join(root, "state", "goal-check-scratch")), []);
  });

  it("returns the command's own status when a detached child keeps the pipes open", async () => {
    // setsid leaves the process group, so the group kill cannot reach it; it stays sandboxed.
    fs.writeFileSync(path.join(workspace, "detach.js"),
      "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},8000)'],{detached:true,stdio:'inherit'});c.unref();console.log('parent done');");
    const result = await sandboxed(`${JSON.stringify(process.execPath)} detach.js`, 20_000);
    assert.equal(result.timedOut, false);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /parent done/u);
    assert.ok(result.durationMs < 6_000);
  });

  it("still kills the process group on timeout", async () => {
    const result = await sandboxed("sleep 30", 300);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
  });
});
