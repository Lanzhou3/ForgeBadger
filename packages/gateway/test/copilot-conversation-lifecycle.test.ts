import assert from "node:assert/strict";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  const user = new UserRepository(db).create("conversation-lifecycle@example.com", "hash");
  const ledger = new CopilotRunLedger(db, user.id);
  const conversation = ledger.log.createConversation("Original title");
  const input = { userId: user.id, conversationId: conversation.id, userText: "Run a task" };
  return { db, ledger, conversation, input };
}

it("hides an indeterminate conversation while preserving its execution evidence and edit protection", () => {
  const { db, ledger, conversation, input } = fixture();
  try {
    const runId = ledger.admit(input, 2);
    const claim = ledger.claim(runId, "worker", 30_000)!;
    const step = ledger.addStep(runId, { kind: "tool", toolName: "write", toolCallId: "write-1", effect: "write", inputJson: "{}" });
    ledger.startStep(claim, step);
    ledger.receipt(claim, step, "Delivery outcome unknown", true);
    const messages = ledger.log.listMessages(conversation.id);
    assert.throws(() => ledger.log.truncateAfterMessage(messages[0].id, "Rewrite", conversation.id), { code: "COPILOT_CONVERSATION_BUSY" });

    assert.equal(ledger.log.deleteConversation(conversation.id), true);

    assert.equal(ledger.log.getConversation(conversation.id), undefined);
    assert.deepEqual(ledger.log.listConversations(), []);
    assert.equal(ledger.get(runId)?.status, "indeterminate");
    assert.equal(ledger.steps(runId)[0].result_json, "Delivery outcome unknown");
    assert.deepEqual(ledger.log.listMessages(conversation.id), messages);
    assert.equal(ledger.claim(runId, "recovery", 30_000), undefined);
    assert.throws(() => ledger.admit(input, 2), { code: "COPILOT_NOT_FOUND" });
    assert.equal(ledger.log.deleteConversation(conversation.id), false);
  } finally { db.close(); }
});

it("retains a late write receipt after a cancelled conversation is hidden", () => {
  const { db, ledger, conversation, input } = fixture();
  try {
    const runId = ledger.admit(input, 2);
    const claim = ledger.claim(runId, "worker", 30_000)!;
    const step = ledger.addStep(runId, { kind: "tool", toolName: "write", toolCallId: "write-1", effect: "write", inputJson: "{}" });
    ledger.startStep(claim, step);
    ledger.cancel(runId);

    assert.equal(ledger.log.deleteConversation(conversation.id), true);
    ledger.receipt(claim, step, "Confirmed late result");

    assert.equal(ledger.steps(runId)[0].result_json, "Confirmed late result");
    assert.equal(ledger.get(runId)?.status, "cancelled");
    assert.equal(ledger.log.getConversation(conversation.id), undefined);
    assert.equal(ledger.log.listMessages(conversation.id).length, 1);
  } finally { db.close(); }
});

for (const status of ["pending", "running", "awaiting_approval"] as const) {
  it(`rejects hiding a conversation with a ${status} run`, () => {
    const { db, ledger, conversation, input } = fixture();
    try {
      const runId = ledger.admit(input, 2);
      if (status !== "pending") {
        const claim = ledger.claim(runId, "worker", 30_000)!;
        if (status === "awaiting_approval") {
          const step = ledger.addStep(runId, { kind: "tool", toolName: "write", effect: "write", inputJson: "{}" });
          ledger.waitApproval(claim, step);
        }
      }
      assert.throws(() => ledger.log.deleteConversation(conversation.id), { code: "COPILOT_CONVERSATION_BUSY" });
      assert.equal(ledger.log.getConversation(conversation.id)?.status, "active");
    } finally { db.close(); }
  });
}

it("cannot rename hidden conversations or hide another tenant's conversation", () => {
  const { db, ledger, conversation } = fixture();
  try {
    const other = new UserRepository(db).create("other-lifecycle@example.com", "hash");
    assert.equal(new CopilotRunLedger(db, other.id).log.deleteConversation(conversation.id), false);
    assert.equal(ledger.log.deleteConversation(conversation.id), true);

    assert.equal(ledger.log.renameConversation(conversation.id, "Unexpected title"), false);
    assert.equal(db.prepare("SELECT title FROM copilot_conversations WHERE id=?").get(conversation.id)?.title, "Original title");
  } finally { db.close(); }
});

it("persists project context on the conversation and applies it to subsequent runs", () => {
  const { db, ledger, conversation, input } = fixture();
  const root = mkdtempSync(join(tmpdir(), "fb-conversation-project-"));
  try {
    const now = Date.now();
    for (const id of ["project-a", "project-b"]) {
      db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, ledger.userId, id, join(root, id), "claude", "active", 0, now, now);
    }
    ledger.log.setConversationProject(conversation.id, "project-a");
    assert.equal(ledger.log.getConversation(conversation.id)?.project_id, "project-a");

    const runId = ledger.admit(input, 2);
    assert.equal(JSON.parse(ledger.get(runId)!.input_json).projectId, "project-a");
    assert.throws(() => ledger.admit({ ...input, projectId: "project-b" }, 2), { code: "COPILOT_CONVERSATION_PROJECT_MISMATCH" });
    assert.throws(() => ledger.log.setConversationProject(conversation.id, "project-b"), { code: "COPILOT_CONVERSATION_BUSY" });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects another tenant's project when binding conversation context", () => {
  const { db, ledger, conversation } = fixture();
  const root = mkdtempSync(join(tmpdir(), "fb-conversation-project-tenant-"));
  try {
    const other = new UserRepository(db).create("other-project-context@example.com", "hash");
    db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("foreign-project", other.id, "Foreign", root, "claude", "active", 0, Date.now(), Date.now());
    assert.throws(() => ledger.log.setConversationProject(conversation.id, "foreign-project"), { code: "COPILOT_PROJECT_NOT_FOUND" });
    assert.equal(ledger.log.getConversation(conversation.id)?.project_id, null);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
