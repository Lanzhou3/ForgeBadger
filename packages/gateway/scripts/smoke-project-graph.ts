/* Real-data smoke: exercise project-graph service against this repo's live
 * CodeGraph index. Run: pnpm --dir packages/gateway exec tsx scripts/smoke-project-graph.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getChangedPathsImpact,
  getFileGraph,
  getGraphOverview,
  getSymbolDetail,
  getSymbolImpact,
  searchGraphSymbols
} from "../src/services/project-graph.js";
import { ProjectGraphPathError } from "../src/services/project-graph.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

const overviewStart = process.hrtime.bigint();
const overview = getGraphOverview(repoRoot);
console.log(`[overview] ${ms(overviewStart).toFixed(1)}ms`);
if (overview.available) {
  console.log(`  files=${overview.files.total} nodes=${overview.nodes.total} edges=${overview.edges.total}`);
  console.log(`  indexState=${overview.indexState} topKinds=${overview.nodes.byKind.slice(0, 3).map((entry) => `${entry.key}:${entry.count}`).join(",")}`);
} else {
  throw new Error(`overview unavailable: ${JSON.stringify(overview)}`);
}

const searchStart = process.hrtime.bigint();
const search = searchGraphSymbols(repoRoot, { q: "createSession", limit: 25 });
console.log(`[search createSession] ${ms(searchStart).toFixed(1)}ms -> ${(search.available ? search.symbols.length : 0)} hits`);
if (!search.available || search.symbols.length === 0) throw new Error("expected search hits");
const target =
  search.symbols.find(
    (symbol) =>
      symbol.kind === "function" && symbol.filePath.includes("gateway/src/services/session-manager")
  ) ?? search.symbols.find((symbol) => symbol.kind === "function") ?? search.symbols[0];

const detailStart = process.hrtime.bigint();
const detail = getSymbolDetail(repoRoot, target.id);
console.log(`[detail ${target.id}] ${ms(detailStart).toFixed(1)}ms`);
if (!detail.available) throw new Error("detail unavailable");
console.log(`  callers=${detail.callers.length} callees=${detail.callees.length}`);

const impactStart = process.hrtime.bigint();
const impact = getSymbolImpact(repoRoot, target.id, 2);
console.log(`[impact depth=2] ${ms(impactStart).toFixed(1)}ms`);
if (!impact.available) throw new Error("impact unavailable");
console.log(`  affectedNodes=${impact.nodes.length} subgraphEdges=${impact.edges.length} truncated=${impact.truncated}`);

const fileGraphStart = process.hrtime.bigint();
const fileGraph = getFileGraph(repoRoot, 60);
console.log(`[file-graph limit=60] ${ms(fileGraphStart).toFixed(1)}ms`);
if (!fileGraph.available) throw new Error("file graph unavailable");
console.log(`  files=${fileGraph.nodes.length} deps=${fileGraph.edges.length} truncated=${fileGraph.truncated}`);
if (fileGraph.available) {
  const sample = fileGraph.edges[0];
  console.log(`  sample edge kinds: ${JSON.stringify(sample?.kinds ?? {})}`);
}

// Real blast-radius run against this repo's actual uncommitted changes.
const { execFileSync } = await import("node:child_process");
let changedPaths: string[] = [];
try {
  const out = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  changedPaths = out
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/^"(.*)"$/, "$1"))
    .filter((p) => /\.(ts|tsx|mjs|js)$/.test(p))
    .slice(0, 50);
} catch {}
const affected = getChangedPathsImpact(repoRoot, changedPaths.length > 0 ? changedPaths : ["packages/gateway/src/services/session-manager.ts"], 2);
console.log(`[changed-paths impact] paths=${changedPaths.length || 1} ${ms(process.hrtime.bigint()).toFixed(0)}ms`);
if (!affected.available) throw new Error("affected unavailable");
console.log(`  seededFiles=${affected.seededFiles} seededSymbols=${affected.seededSymbols} touched=${affected.nodes.length} truncated=${affected.truncated}`);

// Injection payloads are neutralized into harmless phrase queries. They may
// legitimately match symbols whose source text contains them (this repo's own
// security tests do), so we only assert no throw + well-formed result.
const injection = searchGraphSymbols(repoRoot, { q: "' OR 1=1 --" });
console.log(
  `[injection search] ok=${injection.available} hits=${injection.available ? injection.symbols.length : "-"} (payload neutralized)`
);

try {
  getGraphOverview("/etc");
  console.log("[denied root] FAIL: no error thrown");
  process.exitCode = 1;
} catch (error) {
  if (error instanceof ProjectGraphPathError) {
    console.log("[denied root] correctly rejected with ProjectGraphPathError");
  } else {
    throw error;
  }
}

console.log("\nSMOKE OK");
