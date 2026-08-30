import { existsSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { safeResolve } from "../lib/safe-resolve.js";

/**
 * Read-only access to a project's local CodeGraph index
 * (`{projectRoot}/.codegraph/codegraph.db`).
 *
 * The index is owned by the CodeGraph CLI/daemon; this module never writes to
 * it. Connections are request-scoped and opened with `readonly`, so concurrent
 * daemon writes (WAL mode) stay safe. All statements are parameterized.
 */

export type GraphUnavailableReason =
  | "not_initialized"
  | "schema_unsupported"
  | "not_found"
  | "error";

export interface GraphUnavailable {
  available: false;
  reason: GraphUnavailableReason;
}

function unavailable(reason: GraphUnavailableReason): GraphUnavailable {
  return { available: false, reason };
}

/** Raised when the configured project root is unsafe (denied/invalid). */
export class ProjectGraphPathError extends Error {}

export interface DistributionEntry {
  key: string;
  count: number;
}

export interface GraphOverview {
  available: true;
  indexState: string | null;
  indexedAt: number | null;
  files: { total: number; byLanguage: DistributionEntry[] };
  nodes: { total: number; byKind: DistributionEntry[] };
  edges: { total: number; byKind: DistributionEntry[] };
}
export type GraphOverviewResult = GraphOverview | GraphUnavailable;

export interface GraphSymbolRef {
  id: string;
  name: string;
  qualifiedName: string;
  kind: string;
  filePath: string;
  startLine: number;
  signature?: string | null;
}

export interface GraphSearchResult {
  available: true;
  symbols: GraphSymbolRef[];
}
export type GraphSearchResultUnion = GraphSearchResult | GraphUnavailable;

export interface GraphNeighborRef extends GraphSymbolRef {
  edgeKind: string;
}

export interface SymbolDetail {
  available: true;
  symbol: GraphSymbolRef;
  callers: GraphNeighborRef[];
  callees: GraphNeighborRef[];
}
export type SymbolDetailResult = SymbolDetail | GraphUnavailable;

export interface ImpactNode extends GraphSymbolRef {
  depth: number;
}

export interface ImpactEdge {
  source: string;
  target: string;
  kind: string;
}

export interface ImpactSubgraph {
  available: true;
  rootId: string;
  depth: number;
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  truncated: boolean;
}
export type ImpactSubgraphResult = ImpactSubgraph | GraphUnavailable;

export interface FileGraphNode {
  path: string;
  language?: string | null;
}

export interface FileGraphEdge {
  source: string;
  target: string;
  weight: number;
  /** Per-edge-kind contribution to `weight` (e.g. imports/references). */
  kinds: Record<string, number>;
}

export interface FileGraph {
  available: true;
  nodes: FileGraphNode[];
  edges: FileGraphEdge[];
  truncated: boolean;
}
export type FileGraphResult = FileGraph | GraphUnavailable;

const REQUIRED_TABLES = ["nodes", "edges", "files", "nodes_fts", "project_metadata"];
const REQUIRED_NODE_COLUMNS = ["id", "kind", "name", "qualified_name", "file_path", "start_line"];

const DETAIL_EDGE_KINDS = ["calls", "references", "instantiates"];
const IMPACT_EDGE_KINDS = ["calls", "references", "instantiates"];
const FILE_GRAPH_EDGE_KINDS = ["imports", "references"];

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const NEIGHBOR_LIMIT = 20;
const MAX_IMPACT_NODES = 500;
const DEFAULT_FILE_GRAPH_LIMIT = 80;
const MAX_FILE_GRAPH_LIMIT = 200;

interface NodeRow {
  id: string;
  name: string;
  qualified_name: string;
  kind: string;
  file_path: string;
  start_line: number;
  signature?: string | null;
}

interface OpenedDb {
  db: Database.Database;
}

class UnavailableResult {
  constructor(public readonly result: GraphUnavailable) {}
}

/**
 * Opens the project's codegraph.db read-only. Returns an `UnavailableResult`
 * when the index is absent or incompatible; throws `ProjectGraphPathError`
 * when the configured root itself is unsafe.
 */
function openGraphDb(projectRoot: string): OpenedDb | UnavailableResult {
  let dbPath: string;
  try {
    dbPath = safeResolve(projectRoot, path.join(".codegraph", "codegraph.db"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      return new UnavailableResult(unavailable("not_initialized"));
    }
    throw new ProjectGraphPathError(
      error instanceof Error ? "Invalid project path configuration" : "Invalid project path"
    );
  }

  if (!existsSync(dbPath)) {
    return new UnavailableResult(unavailable("not_initialized"));
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return new UnavailableResult(unavailable("error"));
  }

  if (!hasRequiredSchema(db)) {
    db.close();
    return new UnavailableResult(unavailable("schema_unsupported"));
  }
  return { db };
}

function hasRequiredSchema(db: Database.Database): boolean {
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map((row) => row.name)
    );
    for (const table of REQUIRED_TABLES) {
      if (!tables.has(table)) return false;
    }
    const columns = (
      db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>
    ).map((row) => row.name);
    for (const column of REQUIRED_NODE_COLUMNS) {
      if (!columns.includes(column)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `fn` with an open graph database, translating every failure mode into
 * either a structured unavailability or a `ProjectGraphPathError` (which
 * routes map to HTTP 400). Always closes the handle.
 */
function withGraphDb<T>(
  projectRoot: string,
  fn: (db: Database.Database) => T
): T | GraphUnavailable {
  let opened: OpenedDb | UnavailableResult;
  try {
    opened = openGraphDb(projectRoot);
  } catch (error) {
    if (error instanceof ProjectGraphPathError) throw error;
    return unavailable("error");
  }
  if (opened instanceof UnavailableResult) {
    return opened.result;
  }
  try {
    return fn(opened.db);
  } catch {
    return unavailable("error");
  } finally {
    opened.db.close();
  }
}

/** Normalizes stored paths to project-relative form (defensive). */
function toRelativePath(projectRoot: string, filePath: string): string {
  if (!path.isAbsolute(filePath)) return filePath;
  const relative = path.relative(projectRoot, filePath);
  return relative.startsWith("..") ? filePath : relative;
}

function toSymbolRef(row: NodeRow, projectRoot: string): GraphSymbolRef {
  return {
    id: row.id,
    name: row.name,
    qualifiedName: row.qualified_name,
    kind: row.kind,
    filePath: toRelativePath(projectRoot, row.file_path),
    startLine: row.start_line,
    ...(row.signature !== undefined ? { signature: row.signature } : {})
  };
}

function countBy(rows: Array<{ key: string; count: number }>): DistributionEntry[] {
  return rows.map((row) => ({ key: String(row.key), count: Number(row.count) }));
}

export function getGraphOverview(projectRoot: string): GraphOverviewResult {
  return withGraphDb(projectRoot, (db) => {
    const scalarCount = (sqlText: string): number => {
      const row = db.prepare(sqlText).get() as { c: number } | undefined;
      return Number(row?.c ?? 0);
    };

    const filesTotal = scalarCount("SELECT COUNT(*) AS c FROM files");
    const nodesTotal = scalarCount("SELECT COUNT(*) AS c FROM nodes");
    const edgesTotal = scalarCount("SELECT COUNT(*) AS c FROM edges");

    const byLanguage = countBy(
      db.prepare("SELECT language AS key, COUNT(*) AS count FROM files GROUP BY language ORDER BY count DESC").all() as Array<{ key: string; count: number }>
    );
    const nodesByKind = countBy(
      db.prepare("SELECT kind AS key, COUNT(*) AS count FROM nodes GROUP BY kind ORDER BY count DESC").all() as Array<{ key: string; count: number }>
    );
    const edgesByKind = countBy(
      db.prepare("SELECT kind AS key, COUNT(*) AS count FROM edges GROUP BY kind ORDER BY count DESC").all() as Array<{ key: string; count: number }>
    );

    const metaRow = db.prepare("SELECT value FROM project_metadata WHERE key='index_state'").get() as
      | { value: string }
      | undefined;
    const indexedRow = db.prepare("SELECT MAX(indexed_at) AS t FROM files").get() as
      | { t: number | null }
      | undefined;

    const overview: GraphOverview = {
      available: true,
      indexState: metaRow?.value ?? null,
      indexedAt: indexedRow?.t ?? null,
      files: { total: Number(filesTotal), byLanguage },
      nodes: { total: Number(nodesTotal), byKind: nodesByKind },
      edges: { total: Number(edgesTotal), byKind: edgesByKind }
    };
    return overview;
  });
}

export interface SearchOptions {
  q: string;
  kind?: string | undefined;
  limit?: number | undefined;
}

/**
 * Neutralizes FTS5 query syntax by wrapping the raw term as a quoted phrase
 * (internal quotes doubled); `*` is appended outside the quotes for prefix
 * matching. Verified against syntax/meta-character payloads.
 */
function escapeFtsPhrase(term: string): string {
  return `"${term.replaceAll('"', '""')}" *`;
}

function likePattern(term: string): string {
  const escaped = term
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
  return `%${escaped.toLowerCase()}%`;
}

export function searchGraphSymbols(
  projectRoot: string,
  options: SearchOptions
): GraphSearchResultUnion {
  return withGraphDb(projectRoot, (db) => {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
    const kindFilter = options.kind && options.kind.trim() ? options.kind.trim() : undefined;

    const columns = "n.id, n.name, n.qualified_name, n.kind, n.file_path, n.start_line, n.signature";
    const kindClause = kindFilter ? " AND n.kind = ?" : "";

    // Stage 1: FTS5 prefix match on tokenized name/qualified_name/docstring/signature.
    let rows: NodeRow[] = [];
    try {
      rows = db
        .prepare(
          `SELECT ${columns} FROM nodes_fts f JOIN nodes n ON n.rowid = f.rowid
           WHERE nodes_fts MATCH ?${kindClause} ORDER BY n.name LIMIT ?`
        )
        .all(...(kindFilter ? [escapeFtsPhrase(options.q), kindFilter, limit] : [escapeFtsPhrase(options.q), limit])) as NodeRow[];
    } catch {
      rows = [];
    }

    // Stage 2: substring fallback over name/qualified_name for non-token hits.
    if (rows.length === 0) {
      const pattern = likePattern(options.q);
      rows = db
        .prepare(
          `SELECT ${columns} FROM nodes n
           WHERE (lower(n.name) LIKE ? ESCAPE '\\' OR lower(n.qualified_name) LIKE ? ESCAPE '\\')${kindClause}
           ORDER BY CASE WHEN lower(n.name) = lower(?) THEN 0 ELSE 1 END, n.name LIMIT ?`
        )
        .all(...(kindFilter
          ? [pattern, pattern, kindFilter, options.q.toLowerCase(), limit]
          : [pattern, pattern, options.q.toLowerCase(), limit])) as NodeRow[];
    }

    return { available: true, symbols: rows.map((row) => toSymbolRef(row, projectRoot)) };
  });
}

function getSymbolRow(db: Database.Database, symbolId: string): NodeRow | undefined {
  return db.prepare("SELECT id, name, qualified_name, kind, file_path, start_line, signature FROM nodes WHERE id = ?").get(symbolId) as
    | NodeRow
    | undefined;
}

function neighbors(
  db: Database.Database,
  symbolId: string,
  direction: "callers" | "callees",
  projectRoot: string
): GraphNeighborRef[] {
  const joinCondition =
    direction === "callers" ? "e.source = ns.id" : "e.target = ns.id";
  const matchCondition = direction === "callers" ? "e.target = ?" : "e.source = ?";
  const kinds = DETAIL_EDGE_KINDS.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT ns.id, ns.name, ns.qualified_name, ns.kind, ns.file_path, ns.start_line,
              ns.signature, e.kind AS edge_kind
       FROM edges e
       JOIN nodes ns ON ${joinCondition}
       WHERE ${matchCondition} AND e.kind IN (${kinds})
       ORDER BY ns.name LIMIT ${NEIGHBOR_LIMIT}`
    )
    .all(symbolId, ...DETAIL_EDGE_KINDS) as Array<NodeRow & { edge_kind: string }>;
  return rows.map((row) => ({
    ...toSymbolRef(row, projectRoot),
    edgeKind: row.edge_kind
  }));
}

export function getSymbolDetail(projectRoot: string, symbolId: string): SymbolDetailResult {
  return withGraphDb(projectRoot, (db) => {
    const symbol = getSymbolRow(db, symbolId);
    if (!symbol) return unavailable("not_found");
    return {
      available: true,
      symbol: toSymbolRef(symbol, projectRoot),
      callers: neighbors(db, symbolId, "callers", projectRoot),
      callees: neighbors(db, symbolId, "callees", projectRoot)
    };
  });
}

export function getSymbolImpact(
  projectRoot: string,
  symbolId: string,
  depth: number
): ImpactSubgraphResult {
  return withGraphDb(projectRoot, (db) => {
    const root = getSymbolRow(db, symbolId);
    if (!root) return unavailable("not_found");

    const boundedDepth = Math.min(Math.max(Math.trunc(depth), 1), 3);
    const kinds = IMPACT_EDGE_KINDS.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `WITH RECURSIVE impact(id, node_depth) AS (
           SELECT ?, 0
           UNION
           SELECT e.source, i.node_depth + 1
           FROM edges e JOIN impact i ON e.target = i.id
           WHERE i.node_depth < ? AND e.kind IN (${kinds})
         )
         SELECT n.id, n.name, n.qualified_name, n.kind, n.file_path, n.start_line,
                n.signature, i.node_depth
         FROM impact i JOIN nodes n ON n.id = i.id
         ORDER BY i.node_depth, n.name
         LIMIT ${MAX_IMPACT_NODES + 1}`
      )
      .all(symbolId, boundedDepth, ...IMPACT_EDGE_KINDS) as Array<NodeRow & { node_depth: number }>;

    const truncated = rows.length > MAX_IMPACT_NODES;
    const impacted = rows.slice(0, MAX_IMPACT_NODES);
    const ids = impacted.map((row) => row.id);
    const edges = ids.length > 0 ? collectEdgesAmong(db, ids, IMPACT_EDGE_KINDS) : [];

    return {
      available: true,
      rootId: symbolId,
      depth: boundedDepth,
      nodes: impacted.map((row) => ({
        ...toSymbolRef(row, projectRoot),
        depth: row.node_depth
      })),
      edges,
      truncated
    };
  });
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function collectEdgesAmong(
  db: Database.Database,
  ids: string[],
  kinds: string[]
): ImpactEdge[] {
  const rows = db
    .prepare(
      `SELECT e.source, e.target, e.kind FROM edges e
       WHERE e.source IN (${placeholders(ids.length)})
         AND e.target IN (${placeholders(ids.length)})
         AND e.kind IN (${kinds.map(() => "?").join(", ")})`
    )
    .all(...ids, ...ids, ...kinds) as Array<{ source: string; target: string; kind: string }>;
  return rows.map((row) => ({ source: row.source, target: row.target, kind: row.kind }));
}

interface FilePairRow {
  sf: string;
  tf: string;
  kind: string;
  weight: number;
}

export function getFileGraph(projectRoot: string, limit: number): FileGraphResult {
  return withGraphDb(projectRoot, (db) => {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_FILE_GRAPH_LIMIT);
    const kinds = FILE_GRAPH_EDGE_KINDS.map(() => "?").join(", ");

    // Cross-file dependency pairs: source is a file node, target resolves to a
    // definition in another file (spike S1). import/file targets carry no
    // cross-file signal and are excluded. Grouped per edge kind so clients can
    // filter.
    const pairRows = db
      .prepare(
        `SELECT ns.file_path AS sf, nt.file_path AS tf, e.kind AS kind, COUNT(*) AS weight
         FROM edges e
         JOIN nodes ns ON e.source = ns.id
         JOIN nodes nt ON e.target = nt.id
         WHERE e.kind IN (${kinds})
           AND ns.kind = 'file'
           AND nt.kind NOT IN ('import', 'file')
           AND ns.file_path != nt.file_path
         GROUP BY ns.file_path, nt.file_path, e.kind`
      )
      .all(...FILE_GRAPH_EDGE_KINDS) as FilePairRow[];

    const mergedPairs = new Map<string, { sf: string; tf: string; weight: number; kinds: Record<string, number> }>();
    const degree = new Map<string, number>();
    for (const row of pairRows) {
      const key = `${row.sf}\u0000${row.tf}`;
      const merged = mergedPairs.get(key) ?? {
        sf: row.sf,
        tf: row.tf,
        weight: 0,
        kinds: {}
      };
      const weight = Number(row.weight);
      merged.weight += weight;
      merged.kinds[row.kind] = (merged.kinds[row.kind] ?? 0) + weight;
      mergedPairs.set(key, merged);
      degree.set(row.sf, (degree.get(row.sf) ?? 0) + weight);
      degree.set(row.tf, (degree.get(row.tf) ?? 0) + weight);
    }

    const allFiles = [...degree.keys()].sort(
      (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b)
    );
    const selectedFiles = new Set(allFiles.slice(0, boundedLimit));
    const truncated = allFiles.length > boundedLimit;

    const edges = [...mergedPairs.values()]
      .filter((pair) => selectedFiles.has(pair.sf) && selectedFiles.has(pair.tf))
      .map((pair) => ({
        source: toRelativePath(projectRoot, pair.sf),
        target: toRelativePath(projectRoot, pair.tf),
        weight: pair.weight,
        kinds: pair.kinds
      }));

    const languages = new Map<string, string>();
    try {
      const fileRows = db.prepare("SELECT path, language FROM files").all() as Array<{
        path: string;
        language: string;
      }>;
      for (const row of fileRows) languages.set(row.path, row.language);
    } catch {
      // Language labels are decorative; ignore lookup failures.
    }

    return {
      available: true,
      nodes: [...selectedFiles].map((filePath) => ({
        path: toRelativePath(projectRoot, filePath),
        language: languages.get(filePath) ?? null
      })),
      edges,
      truncated
    };
  });
}

export interface ChangedPathsImpact {
  available: true;
  /** Number of changed files that actually contain indexed symbols. */
  seededFiles: number;
  seededSymbols: number;
  depth: number;
  nodes: Array<GraphSymbolRef & { depth: number }>;
  edges: ImpactEdge[];
  truncated: boolean;
}
export type ChangedPathsImpactResult = ChangedPathsImpact | GraphUnavailable;

/**
 * Reverse blast-radius for a set of changed files (typically from git status):
 * seeds with every symbol defined in those files, then walks reverse
 * calls/references/instantiates up to `depth` hops. This is the multi-root
 * variant of `getSymbolImpact`.
 */
export function getChangedPathsImpact(
  projectRoot: string,
  paths: string[],
  depth: number
): ChangedPathsImpactResult {
  return withGraphDb(projectRoot, (db) => {
    const boundedDepth = Math.min(Math.max(Math.trunc(depth), 1), 3);
    const uniquePaths = [...new Set(paths.map((p) => p.replace(/^\.\//, "")).filter(Boolean))];
    if (uniquePaths.length === 0) {
      return {
        available: true,
        seededFiles: 0,
        seededSymbols: 0,
        depth: boundedDepth,
        nodes: [],
        edges: [],
        truncated: false
      };
    }

    const kinds = IMPACT_EDGE_KINDS.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `WITH RECURSIVE seed(id) AS (
           SELECT id FROM nodes
           WHERE file_path IN (${placeholders(uniquePaths.length)})
             AND kind NOT IN ('file', 'import')
         ),
         impact(id, node_depth) AS (
           SELECT id, 0 FROM seed
           UNION
           SELECT e.source, i.node_depth + 1
           FROM edges e JOIN impact i ON e.target = i.id
           WHERE i.node_depth < ? AND e.kind IN (${kinds})
         )
         SELECT n.id, n.name, n.qualified_name, n.kind, n.file_path, n.start_line,
                n.signature, MIN(i.node_depth) AS node_depth
         FROM impact i JOIN nodes n ON n.id = i.id
         GROUP BY n.id
         ORDER BY node_depth, n.name
         LIMIT ${MAX_IMPACT_NODES + 1}`
      )
      .all(...uniquePaths, boundedDepth, ...IMPACT_EDGE_KINDS) as Array<
      NodeRow & { node_depth: number }
    >;

    const truncated = rows.length > MAX_IMPACT_NODES;
    const impacted = rows.slice(0, MAX_IMPACT_NODES);
    const ids = impacted.map((row) => row.id);
    const edges = ids.length > 0 ? collectEdgesAmong(db, ids, IMPACT_EDGE_KINDS) : [];
    const seededSymbols = impacted.filter((row) => row.node_depth === 0).length;
    const seededFiles = new Set(
      impacted.filter((row) => row.node_depth === 0).map((row) => row.file_path)
    ).size;

    return {
      available: true,
      seededFiles,
      seededSymbols,
      depth: boundedDepth,
      nodes: impacted.map((row) => ({
        ...toSymbolRef(row, projectRoot),
        depth: row.node_depth
      })),
      edges,
      truncated
    };
  });
}
