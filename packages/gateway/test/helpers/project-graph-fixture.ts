import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import {
  getGraphOverview,
  getSymbolDetail,
  getSymbolImpact,
  getFileGraph,
  searchGraphSymbols
} from "../src/services/project-graph.js";

/**
 * Builds a miniature `.codegraph/codegraph.db` fixture mirroring the
 * CodeGraph v1.5 schema subset this service reads.
 *
 * Topology:
 *   src/a.ts  : file node, import node:fs, function greet (line 5)
 *   src/b.ts  : file node, function main (line 10) -- calls greet, imports greet
 *   src/c.tsx : file node, function entry (line 3), class Helper (line 8)
 *               entry calls main; c references main; greet instantiates Helper
 */
export function buildGraphFixture(projectRoot: string): void {
  const codegraphDir = path.join(projectRoot, ".codegraph");
  mkdirSync(codegraphDir, { recursive: true });
  const db = new Database(path.join(codegraphDir, "codegraph.db"));
  try {
    db.exec(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
        qualified_name TEXT NOT NULL, file_path TEXT NOT NULL, language TEXT NOT NULL,
        start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
        start_column INTEGER NOT NULL, end_column INTEGER NOT NULL,
        docstring TEXT, signature TEXT, visibility TEXT,
        is_exported INTEGER DEFAULT 0, is_async INTEGER DEFAULT 0,
        is_static INTEGER DEFAULT 0, is_abstract INTEGER DEFAULT 0,
        decorators TEXT, type_parameters TEXT, return_type TEXT,
        updated_at INTEGER NOT NULL);
      CREATE TABLE edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
        target TEXT NOT NULL, kind TEXT NOT NULL, metadata TEXT,
        line INTEGER, col INTEGER, provenance TEXT DEFAULT NULL,
        FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE);
      CREATE TABLE files (
        path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, language TEXT NOT NULL,
        size INTEGER NOT NULL, modified_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL,
        node_count INTEGER DEFAULT 0, errors TEXT);
      CREATE TABLE project_metadata (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE VIRTUAL TABLE nodes_fts USING fts5(
        id, name, qualified_name, docstring, signature,
        content='nodes', content_rowid='rowid');
    `);

    const insertNode = db.prepare(`
      INSERT INTO nodes (id, kind, name, qualified_name, file_path, language,
        start_line, end_line, start_column, end_column, signature, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 1700000000000)`);

    const node = (
      id: string,
      kind: string,
      name: string,
      filePath: string,
      language: string,
      startLine: number,
      qualifiedName?: string,
      signature?: string | null
    ) =>
      insertNode.run(
        id, kind, name, qualifiedName ?? name, filePath, language,
        startLine, startLine + 3, signature ?? null
      );

    node("file:a", "file", "a.ts", "src/a.ts", "ts", 1, "src/a.ts");
    node("import:a:fs", "import", "node:fs", "src/a.ts", "ts", 2, "node:fs");
    node("fn:greet", "function", "greet", "src/a.ts", "ts", 5, "a.greet",
      "function greet(name: string): string");
    node("file:b", "file", "b.ts", "src/b.ts", "ts", 1, "src/b.ts");
    node("fn:main", "function", "main", "src/b.ts", "ts", 10, "b.main",
      "function main(): void");
    node("file:c", "file", "c.tsx", "src/c.tsx", "tsx", 1, "src/c.tsx");
    node("fn:entry", "function", "entry", "src/c.tsx", "tsx", 3, "c.entry",
      "function entry(): void");
    node("cls:helper", "class", "Helper", "src/c.tsx", "tsx", 8, "c.Helper");

    const insertEdge = db.prepare(
      "INSERT INTO edges (source, target, kind, line, col) VALUES (?, ?, ?, ?, ?)"
    );
    const edge = (source: string, target: string, kind: string, line = 1) =>
      insertEdge.run(source, target, kind, line, 1);

    // contains
    edge("file:a", "import:a:fs", "contains", 2);
    edge("file:a", "fn:greet", "contains", 5);
    edge("file:b", "fn:main", "contains", 10);
    edge("file:c", "fn:entry", "contains", 3);
    edge("file:c", "cls:helper", "contains", 8);
    // cross-file dependencies with resolved targets
    edge("file:b", "fn:greet", "imports", 1);
    edge("file:c", "fn:main", "references", 4);
    // call chain entry -> main -> greet; greet instantiates Helper
    edge("fn:main", "fn:greet", "calls", 11);
    edge("fn:entry", "fn:main", "calls", 4);
    edge("fn:greet", "cls:helper", "instantiates", 6);

    const insertFile = db.prepare(`
      INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insertFile.run("src/a.ts", "h1", "ts", 100, 1700000000000, 1700000000000, 3);
    insertFile.run("src/b.ts", "h2", "ts", 120, 1700000000000, 1700000010000, 2);
    insertFile.run("src/c.tsx", "h3", "tsx", 200, 1700000000000, 1700000020000, 3);

    db.prepare(
      "INSERT INTO project_metadata (key, value, updated_at) VALUES ('index_state', 'complete', 1700000000000)"
    ).run();

    db.exec(`
      INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
      SELECT rowid, id, name, qualified_name, docstring, signature FROM nodes;
    `);
  } finally {
    db.close();
  }
}

/** A project root without any .codegraph directory. */
export function buildEmptyProject(projectRoot: string): void {
  mkdirSync(projectRoot, { recursive: true });
}

/** A .codegraph dir whose db lacks the expected tables. */
export function buildIncompatibleFixture(projectRoot: string): void {
  const codegraphDir = path.join(projectRoot, ".codegraph");
  mkdirSync(codegraphDir, { recursive: true });
  const db = new Database(path.join(codegraphDir, "codegraph.db"));
  try {
    db.exec("CREATE TABLE dummy (x TEXT)");
  } finally {
    db.close();
  }
}

export function makeTempRoot(label: string): { root: string; cleanup: () => void } {
  const root = path.join(tmpdir(), `of-graph-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
