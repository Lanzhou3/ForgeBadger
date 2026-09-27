import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "node:test";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { createCopilotRoutes } from "../src/routes/copilot.js";

it("deduplicates edited turns before truncation, preserves context, and rejects conflicting edit targets", async () => {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: new URL("../src/db/migrations", import.meta.url).pathname });
  const user = new UserRepository(db).create("edit-retry@example.com", "hash");
  const other = new UserRepository(db).create("other-edit-retry@example.com", "hash");
  const project = new ProjectRepository(db, user.id).create({ name: "Context", path: "/tmp/copilot-edit-context", aiTool: "kimi" });
  const ledger = new CopilotRunLedger(db, user.id);
  const conversation = ledger.log.createConversation();
  const message = ledger.log.appendMessage(conversation.id, { role: "user", kind: "text", content: "Original" });
  const secret = randomBytes(32).toString("hex");
  const app = express();
  app.locals.db = db;
  app.locals.jwtSecret = secret;
  app.use(express.json());
  app.use("/api/v1/copilot", createCopilotRoutes({ db, masterKey: randomBytes(32).toString("hex"), eventBus: new ForgeBadgerEventBus() }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/copilot/conversations/${conversation.id}/edit-message`;
  const post = (body: unknown, actor = user) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${signJwt({ userId: actor.id, email: actor.email }, secret)}` }, body: JSON.stringify(body) });
  const input = { messageId: message.id, content: "/skills", clientRequestId: randomUUID(), projectId: project.id, modelId: "chosen-model", toolDiscovery: true };
  try {
    const first = await post(input);
    assert.equal(first.status, 201);
    const runId = (await first.json() as { data: { runId: string } }).data.runId;
    const later = ledger.log.appendMessage(conversation.id, { role: "user", kind: "text", content: "Keep this newer message" });
    const before = ledger.log.listMessages(conversation.id);

    const retry = await post(input);
    assert.equal(retry.status, 201);
    assert.equal((await retry.json() as { data: { runId: string } }).data.runId, runId);
    assert.equal(ledger.log.listRuns(conversation.id).length, 1);
    assert.deepEqual(ledger.log.listMessages(conversation.id), before);
    const persisted = JSON.parse(ledger.get(runId)!.input_json);
    assert.equal(persisted.projectId, project.id);
    assert.equal(persisted.modelId, "chosen-model");
    assert.equal(persisted.toolDiscovery, true);
    assert.equal(persisted.editMessageId, message.id);
    assert.equal((await post({ ...input, messageId: later.id })).status, 409);
    assert.equal((await post({ ...input, content: "Changed payload" })).status, 409);
    assert.equal((await post(input, other)).status, 404);
    assert.deepEqual(ledger.log.listMessages(conversation.id), before);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  }
});
