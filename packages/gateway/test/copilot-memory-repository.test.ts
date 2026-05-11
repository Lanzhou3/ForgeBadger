import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CopilotMemoryRepository } from "../src/db/repositories/copilot-memory-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("CopilotMemoryRepository", () => {
  let db: Database.Database;
  let userId: string;
  let otherUserId: string;
  let projectId: string;
  let repo: CopilotMemoryRepository;
  let otherRepo: CopilotMemoryRepository;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    userId = users.create("copilot-memory@example.com", "hash").id;
    otherUserId = users.create("other-copilot-memory@example.com", "hash").id;
    projectId = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    }).id;
    repo = new CopilotMemoryRepository(db, userId);
    otherRepo = new CopilotMemoryRepository(db, otherUserId);
  });

  it("creates durable memory entries scoped to the current user", () => {
    const entry = repo.createEntry({
      kind: "decision",
      scope: "global",
      text: "Provider SSOT is the baseline for model configuration."
    });
    otherRepo.createEntry({
      kind: "decision",
      scope: "global",
      text: "Foreign tenant decision"
    });

    const listed = repo.listEntries({ scope: "global" });

    assert.equal(entry.userId, userId);
    assert.equal(entry.kind, "decision");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, entry.id);
    assert.equal(otherRepo.getEntry(entry.id), undefined);
  });

  it("lists project-scoped and global durable entries separately", () => {
    const global = repo.createEntry({
      kind: "preference",
      scope: "global",
      text: "Keep Copilot provider-backed."
    });
    const project = repo.createEntry({
      kind: "project_note",
      scope: "project",
      projectId,
      text: "OpenForge Copilot should surface pending actions."
    });

    assert.deepEqual(repo.listEntries({ scope: "global" }).map((entry) => entry.id), [global.id]);
    assert.deepEqual(
      repo.listEntries({ scope: "project", projectId }).map((entry) => entry.id),
      [project.id]
    );
  });

  it("keeps working notes out of durable entry lists unless queried explicitly", () => {
    repo.createEntry({
      kind: "fact",
      scope: "global",
      text: "Gateway owns Copilot model calls."
    });
    const note = repo.createNote({
      projectId,
      text: "Recent observation about diagnostics export."
    });

    assert.equal(repo.listEntries({}).length, 1);
    assert.deepEqual(repo.listNotes({ projectId }).map((item) => item.id), [note.id]);
  });

  it("searches redacted durable entries and working notes without crossing tenants", () => {
    const entry = repo.createEntry({
      kind: "fact",
      scope: "project",
      projectId,
      text: "Copilot memory search should use bounded SQLite FTS."
    });
    const note = repo.createNote({
      projectId,
      text: "Working note: FTS search returns snippets."
    });
    otherRepo.createEntry({
      kind: "fact",
      scope: "global",
      text: "Foreign FTS memory should not appear."
    });

    const entriesOnly = repo.search({ query: "FTS", includeNotes: false });
    const withNotes = repo.search({ query: "FTS", includeNotes: true });

    assert.deepEqual(entriesOnly.map((result) => result.id), [entry.id]);
    assert.deepEqual(withNotes.map((result) => result.id).sort(), [entry.id, note.id].sort());
    assert.equal(otherRepo.search({ query: "FTS", includeNotes: true }).length, 1);
  });

  it("redacts secret-looking values before persistence and search indexing", () => {
    const entry = repo.createEntry({
      kind: "fact",
      scope: "global",
      text: "Use token=secret-value and Bearer abc.def plus sk-test123456.",
      metadata: { apiKey: "sk-metadata-secret", safe: "kept" }
    });

    const searchResult = repo.search({ query: "Bearer", includeNotes: false })[0];

    assert.match(entry.redactedText, /token=\[REDACTED\]/);
    assert.match(entry.redactedText, /Bearer \[REDACTED\]/);
    assert.match(entry.redactedText, /sk-\[REDACTED\]/);
    assert.doesNotMatch(entry.redactedText, /secret-value/);
    assert.deepEqual(entry.metadata, { apiKey: "[REDACTED]", safe: "kept" });
    assert.equal(searchResult?.id, entry.id);
    assert.doesNotMatch(searchResult?.snippet ?? "", /secret-value/);
  });
});
