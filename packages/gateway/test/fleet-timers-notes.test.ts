import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";
import { createGoalDelegateTools } from "../src/services/agent/tools/goal-delegate.js";
import { defaultCopilotTeam, setCopilotTeamRoster } from "../src/services/agent/team-roster.js";
import { AgentError } from "../src/services/agent/types.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { fleetContextMessage } from "../src/services/fleet/fleet-context.js";
import { FleetNotes, MAX_NOTE_BODY, MEMBER_MEMO_CHARS, NOTE_PREVIEW_CHARS } from "../src/services/fleet/fleet-notes.js";
import { FleetStore } from "../src/services/fleet/fleet-store.js";
import { FleetTimers, MAX_PENDING_TIMERS } from "../src/services/fleet/fleet-timers.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-timers-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;
process.env.CLAUDE_CONFIG_DIR = path.join(stateRoot, "claude-config");

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, stdio: "ignore",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "O", GIT_AUTHOR_EMAIL: "o@example.com",
      GIT_COMMITTER_NAME: "O", GIT_COMMITTER_EMAIL: "o@example.com" }
  });
}

const dbs: Database.Database[] = [];
function fixture(sharedDb?: Database.Database) {
  const db = sharedDb ?? new Database(":memory:");
  if (!sharedDb) {
    dbs.push(db);
    migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  }
  const user = new UserRepository(db).create(`fleet-tn-${randomUUID()}@example.com`, "hash");
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-tn-project-")));
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(dir, "init", "-q", "-b", "main"); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "init");
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)").run(projectId, user.id, "p", dir, "claude", "active");
  const store = new FleetStore(db, user.id);
  const fleet = store.createFleet({ projectId });
  return { db, userId: user.id, store, fleetId: fleet.id, conversationId: fleet.conversation_id, timers: new FleetTimers(db, user.id), notes: new FleetNotes(db, user.id) };
}

const rejectsCode = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;

after(() => { setCopilotTeamRoster(defaultCopilotTeam()); for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

describe("fleet timers", () => {
  it("fires a due timer exactly once into one timer_due event", () => {
    const f = fixture();
    const now = Date.now();
    const timer = f.timers.set(f.fleetId, { minutes: 10, note: "look at CI" }, now);
    assert.equal(timer.due_at, now + 10 * 60_000);
    assert.equal(f.timers.fireDue(now + 9 * 60_000), 0);
    assert.equal(f.timers.fireDue(now + 10 * 60_000), 1);
    assert.equal(f.timers.fireDue(now + 11 * 60_000), 0);
    // Even a re-fire after a manual reset cannot create a second wake-up.
    f.db.prepare("UPDATE fleet_timers SET status='pending' WHERE id=?").run(timer.id);
    assert.equal(f.timers.fireDue(now + 12 * 60_000), 1);
    const events = f.db.prepare("SELECT kind, dedupe_key, payload_json FROM fleet_events WHERE fleet_id=?").all(f.fleetId) as Array<{ kind: string; dedupe_key: string; payload_json: string }>;
    assert.deepEqual(events.map(e => [e.kind, e.dedupe_key]), [["timer_due", `timer:${timer.id}`]]);
    assert.equal(JSON.parse(events[0]!.payload_json).note, "look at CI");
    assert.equal(f.timers.get(f.fleetId, timer.id)!.status, "fired");
    assert.equal(f.timers.cancel(f.fleetId, timer.id).status, "fired", "cancel of a fired timer is a no-op");
  });

  it("caps pending timers at 20 and bounds the delay and the note", () => {
    const f = fixture();
    for (const minutes of [0, 1441, 1.5, -5]) assert.throws(() => f.timers.set(f.fleetId, { minutes, note: "n" }), rejectsCode("FLEET_INPUT_INVALID"), String(minutes));
    assert.throws(() => f.timers.set(f.fleetId, { minutes: 5, note: "  " }), rejectsCode("FLEET_INPUT_INVALID"));
    assert.throws(() => f.timers.set(f.fleetId, { minutes: 5, note: "x".repeat(1001) }), rejectsCode("FLEET_INPUT_INVALID"));
    assert.throws(() => f.timers.set(f.fleetId, { minutes: 5, note: "n", taskId: randomUUID() }), rejectsCode("COPILOT_NOT_FOUND"));
    f.timers.set(f.fleetId, { minutes: 1, note: "min" });
    const ids: string[] = [];
    for (let index = 1; index < MAX_PENDING_TIMERS; index += 1) ids.push(f.timers.set(f.fleetId, { minutes: 1440, note: `t${index}` }).id);
    assert.throws(() => f.timers.set(f.fleetId, { minutes: 5, note: "one too many" }), rejectsCode("FLEET_TIMER_LIMIT"));
    f.timers.cancel(f.fleetId, ids[0]!);
    assert.ok(f.timers.set(f.fleetId, { minutes: 5, note: "fits again" }).id);
    assert.equal(f.timers.listPending(f.fleetId).length, MAX_PENDING_TIMERS);
  });

  it("isolates tenants", () => {
    const a = fixture();
    const b = fixture(a.db);
    const timer = a.timers.set(a.fleetId, { minutes: 1, note: "mine" });
    assert.throws(() => b.timers.set(a.fleetId, { minutes: 1, note: "theirs" }), rejectsCode("COPILOT_NOT_FOUND"));
    assert.throws(() => b.timers.cancel(a.fleetId, timer.id), rejectsCode("COPILOT_NOT_FOUND"));
    assert.equal(b.timers.fireDue(Date.now() + 120_000), 0);
    assert.equal(a.timers.get(a.fleetId, timer.id)!.status, "pending");
  });
});

describe("fleet notes", () => {
  it("replaces notes whole, reads them back and validates scope references", () => {
    const f = fixture();
    const task = f.store.addTask(f.fleetId, { description: "T", createdBy: "owner" });
    f.notes.write(f.fleetId, "task", task.id, "first");
    f.notes.write(f.fleetId, "task", task.id, "second");
    assert.equal(f.notes.read(f.fleetId, "task", task.id)!.body, "second");
    assert.equal((f.db.prepare("SELECT count(*) AS c FROM fleet_notes WHERE fleet_id=?").get(f.fleetId) as { c: number }).c, 1);
    f.notes.write(f.fleetId, "fleet", undefined, "memo");
    assert.equal(f.notes.read(f.fleetId, "fleet", "")!.body, "memo");
    assert.throws(() => f.notes.write(f.fleetId, "fleet", "ref", "x"), rejectsCode("FLEET_INPUT_INVALID"));
    assert.throws(() => f.notes.write(f.fleetId, "task", randomUUID(), "x"), rejectsCode("COPILOT_NOT_FOUND"));
    assert.throws(() => f.notes.write(f.fleetId, "member", "Bad Id!", "x"), rejectsCode("FLEET_INPUT_INVALID"));
    assert.throws(() => f.notes.write(f.fleetId, "member", "claude-a", "x".repeat(MAX_NOTE_BODY + 1)), rejectsCode("FLEET_INPUT_INVALID"));
    assert.throws(() => f.notes.write(f.fleetId, "member", "claude-a", "   "), rejectsCode("FLEET_INPUT_INVALID"));
    f.notes.write(f.fleetId, "member", "claude-a", "y".repeat(MAX_NOTE_BODY));
    assert.equal(f.notes.read(f.fleetId, "member", "claude-a")!.body.length, MAX_NOTE_BODY);
  });

  it("indexes notes with clipped previews and puts only the index into the lead context", () => {
    const f = fixture();
    const task = f.store.addTask(f.fleetId, { description: "T", createdBy: "owner" });
    const long = `${"a".repeat(NOTE_PREVIEW_CHARS)}SECRET-TAIL`;
    f.notes.write(f.fleetId, "fleet", undefined, long);
    f.notes.write(f.fleetId, "task", task.id, long);
    f.notes.write(f.fleetId, "member", "claude-a", "short");
    const index = f.notes.index(f.fleetId);
    assert.deepEqual(index.map(entry => [entry.scope, entry.refId]), [["fleet", ""], ["task", task.id], ["member", "claude-a"]]);
    assert.equal(index[0]!.preview, `${"a".repeat(NOTE_PREVIEW_CHARS)}…`);
    const context = fleetContextMessage(f.db, f.userId, f.fleetId)!;
    assert.equal(context.includes("SECRET-TAIL"), false);
    assert.match(context, /"notes":\[\{"scope":"fleet","preview"/);
    assert.match(context, /"refId":"claude-a","preview":"short"/);
  });

  it("isolates tenants", () => {
    const a = fixture();
    const b = fixture(a.db);
    a.notes.write(a.fleetId, "fleet", undefined, "private");
    assert.throws(() => b.notes.read(a.fleetId, "fleet", undefined), rejectsCode("COPILOT_NOT_FOUND"));
    assert.throws(() => b.notes.write(a.fleetId, "fleet", undefined, "overwrite"), rejectsCode("COPILOT_NOT_FOUND"));
    assert.deepEqual(b.notes.index(a.fleetId), []);
    assert.equal(a.notes.read(a.fleetId, "fleet", undefined)!.body, "private");
  });

  it("appends the member memo (clipped) after the role preamble of a fleet dispatch", async () => {
    const f = fixture();
    setCopilotTeamRoster({ maxParallelWriters: 2, members: [{ id: "claude-a", name: "Ada", title: "Engineer", description: "Careful", adapter: "claude", roles: ["writer"], enabled: true }] });
    const staged: string[] = [];
    const ready = "some output\n────────────\n❯ \n────────────\n";
    let pane = ready;
    const sessionManager = new InMemorySessionManager({
      async createSession() {}, async killSession() {}, async listSessions() { return []; }, async hasSession() { return true; },
      async capturePane() { return pane; }, async inspectPane() { return { content: pane, dead: false }; },
      async stageProgrammaticInput(_name: string, data: string) { staged.push(data); pane = `────────────\n❯ ${data}\n────────────\n`; },
      async pressEnter() { pane = ready; }
    } as never, undefined, undefined, { sleep: async () => {} });
    const runId = randomUUID();
    f.db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at) VALUES(?,?,?,'running',?,1,'{}',?,?)`)
      .run(runId, f.userId, f.conversationId, f.fleetId, Date.now(), Date.now());
    const context = { db: f.db, userId: f.userId, masterKey: "k", runId, sessionManager, eventBus: new ForgeBadgerEventBus(),
      adapterCommandRunner: async (command: string) => ({ exitCode: 0, stdout: `${command} 1.0.0`, stderr: "" }) } as AgentToolContext;
    const memo = `Use pnpm, never npm. ${"m".repeat(MEMBER_MEMO_CHARS)}TAIL-NOT-SENT`;
    f.notes.write(f.fleetId, "member", "claude-a", memo);
    const task = f.store.addTask(f.fleetId, { description: "Build", fileScope: ["src"], createdBy: "owner" });
    const dispatch = createGoalDelegateTools().find(tool => tool.name === "goal_dispatch_task")!;
    await dispatch.execute({ taskId: task.id, memberId: "claude-a", instructions: "Do the thing" }, context);
    const sent = staged.at(-1)!;
    const role = sent.indexOf("You are Ada, Engineer.");
    const memoAt = sent.indexOf("Notes from the lead for you about this project:\nUse pnpm, never npm.");
    assert.ok(role > 0 && memoAt > role, "memo follows the role preamble");
    assert.equal(sent.includes("TAIL-NOT-SENT"), false);
    assert.match(sent, /File scope of this task: change only files under src\./);
  });
});
