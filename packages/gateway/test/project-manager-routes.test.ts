import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { signJwt } from "../src/auth/jwt.js";
import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import { createProjectManagerRoutes } from "../src/routes/project-manager.js";

const secret = "0123456789abcdef0123456789abcdef";

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

describe("project-manager routes", () => {
  let db: Database.Database;
  let app: express.Express;
  let owner: User;
  let other: User;
  let projectId: string;
  let token: string;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("pm-route-owner@example.com", "hash");
    other = users.create("pm-route-other@example.com", "hash");
    projectId = new ProjectRepository(db, owner.id).create({
      name: "OpenForge",
      path: "/tmp/openforge-route-pm",
      aiTool: "claude"
    }).id;
    token = signJwt({ userId: owner.id, email: owner.email }, secret);

    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/projects", createProjectManagerRoutes(db));
  });

  it("returns canonical envelopes for authenticated owner project-manager requests", async () => {
    const goalUpsert = await request("PUT", `/api/v1/projects/${projectId}/project-manager/goal`, {
      summary: "Close Phase 4",
      constraints: ["No Feishu terminal authority"],
      acceptanceCriteria: ["ledger is auditable"]
    });
    const goalRead = await request("GET", `/api/v1/projects/${projectId}/project-manager/goal`);
    const created = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items`, {
      title: "Implement routes",
      acceptanceCriteria: ["route tests pass"]
    });
    const itemId = created.body.data.workItem.id as string;
    const listed = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items?limit=10`);
    const detail = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items/${itemId}`);
    const status = await request("PATCH", `/api/v1/projects/${projectId}/project-manager/work-items/${itemId}/status`, {
      status: "in_progress"
    });
    const evidence = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${itemId}/evidence`, {
      evidenceRefs: [{ kind: "test", label: "route suite", status: "passed", ref: "test/project-manager-routes.test.ts" }]
    });
    const ledger = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?limit=10`);

    for (const response of [goalUpsert, goalRead, created, listed, detail, status, evidence, ledger]) {
      assert.equal(response.status, response === created ? 201 : 200);
      assert.equal(response.body.code, 0);
      assert.equal(response.body.message, "");
      assert.equal(typeof response.body.data, "object");
    }
    assert.equal(goalRead.body.data.goal.summary, "Close Phase 4");
    assert.equal(listed.body.data.workItems.length, 1);
    assert.equal(detail.body.data.workItem.id, itemId);
    assert.equal(status.body.data.workItem.status, "in_progress");
    assert.equal(evidence.body.data.workItem.evidenceRefCount, 1);
    assert.equal(ledger.body.data.events.length, 4);
  });

  it("returns 404 for missing or cross-tenant projects without leaking ownership", async () => {
    const foreignProject = new ProjectRepository(db, other.id).create({
      name: "Foreign",
      path: "/tmp/foreign-pm",
      aiTool: "claude"
    });

    const missing = await request("GET", "/api/v1/projects/missing-project/project-manager/goal");
    const foreign = await request("GET", `/api/v1/projects/${foreignProject.id}/project-manager/goal`);

    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { code: 1, message: "Project not found" });
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, { code: 1, message: "Project not found" });
  });

  it("rejects invalid input without writing ledger or audit rows", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Validate routes" });
    const beforeEvents = repo.listLedgerEvents(projectId, { workItemId: item.id }).length;
    const beforeProjectEvents = repo.listLedgerEvents(projectId).length;
    const beforeAudit = new AuditLogRepository(db, owner.id).list({
      resourceType: "project_manager_work_item",
      resourceId: item.id
    }).length;

    const invalidStatus = await request("PATCH", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/status`, {
      status: "invalid"
    });
    const invalidEvidence = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/evidence`, {
      evidenceRefs: [{ kind: "test", unexpected: "field" }]
    });
    const overLimit = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items?limit=101`);
    const invalidEventType = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?eventType=raw_terminal_output`);
    const rawDetails = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items`, {
      title: "Raw details",
      details: {
        note: "$ claude --dangerously-skip-permissions\nstdout: raw terminal transcript\nstderr: raw failure output"
      }
    });

    for (const response of [invalidStatus, invalidEvidence, overLimit, invalidEventType, rawDetails]) {
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 1);
    }
    assert.equal(repo.getWorkItem(projectId, item.id)?.status, "todo");
    assert.equal(repo.listLedgerEvents(projectId, { workItemId: item.id }).length, beforeEvents);
    assert.equal(repo.listLedgerEvents(projectId).length, beforeProjectEvents);
    assert.equal(new AuditLogRepository(db, owner.id).list({
      resourceType: "project_manager_work_item",
      resourceId: item.id
    }).length, beforeAudit);
  });

  it("rejects done status without evidence or manual completion reason and leaves the item unchanged", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Done gate" });
    repo.updateWorkItemStatus(projectId, item.id, { status: "in_progress" });

    const res = await request("PATCH", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/status`, {
      status: "done"
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(repo.getWorkItem(projectId, item.id)?.status, "in_progress");
  });

  it("filters ledger events by type before applying the response limit", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Ledger filter" });
    repo.updateWorkItemStatus(projectId, item.id, { status: "in_progress" });
    await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/evidence`, {
      evidenceRefs: [{ kind: "test", label: "route", status: "passed", ref: "test/project-manager-routes.test.ts" }]
    });

    const response = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?eventType=evidence_attached&limit=1`);

    assert.equal(response.status, 200);
    assert.equal(response.body.code, 0);
    assert.equal(response.body.data.events.length, 1);
    assert.equal(response.body.data.events[0].eventType, "evidence_attached");
  });

  it("omits raw details and secret-like values from route responses", async () => {
    const providerSecret = ["sk", "route-provider-secret"].join("-");
    const routeRef = ["Authorization:", "Bearer route.jwt.secret"].join(" ");
    const stdErrKey = ["std", "err"].join("");
    const routeStdErrSecret = ["sk", ["route-std", "err-secret"].join("")].join("-");
    const routeSignature = ["X-Lark", "Signature: route-secret"].join("-");
    const repo = new ProjectManagerRepository(db, owner.id);
    const created = repo.createWorkItem(projectId, {
      title: "Redacted route item",
      details: {
        rawTerminalOutput: "OPENFORGE_ATTACH_TOKEN=route-attach-secret",
        providerCredential: providerSecret
      }
    });
    repo.attachEvidence(projectId, created.id, {
      evidenceRefs: [{ kind: "test", label: "route", status: "passed", ref: routeRef }],
      details: { [stdErrKey]: routeStdErrSecret, signature: routeSignature }
    });

    const item = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items/${created.id}`);
    const ledger = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger`);
    const serialized = JSON.stringify({ item: item.body, ledger: ledger.body });

    assert.equal(serialized.includes("details"), false);
    assert.doesNotMatch(serialized, new RegExp(["route-attach-secret", ["sk", "route-provider-secret"].join("-"), "route\\.jwt\\.secret"].join("|"), "u"));
    assert.doesNotMatch(serialized, new RegExp([["sk", "route-std", "err-secret"].join("-"), "route-secret"].join("|"), "u"));
  });

  async function request(method: string, pathname: string, body?: unknown) {
    return makeRequest(app, method, pathname, body, {
      Authorization: `Bearer ${token}`
    });
  }
});

async function makeRequest(
  app: express.Express,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: pathname,
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
          }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode || 0,
              body: data ? JSON.parse(data) : undefined
            });
          });
        }
      );
      req.on("error", (error) => {
        server.close();
        reject(error);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
