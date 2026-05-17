import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type { LaunchPlan } from "../../src/adapters/claude.js";
import { signJwt } from "../../src/auth/jwt.js";
import { ModelProviderRepository } from "../../src/db/repositories/model-provider-repository.js";
import { ProjectRepository } from "../../src/db/repositories/project-repository.js";
import { SessionRepository } from "../../src/db/repositories/session-repository.js";
import { UserRepository } from "../../src/db/repositories/user-repository.js";
import type { Database as OpenForgeDatabase } from "../../src/db/types.js";
import { createCopilotRoutes } from "../../src/routes/copilot.js";
import { InMemorySessionManager } from "../../src/services/session-manager.js";
import { createTmuxClient } from "../../src/services/tmux.js";
import type {
  CopilotModelClient,
  CopilotModelEvent,
  CopilotModelRequest,
  CopilotModelRequestOptions
} from "../../src/services/copilot/types.js";

const runTmuxTests = process.env.RUN_TMUX_TESTS === "1";
const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

describe("copilot tmux integration", { skip: !runTmuxTests }, () => {
  it("approves Copilot terminal input into a real tmux-backed session", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("copilot-tmux@example.com", "hash");
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    createOpenAiProvider(db, user.id);

    const project = new ProjectRepository(db, user.id).create({
      name: "tmux-project",
      path: tmpdir(),
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, user.id);
    const created = sessionRepo.create({
      projectId: project.id,
      name: "Real tmux session",
      aiTool: "claude",
      workingDir: tmpdir()
    });

    const sessionManager = new InMemorySessionManager(createTmuxClient(), undefined, undefined, {
      tmuxPrefix: `of-copilot-${process.pid}-`
    });
    const gateSession = await sessionManager.createSession({
      userId: user.id,
      sessionId: created.id,
      launchPlan: echoLaunchPlan(created.id)
    });
    sessionRepo.update(created.id, {
      status: "running",
      attachToken: gateSession.attachToken,
      tmuxSession: gateSession.tmuxName
    });

    const modelResponses: CopilotModelEvent[][] = [
      [{
        type: "tool_call_requested",
        id: "detail",
        name: "openforge.get_session_detail",
        input: { sessionId: created.id }
      }],
      [{
        type: "tool_call_requested",
        id: "snapshot",
        name: "openforge.get_session_terminal_snapshot",
        input: { sessionId: created.id }
      }],
      [{
        type: "tool_call_requested",
        id: "input",
        name: "openforge.propose_session_input",
        input: {
          sessionId: created.id,
          input: "hello-from-copilot",
          submit: true
        }
      }],
      [{ type: "assistant_message", text: "Input sent to the running session." }]
    ];
    const calls: CopilotModelRequest[] = [];
    const app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/copilot", createCopilotRoutes({
      db,
      masterKey,
      sessionManager,
      modelClientFactory: () => fakeModelClient(calls, () => modelResponses.shift() ?? [])
    }));

    try {
      const runRes = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
        prompt: "Send hello-from-copilot into the running session after inspecting it",
        source: "copilot"
      }, authHeaders(token));

      assert.equal(runRes.status, 201);
      assert.equal(runRes.body.data.run.status, "waiting_for_approval");
      const action = runRes.body.data.pendingActions[0];
      assert.equal(action.type, "openforge.propose_session_input");

      const approveRes = await makeRequest(
        app,
        "POST",
        `/api/v1/copilot/runs/${runRes.body.data.run.id}/pending-actions/${action.id}/approve`,
        {},
        authHeaders(token)
      );

      assert.equal(approveRes.status, 200);
      assert.equal(approveRes.body.data.run.status, "completed");
      await waitForHistory(sessionManager, created.id, /copilot-real-tmux:hello-from-copilot/);
      assert.match(JSON.stringify(approveRes.body), /Input sent to the running session/);
      assert.ok(calls.length >= 4);
    } finally {
      await sessionManager.stopSession(created.id).catch(() => undefined);
    }
  });
});

function createTestDb(): OpenForgeDatabase {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

function createOpenAiProvider(db: OpenForgeDatabase, userId: string): void {
  const repo = new ModelProviderRepository(db, userId, masterKey);
  const provider = repo.createProviderProfile({
    providerKey: "copilot-tmux-openai",
    name: "Copilot tmux OpenAI",
    baseUrl: "https://api.openai.com/v1",
    authType: "api_key",
    apiFormat: "openai",
    supportedAdapters: ["claude", "opencode"]
  });
  repo.createModelProfile({
    providerProfileId: provider.id,
    name: "GPT",
    modelId: "gpt-5.1",
    isDefault: true
  });
  repo.createCredential({
    providerProfileId: provider.id,
    plaintextSecret: "sk-test"
  });
}

function echoLaunchPlan(sessionId: string): LaunchPlan {
  return {
    command: "bash",
    args: ["-lc", "while IFS= read -r line; do printf 'copilot-real-tmux:%s\\n' \"$line\"; done"],
    cwd: tmpdir(),
    env: { OPENFORGE_SESSION_ID: sessionId },
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

function fakeModelClient(
  calls: CopilotModelRequest[],
  events: (
    request: CopilotModelRequest,
    options?: CopilotModelRequestOptions
  ) => CopilotModelEvent[] | Promise<CopilotModelEvent[]>
): CopilotModelClient {
  return {
    async createResponse(request: CopilotModelRequest, options?: CopilotModelRequestOptions) {
      calls.push(request);
      return await events(request, options);
    }
  };
}

async function makeRequest(
  app: express.Express,
  method: string,
  pathName: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  try {
    const res = await fetch(`${baseUrl}${pathName}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const responseBody = await res.json().catch(() => ({}));
    return { status: res.status, body: responseBody };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function listen(server: http.Server): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function waitForHistory(
  sessionManager: InMemorySessionManager,
  sessionId: string,
  pattern: RegExp
): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    const history = await sessionManager.captureHistory(sessionId);
    if (pattern.test(history)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(await sessionManager.captureHistory(sessionId), pattern);
}
