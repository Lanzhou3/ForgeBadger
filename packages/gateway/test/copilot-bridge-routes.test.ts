import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp, type GatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import type { PortfolioRepository } from "../src/db/repositories/portfolio-repository.js";
import {
  createExecutablePortfolioAttempt,
  createPortfolioPhase4Fixture
} from "./portfolio-phase4-fixture.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const bridgeToken = "copilot-bridge-test-token-0123456789abcdef";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;
// Keep the delivery read-back budget short so the unconfirmed-path test is fast.
process.env.FORGEBADGER_DISPATCH_CONFIRM_TIMEOUT_MS = "800";
process.env.FORGEBADGER_DISPATCH_CONFIRM_INTERVAL_MS = "50";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

interface SentInput {
  name: string;
  data: string;
}

function createMockTmux(sentInputs: SentInput[]) {
  const panes = new Map<string, string>();
  const staged = new Map<string, string>();
  return {
    async createSession(options: { name: string }) {
      panes.set(options.name, "────────────────\n❯  \n────────────────\nauto mode on");
    },
    async killSession() {},
    async capturePane(name: string) {
      return panes.get(name) ?? "";
    },
    async listSessions() {
      return [] as string[];
    },
    async sendInput(name: string, data: string) {
      sentInputs.push({ name, data });
      panes.set(name, (panes.get(name) ?? "") + data);
    },
    async inspectPane(name: string) {
      return { content: panes.get(name) ?? "", dead: false, inMode: false };
    },
    async stageProgrammaticInput(name: string, data: string) {
      sentInputs.push({ name, data });
      staged.set(name, data);
      panes.set(name, `────────────────\n❯ ${data}\n────────────────\nauto mode on`);
    },
    async pressEnter(name: string) {
      sentInputs.push({ name, data: "<Enter>" });
      panes.set(name, `${staged.get(name) ?? ""}\n────────────────\n❯  \n────────────────\nauto mode on`);
    }
  };
}

/** Mock tmux whose staged composer never clears after Enter. */
function createSilentMockTmux(sentInputs: SentInput[]) {
  const base = createMockTmux(sentInputs);
  return { ...base, async pressEnter(name: string) { sentInputs.push({ name, data: "<Enter>" }); } };
}

interface Envelope {
  code: number;
  data?: Record<string, unknown>;
  message?: string;
  details?: { code?: string };
}

async function listen(app: GatewayApp): Promise<string> {
  await new Promise<void>((resolve) => {
    app.server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

function bridgeHeaders(userId: string, token: string = bridgeToken): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-forgebadger-user-id": userId,
    "content-type": "application/json"
  };
}

/** Full dispatch-receipt chain so a todo work item may legitimately advance to in_progress. */
function recordValidatedDispatchReceipt(
  repo: PortfolioRepository,
  input: {
    userId: string;
    projectId: string;
    workItemId: string;
    attemptId: string;
    sessionId: string;
    assignmentId: string;
    leaseToken: string;
    idempotencyKey: string;
  }
): void {
  const dispatchPayloadDigest = `sha256:${input.idempotencyKey}:dispatch`;
  const intent = repo.createActionIntent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    sessionId: input.sessionId,
    actionClass: "session.dispatch",
    payloadDigest: dispatchPayloadDigest,
    assignmentLeaseToken: input.leaseToken,
    policyRule: "owner-confirmation/v1",
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: `${input.idempotencyKey}:intent`
  });
  const actionDigest = repo.getActionIntentDigest(intent.id);
  assert.ok(actionDigest, "owner authorization requires a canonical action digest");
  const authorization = repo.createAuthorization({
    projectId: input.projectId,
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    actionIntentId: intent.id,
    authorizationTier: "owner_confirmation",
    actionDigest,
    policyRule: "owner-confirmation/v1",
    expiresAt: intent.expiresAt,
    idempotencyKey: `${input.idempotencyKey}:authorization`
  });
  const approved = repo.approveAuthorization({
    authorizationId: authorization.id,
    expectedProjectionVersion: authorization.projectionVersion,
    actionDigest: authorization.actionDigest,
    actorId: input.userId
  });
  repo.createStateGate().transition({
    recordType: "authorization",
    recordId: approved.id,
    toState: "consumed",
    actorId: input.userId,
    expectedProjectionVersion: approved.projectionVersion,
    idempotencyKey: `${input.idempotencyKey}:consume`
  });
  const command = repo.createCommand({
    projectId: input.projectId,
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    actionIntentId: intent.id,
    assignmentId: input.assignmentId,
    authorizationId: authorization.id,
    commandType: "session.dispatch",
    payloadDigest: dispatchPayloadDigest,
    idempotencyKey: `${input.idempotencyKey}:command`
  });
  repo.recordDispatchReceipt({
    commandId: command.id,
    assignmentId: input.assignmentId,
    leaseToken: input.leaseToken,
    receiptDigest: `sha256:${input.idempotencyKey}:receipt`,
    expectedProjectionVersion: command.projectionVersion,
    idempotencyKey: `${input.idempotencyKey}:receipt`
  });
}

describe("copilot bridge internal API", () => {
  let db: Database.Database;
  let app: GatewayApp;
  let baseUrl: string;
  let sentInputs: SentInput[];
  let sessionManager: InMemorySessionManager;
  let owner: User;
  let stranger: User;

  before(async () => {
    db = createTestDb();
    sentInputs = [];
    sessionManager = new InMemorySessionManager(createMockTmux(sentInputs) as never);
    app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      copilotBridgeToken: bridgeToken
    });
    baseUrl = await listen(app);
    owner = new UserRepository(db).create("bridge-owner@example.com", "hash");
    stranger = new UserRepository(db).create("bridge-stranger@example.com", "hash");
  });

  after(async () => {
    await app.close();
  });

  describe("authentication", () => {
    it("rejects a missing service token with 401", async () => {
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions`, {
        headers: { "x-openforge-user-id": owner.id }
      });
      assert.equal(res.status, 401);
      const body = (await res.json()) as Envelope;
      assert.equal(body.code, 1);
    });

    it("rejects a wrong service token with 403", async () => {
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions`, {
        headers: bridgeHeaders(owner.id, "wrong-token-wrong-token-wrong-token-00")
      });
      assert.equal(res.status, 403);
    });

    it("rejects a missing X-ForgeBadger-User-Id header with 400", async () => {
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions`, {
        headers: { authorization: `Bearer ${bridgeToken}` }
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as Envelope;
      assert.equal(body.details?.code, "BRIDGE_USER_ID_REQUIRED");
    });
  });

  describe("sessions", () => {
    let projectId: string;
    let sessionId: string;

    before(async () => {
      const project = new ProjectRepository(db, owner.id).create({
        name: "Bridge sessions project",
        path: "/tmp/forgebadger-bridge-sessions",
        aiTool: "claude"
      });
      projectId = project.id;
      sessionId = new SessionRepository(db, owner.id).create({
        projectId,
        name: "Bridge target session",
        aiTool: "claude",
        workingDir: project.path
      }).id;
    });

    it("lists only the acting user's sessions", async () => {
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions`, {
        headers: bridgeHeaders(owner.id)
      });
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 200, JSON.stringify(body));
      const sessions = body.data?.sessions as Array<Record<string, unknown>>;
      const listed = sessions.find((session) => session.id === sessionId);
      assert.ok(listed, "owner session should be listed");
      assert.equal(listed.name, "Bridge target session");
      assert.equal(listed.aiTool, "claude");
      assert.equal(listed.projectId, projectId);

      const foreign = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions`, {
        headers: bridgeHeaders(stranger.id)
      });
      const foreignBody = (await foreign.json()) as Envelope;
      assert.equal(foreign.status, 200);
      assert.equal(foreignBody.data?.count, 0);
    });

    it("filters sessions by projectId", async () => {
      const res = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/sessions?projectId=${projectId}`,
        { headers: bridgeHeaders(owner.id) }
      );
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 200);
      assert.ok((body.data?.count as number) >= 1);

      const empty = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/sessions?projectId=no-such-project`,
        { headers: bridgeHeaders(owner.id) }
      );
      const emptyBody = (await empty.json()) as Envelope;
      assert.equal(emptyBody.data?.count, 0);
    });

    it("returns a session detail and hides other users' sessions", async () => {
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${sessionId}`, {
        headers: bridgeHeaders(owner.id)
      });
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 200, JSON.stringify(body));
      const session = body.data?.session as Record<string, unknown>;
      assert.equal(session.id, sessionId);
      assert.equal(session.workingDir, "/tmp/forgebadger-bridge-sessions");

      const foreign = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${sessionId}`, {
        headers: bridgeHeaders(stranger.id)
      });
      assert.equal(foreign.status, 404);
    });
  });

  describe("session dispatch", () => {
    let projectId: string;
    let sessionId: string;

    before(async () => {
      const project = new ProjectRepository(db, owner.id).create({
        name: "Bridge dispatch project",
        path: "/tmp/forgebadger-bridge-dispatch",
        aiTool: "claude"
      });
      projectId = project.id;
      sessionId = new SessionRepository(db, owner.id).create({
        projectId,
        name: "Dispatch target session",
        aiTool: "claude",
        workingDir: project.path
      }).id;
      await sessionManager.createSession({
        userId: owner.id,
        sessionId,
        launchPlan: {
          command: "claude",
          args: [],
          cwd: project.path,
          env: {},
          secretEnvNames: [],
          credentialMode: "host_environment"
        }
      });
    });

    it("injects the message through the session-manager terminal input path", async () => {
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${sessionId}/dispatch`, {
        method: "POST",
        headers: bridgeHeaders(owner.id),
        body: JSON.stringify({ message: "修复登录页样式回归" })
      });
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.deepEqual(body.data, { dispatched: true, sessionId, delivery: "consumed" });
      const sent = sentInputs.find((input) => input.data === "修复登录页样式回归");
      assert.ok(sent, "tmux programmatic input should stage the complete message once");
      assert.ok(sent.name.startsWith("of-"));
      assert.equal(sentInputs.filter((input) => input.data === "<Enter>").length, 1);
    });

    it("rejects an empty or oversized message with 400", async () => {
      for (const message of ["   ", "x".repeat(4001)]) {
        const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${sessionId}/dispatch`, {
          method: "POST",
          headers: bridgeHeaders(owner.id),
          body: JSON.stringify({ message })
        });
        assert.equal(res.status, 400);
      }
    });

    it("rejects terminal control characters before writing to tmux", async () => {
      const before = sentInputs.length;
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${sessionId}/dispatch`, {
        method: "POST",
        headers: bridgeHeaders(owner.id),
        body: JSON.stringify({ message: "hello\u001b[201~\rInjected command" })
      });
      const body = (await res.json()) as Envelope;

      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(body.details?.code, "PROGRAMMATIC_SUBMIT_UNSAFE_INPUT");
      assert.equal(sentInputs.length, before, "unsafe input must not reach tmux");
    });

    it("returns 404 when dispatching to another user's session", async () => {
      const before_ = sentInputs.length;
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${sessionId}/dispatch`, {
        method: "POST",
        headers: bridgeHeaders(stranger.id),
        body: JSON.stringify({ message: "越权注入" })
      });
      assert.equal(res.status, 404);
      assert.equal(sentInputs.length, before_, "no terminal input must be written for a foreign session");
    });

    it("returns 409 when the session is not active in this Gateway process", async () => {
      const inactiveId = new SessionRepository(db, owner.id).create({
        projectId,
        name: "Inactive session",
        aiTool: "claude",
        workingDir: "/tmp/forgebadger-bridge-dispatch"
      }).id;
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${inactiveId}/dispatch`, {
        method: "POST",
        headers: bridgeHeaders(owner.id),
        body: JSON.stringify({ message: "hello" })
      });
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 409);
      assert.equal(body.details?.code, "BRIDGE_SESSION_NOT_ACTIVE");
    });
  });

  describe("work items and portfolio overview", () => {
    it("lists, filters and reads only the acting user's work items", async () => {
      // Arrange
      const fixture = createPortfolioPhase4Fixture({
        db,
        ownerEmail: "bridge-portfolio-owner@example.com",
        fixtureKey: "bridge-list"
      });

      // Act
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/work-items`, {
        headers: bridgeHeaders(fixture.owner.id)
      });
      const body = (await res.json()) as Envelope;

      // Assert
      assert.equal(res.status, 200, JSON.stringify(body));
      const workItems = body.data?.workItems as Array<Record<string, unknown>>;
      assert.ok(workItems.some((item) => item.id === fixture.workItem.id));

      const byStatus = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/work-items?status=todo&projectId=${fixture.projectId}`,
        { headers: bridgeHeaders(fixture.owner.id) }
      );
      const byStatusBody = (await byStatus.json()) as Envelope;
      assert.equal(byStatusBody.data?.count, 1);

      const wrongStatus = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/work-items?status=done`,
        { headers: bridgeHeaders(fixture.owner.id) }
      );
      const wrongStatusBody = (await wrongStatus.json()) as Envelope;
      assert.equal(wrongStatusBody.data?.count, 0);

      const invalidStatus = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/work-items?status=bogus`,
        { headers: bridgeHeaders(fixture.owner.id) }
      );
      assert.equal(invalidStatus.status, 400);

      // Cross-user isolation
      const foreign = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/work-items`, {
        headers: bridgeHeaders(stranger.id)
      });
      const foreignBody = (await foreign.json()) as Envelope;
      assert.equal(foreignBody.data?.count, 0);
      const foreignGet = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/work-items/${fixture.workItem.id}`,
        { headers: bridgeHeaders(stranger.id) }
      );
      assert.equal(foreignGet.status, 404);

      const detail = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/work-items/${fixture.workItem.id}`,
        { headers: bridgeHeaders(fixture.owner.id) }
      );
      const detailBody = (await detail.json()) as Envelope;
      assert.equal(detail.status, 200);
      assert.equal((detailBody.data?.workItem as Record<string, unknown>).title, fixture.workItem.title);
    });

    it("returns the portfolio overview for the acting user", async () => {
      const fixture = createPortfolioPhase4Fixture({
        db,
        ownerEmail: "bridge-overview-owner@example.com",
        fixtureKey: "bridge-overview"
      });
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/portfolio/overview`, {
        headers: bridgeHeaders(fixture.owner.id)
      });
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 200, JSON.stringify(body));
      const overview = body.data?.overview as Record<string, unknown>;
      assert.ok(Array.isArray(overview.dossiers));
      assert.equal((overview.dossiers as unknown[]).length, 1);
    });

    it("advances a dispatched work item one step via the State Gate", async () => {
      // Arrange: full receipt chain so todo -> in_progress satisfies preconditions.
      const fixture = createPortfolioPhase4Fixture({
        db,
        ownerEmail: "bridge-advance-owner@example.com",
        fixtureKey: "bridge-advance"
      });
      const attempt = createExecutablePortfolioAttempt(fixture.repository, {
        projectId: fixture.projectId,
        workItemId: fixture.workItem.id,
        packetVersion: 1,
        adapter: "claude",
        createdBy: fixture.owner.id,
        sourceWorkItemVersion: fixture.workItem.projectionVersion,
        idempotencyKey: "bridge-advance:attempt"
      });
      const assignment = fixture.repository.claimSessionAssignment({
        projectId: fixture.projectId,
        workItemId: fixture.workItem.id,
        attemptId: attempt.id,
        sessionId: fixture.session.id,
        adapter: "claude",
        leaseDurationMs: 60_000
      });
      recordValidatedDispatchReceipt(fixture.repository, {
        userId: fixture.owner.id,
        projectId: fixture.projectId,
        workItemId: fixture.workItem.id,
        attemptId: attempt.id,
        sessionId: fixture.session.id,
        assignmentId: assignment.id,
        leaseToken: assignment.leaseToken,
        idempotencyKey: "bridge-advance:receipt"
      });

      // Act
      const res = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/work-items/${fixture.workItem.id}/advance`,
        {
          method: "POST",
          headers: bridgeHeaders(fixture.owner.id),
          body: JSON.stringify({ note: "已下发到会话，开始执行" })
        }
      );
      const body = (await res.json()) as Envelope;

      // Assert
      assert.equal(res.status, 200, JSON.stringify(body));
      const transition = body.data?.transition as Record<string, unknown>;
      assert.equal(transition.fromState, "todo");
      assert.equal(transition.toState, "in_progress");
      assert.equal(fixture.repository.getWorkItem(fixture.workItem.id)?.state, "in_progress");
    });

    it("keeps State Gate preconditions enforced when advancing without a dispatch", async () => {
      // Arrange: fresh todo work item with no attempt/receipt.
      const fixture = createPortfolioPhase4Fixture({
        db,
        ownerEmail: "bridge-gate-owner@example.com",
        fixtureKey: "bridge-gate"
      });

      // Act
      const res = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/work-items/${fixture.workItem.id}/advance`,
        {
          method: "POST",
          headers: bridgeHeaders(fixture.owner.id),
          body: JSON.stringify({})
        }
      );
      const body = (await res.json()) as Envelope;

      // Assert
      assert.equal(res.status, 409);
      assert.equal(body.details?.code, "PORTFOLIO_PRECONDITION_FAILED");
      assert.equal(fixture.repository.getWorkItem(fixture.workItem.id)?.state, "todo");
    });

    it("returns 404 when advancing another user's work item", async () => {
      const fixture = createPortfolioPhase4Fixture({
        db,
        ownerEmail: "bridge-foreign-owner@example.com",
        fixtureKey: "bridge-foreign"
      });
      const res = await fetch(
        `${baseUrl}/api/internal/v1/copilot-bridge/work-items/${fixture.workItem.id}/advance`,
        {
          method: "POST",
          headers: bridgeHeaders(stranger.id),
          body: JSON.stringify({})
        }
      );
      assert.equal(res.status, 404);
    });
  });
});

describe("session dispatch consumption confirmation (indeterminate path)", () => {
  let app: GatewayApp;
  let baseUrl: string;
  let ownerId: string;
  let sessionId: string;
  let sentInputs: SentInput[];

  before(async () => {
    const db = createTestDb();
    sentInputs = [];
    // The target shows the staged input but never consumes it after Enter.
    const sessionManager = new InMemorySessionManager(createSilentMockTmux(sentInputs) as never);
    app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      copilotBridgeToken: bridgeToken
    });
    baseUrl = await listen(app);
    ownerId = new UserRepository(db).create("bridge-modal-owner@example.com", "hash").id;
    const project = new ProjectRepository(db, ownerId).create({
      name: "Modal dispatch project",
      path: "/tmp/forgebadger-bridge-modal",
      aiTool: "claude"
    });
    sessionId = new SessionRepository(db, ownerId).create({
      projectId: project.id,
      name: "Modal target session",
      aiTool: "claude",
      workingDir: project.path
    }).id;
    await sessionManager.createSession({
      userId: ownerId,
      sessionId,
      launchPlan: {
        command: "claude",
        args: [],
        cwd: project.path,
        env: {},
        secretEnvNames: [],
        credentialMode: "host_environment"
      }
    });
  });

  after(async () => {
    await app.close();
  });

  it("returns 502 when the staged composer remains after Enter", async () => {
    const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions/${sessionId}/dispatch`, {
      method: "POST",
      headers: bridgeHeaders(ownerId),
      body: JSON.stringify({ message: "这条消息会被模态对话框吞掉" })
    });
    const body = (await res.json()) as Envelope & { details?: { code?: string; reason?: string } };
    assert.equal(res.status, 502, JSON.stringify(body));
    assert.equal(body.code, 1);
    assert.equal(body.details?.code, "BRIDGE_DELIVERY_UNCONFIRMED");
    assert.equal(body.details?.reason, "submission_indeterminate");
    assert.match(body.message ?? "", /do not retry automatically/);
    // The task and one Enter were written; no retry or cleanup write followed.
    assert.ok(sentInputs.some((input) => input.data === "这条消息会被模态对话框吞掉"));
    assert.equal(sentInputs.filter((input) => input.data === "<Enter>").length, 1);
  });
});

describe("copilot bridge internal API without a configured token", () => {
  let app: GatewayApp;
  let baseUrl: string;

  before(async () => {
    app = createGatewayApp({
      jwtSecret,
      masterKey,
      db: createTestDb(),
      sessionManager: new InMemorySessionManager(createMockTmux([]) as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey })
    });
    baseUrl = await listen(app);
  });

  after(async () => {
    await app.close();
  });

  it("does not mount the route group at all", async () => {
    const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/sessions`, {
      headers: bridgeHeaders("any-user")
    });
    assert.equal(res.status, 404);
  });
});
