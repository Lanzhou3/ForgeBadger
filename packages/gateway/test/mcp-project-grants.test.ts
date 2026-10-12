import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { McpTokenRepository, type McpTokenScope } from "../src/db/repositories/mcp-token-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createMcpRoutes } from "../src/routes/mcp.js";
import { assertMcpTokenAuthority, snapshotMcpProjects } from "../src/services/mcp/token-authority.js";

interface RpcResult { isError?: boolean; content: Array<{ text: string }>; tools?: Array<{ name: string }> }

describe("MCP selected project authorization", () => {
  let db: Database;
  let server: Server;
  let url: string;
  let root: string;
  let userId: string;
  let projects: ProjectRepository;
  let tokens: McpTokenRepository;
  let a: string;
  let b: string;
  let excluded: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-mcp-grants-")));
    userId = new UserRepository(db).create("grants@example.test", "hash").id;
    projects = new ProjectRepository(db, userId);
    tokens = new McpTokenRepository(db);
    [a, b, excluded] = ["a", "b", "excluded"].map(name => {
      const directory = path.join(root, name);
      mkdirSync(directory);
      return projects.create({ name, path: directory, aiTool: "codex" }).id;
    }) as [string, string, string];
    const app = express();
    app.use(express.json());
    app.use("/mcp", createMcpRoutes({ db, masterKey: "0123456789abcdef0123456789abcdef", appVersion: "test" }));
    server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  function issue(scopes: McpTokenScope[] = ["read", "operate", "cli_dispatch"]) {
    return tokens.create({ userId, name: "projects", scopes, allowedProjects: snapshotMcpProjects(db, userId, [a, b]) });
  }
  async function rpc(token: string, method: string, params?: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const text = await res.text();
    const data = text.split("\n").find(line => line.startsWith("data:"));
    return { status: res.status, result: data ? (JSON.parse(data.slice(5)) as { result: RpcResult }).result : undefined };
  }
  async function call(token: string, name: string, args: Record<string, unknown> = {}): Promise<RpcResult> {
    const response = await rpc(token, "tools/call", { name, arguments: args });
    assert.equal(response.status, 200);
    assert.ok(response.result);
    return response.result;
  }
  function output(result: RpcResult): Record<string, unknown> {
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
  }

  for (const scopes of [["read"], ["read", "operate"], ["read", "operate", "cli_dispatch"]] satisfies McpTokenScope[][]) {
    it(`filters all reads and denies excluded writes with permanent ${scopes.join("+")}`, async () => {
      const { record, token } = issue(scopes);
      assert.equal(record.expiresAt, null);
      const listing = output(await call(token, "list_projects"));
      assert.deepEqual(new Set((listing.projects as Array<{ id: string }>).map(p => p.id)), new Set([a, b]));
      for (const id of [a, b]) assert.equal(output(await call(token, "get_project", { projectId: id })).found, true);
      assert.equal((await call(token, "get_project", { projectId: excluded })).isError, true);
      assert.equal((await call(token, "pm_create_work_item", { operationId: "excluded-write", projectId: excluded, title: "not allowed" })).isError, true);
      const advertised = (await rpc(token, "tools/list")).result!.tools!.map(tool => tool.name);
      for (const name of ["create_project", "import_project", "list_templates", "get_usage_summary", "search_memory"]) {
        assert.ok(!advertised.includes(name));
        assert.equal((await call(token, name, { operationId: name, name: "child", path: path.join(root, "a", "child") })).isError, true);
      }
      if (scopes.includes("operate")) {
        const work = output(await call(token, "pm_create_work_item", { ...(scopes.includes("cli_dispatch") ? { operationId: "work-a" } : {}), projectId: a, title: "allowed" }));
        assert.ok(work.id);
      }
    });
  }
  it("binds session directories to their own project, even when both projects are selected", async () => {
    const { token } = issue();
    const sessions = new SessionRepository(db, userId);
    const good = sessions.create({ projectId: a, name: "good", aiTool: "codex", workingDir: path.join(root, "a") });
    const mismatch = sessions.create({ projectId: a, name: "mismatch", aiTool: "codex", workingDir: path.join(root, "b") });
    const outsider = sessions.create({ projectId: excluded, name: "excluded", aiTool: "codex", workingDir: path.join(root, "excluded") });
    assert.equal(output(await call(token, "get_session", { sessionId: good.id })).found, true);
    for (const id of [mismatch.id, outsider.id]) assert.equal((await call(token, "get_session", { sessionId: id })).isError, true);
    const listed = output(await call(token, "list_sessions"));
    assert.deepEqual((listed.sessions as Array<{ id: string }>).map(s => s.id), [good.id]);
  });
  it("rejects moved, deleted and foreign projects without expanding to replacements", async () => {
    const { record, token } = issue();
    const foreignOwner = new UserRepository(db).create("other@example.test", "hash").id;
    const foreign = new ProjectRepository(db, foreignOwner).create({ name: "foreign", path: path.join(root, "other"), aiTool: "codex" });
    assert.throws(() => snapshotMcpProjects(db, userId, [foreign.id]), /not found/);
    mkdirSync(path.join(root, "moved-a"));
    db.prepare("UPDATE projects SET path = ? WHERE id = ?").run(path.join(root, "moved-a"), a);
    assert.equal((await call(token, "get_project", { projectId: a })).isError, true);
    db.prepare("DELETE FROM projects WHERE id = ?").run(b);
    assert.equal((await call(token, "get_project", { projectId: b })).isError, true);
    assert.throws(() => assertMcpTokenAuthority(db, userId, record.id, { projectIds: [], rootPaths: [path.join(root, "b")], revision: "" }), /does not match/);
  });
  it("rejects a project symlink retargeted after authorization", { skip: process.platform === "win32" }, async () => {
    const { token } = issue();
    renameSync(path.join(root, "a"), path.join(root, "original-a"));
    symlinkSync(path.join(root, "b"), path.join(root, "a"));
    assert.equal((await call(token, "get_project", { projectId: a })).isError, true);
  });
  it("blocks unselected nested projects and stale nested grants", async () => {
    const { token } = issue();
    const nestedPath = path.join(root, "a", "child");
    mkdirSync(nestedPath);
    const nested = projects.create({ name: "child", path: nestedPath, aiTool: "codex" });
    assert.throws(() => snapshotMcpProjects(db, userId, [a]), /unselected project/);
    assert.equal((await call(token, "get_project", { projectId: a })).isError, true);
    const all = tokens.create({ userId, name: "nested", scopes: ["read"], allowedProjects: snapshotMcpProjects(db, userId, [a, b, nested.id]) });
    assert.equal(output(await call(all.token, "get_project", { projectId: a })).found, true);
    mkdirSync(path.join(root, "a", "moved-child"));
    db.prepare("UPDATE projects SET path = ? WHERE id = ?").run(path.join(root, "a", "moved-child"), nested.id);
    assert.equal((await call(all.token, "get_project", { projectId: a })).isError, true);
  });
  it("fails closed on empty or malformed grants", async () => {
    for (const value of ["[]", "{}", "null", "bad", '[{"id":"x"}]']) {
      const { record, token } = issue(["read"]);
      db.prepare("UPDATE mcp_access_tokens SET allowed_projects = ? WHERE id = ?").run(value, record.id);
      assert.equal((await call(token, "list_projects")).isError, true);
    }
  });
  it("honors expiry, revocation and owner deactivation for project tokens", async () => {
    const expired = tokens.create({ userId, name: "expired", scopes: ["read"], allowedProjects: snapshotMcpProjects(db, userId, [a]), expiresAt: new Date(Date.now() - 2000) });
    assert.equal((await rpc(expired.token, "tools/list")).status, 401);
    const revoked = issue();
    tokens.revokeByIdAndUser(revoked.record.id, userId);
    assert.equal((await rpc(revoked.token, "tools/list")).status, 401);
    const active = issue();
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(userId);
    assert.equal((await rpc(active.token, "tools/list")).status, 401);
  });
});
