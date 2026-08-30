import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";

import {
  buildEmptyProject,
  buildGraphFixture,
  buildIncompatibleFixture,
  makeTempRoot
} from "./helpers/project-graph-fixture.js";
import {
  getChangedPathsImpact,
  getGraphOverview,
  getSymbolDetail,
  getSymbolImpact,
  getFileGraph,
  searchGraphSymbols
} from "../src/services/project-graph.js";

describe("project-graph service", () => {
  describe("getGraphOverview", () => {
    it("aggregates node/edge/file distributions for an indexed project", () => {
      const { root, cleanup } = makeTempRoot("overview");
      try {
        buildGraphFixture(root);
        const overview = getGraphOverview(root);
        assert.equal(overview.available, true);
        if (!overview.available) return;

        assert.equal(overview.files.total, 3);
        assert.equal(overview.indexState, "complete");
        assert.equal(overview.indexedAt, 1700000020000);
        const languages = Object.fromEntries(
          overview.files.byLanguage.map((entry) => [entry.key, entry.count])
        );
        assert.deepEqual(languages, { ts: 2, tsx: 1 });

        const nodeKinds = Object.fromEntries(
          overview.nodes.byKind.map((entry) => [entry.key, entry.count])
        );
        assert.equal(nodeKinds["function"], 3);
        assert.equal(nodeKinds["class"], 1);
        assert.equal(nodeKinds["file"], 3);
        assert.equal(nodeKinds["import"], 1);

        const edgeKinds = Object.fromEntries(
          overview.edges.byKind.map((entry) => [entry.key, entry.count])
        );
        assert.equal(edgeKinds["contains"], 5);
        assert.equal(edgeKinds["imports"], 1);
        assert.equal(edgeKinds["references"], 1);
        assert.equal(edgeKinds["calls"], 2);
        assert.equal(edgeKinds["instantiates"], 1);
      } finally {
        cleanup();
      }
    });

    it("reports not_initialized when the project has no .codegraph db", () => {
      const { root, cleanup } = makeTempRoot("empty");
      try {
        buildEmptyProject(root);
        assert.deepEqual(getGraphOverview(root), {
          available: false,
          reason: "not_initialized"
        });
      } finally {
        cleanup();
      }
    });

    it("reports schema_unsupported when required tables are missing", () => {
      const { root, cleanup } = makeTempRoot("schema");
      try {
        buildIncompatibleFixture(root);
        assert.deepEqual(getGraphOverview(root), {
          available: false,
          reason: "schema_unsupported"
        });
      } finally {
        cleanup();
      }
    });

    it("reports unavailable (not error) when the project root does not exist", () => {
      const missing = path.join("/nonexistent", `of-missing-${Date.now()}`);
      const overview = getGraphOverview(missing);
      assert.equal(overview.available, false);
    });
  });

  describe("searchGraphSymbols", () => {
    it("finds symbols by name via FTS with prefix expansion", () => {
      const { root, cleanup } = makeTempRoot("search");
      try {
        buildGraphFixture(root);
        const result = searchGraphSymbols(root, { q: "greet" });
        assert.equal(result.symbols.length, 1);
        assert.equal(result.symbols[0].id, "fn:greet");
        assert.equal(result.symbols[0].filePath, "src/a.ts");
        assert.equal(result.symbols[0].startLine, 5);

        const prefix = searchGraphSymbols(root, { q: "gre" });
        assert.equal(prefix.symbols.length, 1);
      } finally {
        cleanup();
      }
    });

    it("returns an empty result without throwing for injection payloads", () => {
      const { root, cleanup } = makeTempRoot("injection");
      try {
        buildGraphFixture(root);
        const payloads = [`' OR 1=1 --`, `"`, `NEAR(a b)`, `*`, `(`];
        for (const payload of payloads) {
          const result = searchGraphSymbols(root, { q: payload });
          assert.deepEqual(result.symbols, [], payload);
        }
      } finally {
        cleanup();
      }
    });

    it("falls back to LIKE matching when FTS yields nothing", () => {
      const { root, cleanup } = makeTempRoot("fallback");
      try {
        buildGraphFixture(root);
        // Substring of qualified_name only; FTS token match would miss it.
        const result = searchGraphSymbols(root, { q: "a.gr" });
        assert.ok(result.symbols.some((symbol) => symbol.id === "fn:greet"));
      } finally {
        cleanup();
      }
    });

    it("filters by kind and honors the limit", () => {
      const { root, cleanup } = makeTempRoot("kindfilter");
      try {
        buildGraphFixture(root);
        const functions = searchGraphSymbols(root, { q: "main", kind: "function" });
        assert.equal(functions.symbols.length, 1);
        assert.equal(functions.symbols[0].name, "main");

        const classes = searchGraphSymbols(root, { q: "main", kind: "class" });
        assert.equal(classes.symbols.length, 0);

        const limited = searchGraphSymbols(root, { q: "a", limit: 2 });
        assert.ok(limited.symbols.length <= 2);
      } finally {
        cleanup();
      }
    });

    it("propagates unavailability instead of throwing", () => {
      const { root, cleanup } = makeTempRoot("search-empty");
      try {
        buildEmptyProject(root);
        assert.deepEqual(searchGraphSymbols(root, { q: "greet" }), {
          available: false,
          reason: "not_initialized"
        });
      } finally {
        cleanup();
      }
    });
  });

  describe("getSymbolDetail", () => {
    it("returns the symbol with callers and callees", () => {
      const { root, cleanup } = makeTempRoot("detail");
      try {
        buildGraphFixture(root);
        const detail = getSymbolDetail(root, "fn:main");
        assert.equal(detail.available, true);
        if (!detail.available) return;

        assert.equal(detail.symbol.id, "fn:main");
        assert.equal(detail.symbol.filePath, "src/b.ts");
        // callers = reverse calls + references; ordered by name ("c.tsx" < "entry")
        assert.deepEqual(detail.callers.map((entry) => entry.id), ["file:c", "fn:entry"]);
        assert.deepEqual(detail.callees.map((entry) => entry.id), ["fn:greet"]);
      } finally {
        cleanup();
      }
    });

    it("returns unavailable for unknown symbol ids without touching the db again", () => {
      const { root, cleanup } = makeTempRoot("detail-missing");
      try {
        buildGraphFixture(root);
        assert.deepEqual(getSymbolDetail(root, "fn:nope"), {
          available: false,
          reason: "not_found"
        });
      } finally {
        cleanup();
      }
    });

    it("treats injection payloads as plain ids (parameterized, not found)", () => {
      const { root, cleanup } = makeTempRoot("detail-injection");
      try {
        buildGraphFixture(root);
        assert.deepEqual(getSymbolDetail(root, "x' OR 1=1 --"), {
          available: false,
          reason: "not_found"
        });
      } finally {
        cleanup();
      }
    });

    it("propagates unavailability instead of throwing", () => {
      const { root, cleanup } = makeTempRoot("detail-empty");
      try {
        buildEmptyProject(root);
        assert.deepEqual(getSymbolDetail(root, "fn:greet"), {
          available: false,
          reason: "not_initialized"
        });
      } finally {
        cleanup();
      }
    });
  });

  describe("getSymbolImpact", () => {
    it("walks reverse call/reference edges up to the requested depth", () => {
      const { root, cleanup } = makeTempRoot("impact");
      try {
        buildGraphFixture(root);

        const depth1 = getSymbolImpact(root, "fn:greet", 1);
        assert.equal(depth1.available, true);
        if (!depth1.available) return;
        const depths1 = new Map(depth1.nodes.map((n) => [n.id, n.depth]));
        assert.equal(depths1.get("fn:greet"), 0);
        assert.equal(depths1.get("fn:main"), 1);
        // instantiates is forward-only from greet; reverse walk must not include it.
        assert.equal(depths1.has("cls:helper"), false);
        assert.ok(depth1.edges.some((e) => e.source === "fn:main" && e.target === "fn:greet"));

        const depth2 = getSymbolImpact(root, "fn:greet", 2);
        assert.equal(depth2.available, true);
        if (!depth2.available) return;
        const depths2 = new Map(depth2.nodes.map((n) => [n.id, n.depth]));
        assert.equal(depths2.get("fn:entry"), 2);
        assert.ok(depth2.edges.some((e) => e.source === "fn:entry" && e.target === "fn:main"));
      } finally {
        cleanup();
      }
    });

    it("returns unavailable for unknown roots", () => {
      const { root, cleanup } = makeTempRoot("impact-missing");
      try {
        buildGraphFixture(root);
        assert.deepEqual(getSymbolImpact(root, "fn:nope", 2), {
          available: false,
          reason: "not_found"
        });
      } finally {
        cleanup();
      }
    });
  });

  describe("getFileGraph", () => {
    it("aggregates cross-file dependencies into a file-level subgraph", () => {
      const { root, cleanup } = makeTempRoot("filegraph");
      try {
        buildGraphFixture(root);
        const graph = getFileGraph(root, 50);
        assert.equal(graph.available, true);
        if (!graph.available) return;

        const paths = graph.nodes.map((node) => node.path).sort();
        assert.deepEqual(paths, ["src/a.ts", "src/b.ts", "src/c.tsx"]);

        const edges = graph.edges.map((edge) => [edge.source, edge.target].sort().join("->"));
        assert.ok(edges.includes("src/a.ts->src/b.ts"));
        assert.ok(edges.includes("src/b.ts->src/c.tsx"));
        assert.equal(graph.truncated, false);
      } finally {
        cleanup();
      }
    });

    it("keeps only the highest-degree files when limited and flags truncation", () => {
      const { root, cleanup } = makeTempRoot("filegraph-limit");
      try {
        buildGraphFixture(root);
        const graph = getFileGraph(root, 1);
        assert.equal(graph.available, true);
        if (!graph.available) return;

        // Degrees: a=1 (in from b), b=2 (in from c + out to a), c=1 (out to b).
        // src/b.ts has the highest total degree, so it survives the limit.
        assert.deepEqual(graph.nodes.map((node) => node.path), ["src/b.ts"]);
        assert.equal(graph.truncated, true);
      } finally {
        cleanup();
      }
    });

    it("propagates unavailability instead of throwing", () => {
      const { root, cleanup } = makeTempRoot("filegraph-empty");
      try {
        buildEmptyProject(root);
        assert.deepEqual(getFileGraph(root, 50), {
          available: false,
          reason: "not_initialized"
        });
      } finally {
        cleanup();
      }
    });

    it("reports per-kind contributions on aggregated edges", () => {
      const { root, cleanup } = makeTempRoot("filegraph-kinds");
      try {
        buildGraphFixture(root);
        const graph = getFileGraph(root, 50);
        assert.equal(graph.available, true);
        if (!graph.available) return;

        // b->a comes from an imports edge; c->b from a references edge.
        const edgeByKey = new Map(graph.edges.map((edge) => [`${edge.source}->${edge.target}`, edge]));
        const bToA = edgeByKey.get("src/b.ts->src/a.ts");
        const cToB = edgeByKey.get("src/c.tsx->src/b.ts");
        assert.deepEqual(bToA?.kinds, { imports: 1 });
        assert.deepEqual(cToB?.kinds, { references: 1 });
      } finally {
        cleanup();
      }
    });
  });

  describe("getChangedPathsImpact", () => {
    it("seeds with symbols of changed files and walks reverse edges", () => {
      const { root, cleanup } = makeTempRoot("affected");
      try {
        buildGraphFixture(root);

        // src/b.ts defines fn:main; its callers are file:c (references) and,
        // transitively, nothing else at depth 1 beyond direct dependents.
        const result = getChangedPathsImpact(root, ["src/b.ts"], 2);
        assert.equal(result.available, true);
        if (!result.available) return;

        assert.equal(result.seededFiles, 1);
        assert.equal(result.seededSymbols, 1);
        const depths = new Map(result.nodes.map((node) => [node.id, node.depth]));
        assert.equal(depths.get("fn:main"), 0);
        // Affected = dependents: entry calls main (depth 1), c references it.
        assert.equal(depths.get("fn:entry"), 1);
        assert.ok(depths.has("file:c"));
        // greet is a callee of main — changing main does not affect it.
        assert.equal(depths.has("fn:greet"), false);
        assert.ok(result.edges.some((edge) => edge.source === "fn:entry" && edge.target === "fn:main"));
      } finally {
        cleanup();
      }
    });

    it("merges multiple changed files into one closure", () => {
      const { root, cleanup } = makeTempRoot("affected-multi");
      try {
        buildGraphFixture(root);
        const result = getChangedPathsImpact(root, ["src/a.ts", "src/c.tsx"], 1);
        assert.equal(result.available, true);
        if (!result.available) return;
        assert.equal(result.seededFiles, 2);
        const ids = new Set(result.nodes.map((node) => node.id));
        for (const expected of ["fn:greet", "fn:entry", "cls:helper"]) {
          assert.ok(ids.has(expected), expected);
        }
      } finally {
        cleanup();
      }
    });

    it("returns an empty closure for unknown paths without failing", () => {
      const { root, cleanup } = makeTempRoot("affected-unknown");
      try {
        buildGraphFixture(root);
        const result = getChangedPathsImpact(root, ["src/does-not-exist.ts"], 2);
        assert.deepEqual(result, {
          available: true,
          seededFiles: 0,
          seededSymbols: 0,
          depth: 2,
          nodes: [],
          edges: [],
          truncated: false
        });
      } finally {
        cleanup();
      }
    });

    it("normalizes ./ prefixes and dedupes paths", () => {
      const { root, cleanup } = makeTempRoot("affected-normalize");
      try {
        buildGraphFixture(root);
        const result = getChangedPathsImpact(root, ["./src/b.ts", "src/b.ts"], 1);
        assert.equal(result.available, true);
        if (!result.available) return;
        assert.equal(result.seededFiles, 1);
        assert.equal(result.seededSymbols, 1);
      } finally {
        cleanup();
      }
    });

    it("propagates unavailability instead of throwing", () => {
      const { root, cleanup } = makeTempRoot("affected-empty");
      try {
        buildEmptyProject(root);
        assert.deepEqual(getChangedPathsImpact(root, ["src/a.ts"], 2), {
          available: false,
          reason: "not_initialized"
        });
      } finally {
        cleanup();
      }
    });
  });
});
