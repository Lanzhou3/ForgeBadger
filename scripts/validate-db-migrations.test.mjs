import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { validateMigrationChain } from "./validate-db-migrations.mjs";

test("accepts an immutable, ordered migration chain", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forgebadger-migrations-"));
  const migrationsDir = path.join(root, "migrations");
  const metaDir = path.join(migrationsDir, "meta");
  await mkdir(metaDir, { recursive: true });
  const sql = "CREATE TABLE example (id text PRIMARY KEY);\n";
  const filename = "0001_initial.sql";
  await writeFile(path.join(migrationsDir, filename), sql);
  await writeFile(path.join(metaDir, "_journal.json"), JSON.stringify({
    entries: [{ idx: 0, version: "6", when: 1, tag: "0001_initial", breakpoints: true }]
  }));
  await writeFile(path.join(metaDir, "migration-checksums.json"), JSON.stringify({
    [filename]: createHash("sha256").update(sql).digest("hex")
  }));

  try {
    assert.deepEqual(validateMigrationChain({ migrationsDir }), { ok: true, errors: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a historical migration whose bytes changed", async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.migrationsDir, fixture.filename), "CREATE TABLE changed (id text);\n");
  try {
    const result = validateMigrationChain({ migrationsDir: fixture.migrationsDir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /checksum mismatch: 0001_initial\.sql/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a migration journal that is not strictly increasing", async () => {
  const fixture = await createFixture();
  const secondSql = "CREATE TABLE second_example (id text PRIMARY KEY);\n";
  const secondFilename = "0002_second.sql";
  await writeFile(path.join(fixture.migrationsDir, secondFilename), secondSql);
  await writeFile(path.join(fixture.metaDir, "_journal.json"), JSON.stringify({
    entries: [
      { idx: 0, version: "6", when: 2, tag: "0001_initial", breakpoints: true },
      { idx: 1, version: "6", when: 1, tag: "0002_second", breakpoints: true }
    ]
  }));
  await writeFile(path.join(fixture.metaDir, "migration-checksums.json"), JSON.stringify({
    [fixture.filename]: fixture.checksum,
    [secondFilename]: createHash("sha256").update(secondSql).digest("hex")
  }));
  try {
    const result = validateMigrationChain({ migrationsDir: fixture.migrationsDir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /timestamp must be greater/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "forgebadger-migrations-"));
  const migrationsDir = path.join(root, "migrations");
  const metaDir = path.join(migrationsDir, "meta");
  await mkdir(metaDir, { recursive: true });
  const sql = "CREATE TABLE example (id text PRIMARY KEY);\n";
  const filename = "0001_initial.sql";
  const checksum = createHash("sha256").update(sql).digest("hex");
  await writeFile(path.join(migrationsDir, filename), sql);
  await writeFile(path.join(metaDir, "_journal.json"), JSON.stringify({
    entries: [{ idx: 0, version: "6", when: 1, tag: "0001_initial", breakpoints: true }]
  }));
  await writeFile(path.join(metaDir, "migration-checksums.json"), JSON.stringify({ [filename]: checksum }));
  return { root, migrationsDir, metaDir, filename, checksum };
}
