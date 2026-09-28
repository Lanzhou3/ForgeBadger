import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_MIGRATIONS_DIR = path.join(REPO_ROOT, "packages", "gateway", "src", "db", "migrations");

export function validateMigrationChain(options = {}) {
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const metaDir = path.join(migrationsDir, "meta");
  const errors = [];
  const journal = readJson(path.join(metaDir, "_journal.json"), "journal", errors);
  const checksums = readJson(path.join(metaDir, "migration-checksums.json"), "checksum manifest", errors);
  if (!journal || !checksums) return { ok: false, errors };

  const filenames = readdirSync(migrationsDir)
    .filter((filename) => /^\d{4}_.+\.sql$/u.test(filename))
    .sort();
  validateJournal(journal.entries, filenames, errors);
  validateChecksums(migrationsDir, filenames, checksums, errors);
  return { ok: errors.length === 0, errors };
}

function readJson(filePath, label, errors) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`Could not read ${label}: ${error.message}`);
    return null;
  }
}

function validateJournal(entries, filenames, errors) {
  if (!Array.isArray(entries)) {
    errors.push("Migration journal entries must be an array.");
    return;
  }
  if (entries.length !== filenames.length) {
    errors.push(`Migration journal has ${entries.length} entries for ${filenames.length} SQL files.`);
  }
  entries.forEach((entry, position) => {
    const expectedTag = filenames[position]?.replace(/\.sql$/u, "");
    if (entry.idx !== position) errors.push(`Migration ${entry.tag ?? position} has idx ${entry.idx}; expected ${position}.`);
    if (expectedTag && entry.tag !== expectedTag) errors.push(`Migration journal tag ${entry.tag} does not match ${expectedTag}.`);
    if (position > 0 && entry.when <= entries[position - 1].when) {
      errors.push(`Migration ${entry.tag} timestamp must be greater than the previous entry.`);
    }
  });
}

function validateChecksums(migrationsDir, filenames, checksums, errors) {
  const manifestFiles = Object.keys(checksums).sort();
  if (manifestFiles.join("\n") !== filenames.join("\n")) {
    errors.push("Migration checksum manifest must contain exactly the journal SQL files.");
  }
  for (const filename of filenames) {
    const actual = createHash("sha256").update(readFileSync(path.join(migrationsDir, filename))).digest("hex");
    if (checksums[filename] !== actual) errors.push(`Migration checksum mismatch: ${filename}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateMigrationChain();
  if (!result.ok) {
    console.error(`ForgeBadger migration validation failed:\n${result.errors.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("ForgeBadger migration validation passed.");
  }
}
