import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

const mockTmuxClient = {
  async createSession() {},
  async killSession() {},
  async capturePane() {
    return "";
  },
  async listSessions() {
    return [];
  }
};

interface AuthResponseBody {
  data: {
    token: string;
    user: { id: string; email: string };
  };
}

interface ConversationResponseBody {
  code: number;
  data?: {
    conversation?: {
      id: string;
      title: string | null;
    };
    conversations?: Array<{
      id: string;
      title: string | null;
    }>;
    deleted?: boolean;
  };
}

describe("copilot conversation routes", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;

  before(async () => {
    const db = createTestDb();
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager(mockTmuxClient as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey })
    });
    await new Promise<void>((resolve) => {
      server = app.server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string") {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(() => {
    server.close();
  });

  it("renames a conversation owned by the requesting user", async () => {
    // Arrange
    const token = await register("copilot-rename@test.com");
    const conversationId = await createConversation(token);

    // Act
    const res = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}`, {
      method: "PATCH",
      headers: authenticated(token),
      body: JSON.stringify({ title: "重构计划" })
    });

    // Assert
    const body = (await res.json()) as ConversationResponseBody;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.conversation?.title, "重构计划");
  });

  it("rejects an empty or oversized rename title", async () => {
    // Arrange
    const token = await register("copilot-rename-invalid@test.com");
    const conversationId = await createConversation(token);

    for (const title of ["", " ".repeat(201)]) {
      // Act
      const res = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}`, {
        method: "PATCH",
        headers: authenticated(token),
        body: JSON.stringify({ title })
      });

      // Assert
      assert.equal(res.status, 400);
    }
  });

  it("cannot rename another user's conversation", async () => {
    // Arrange
    const ownerToken = await register("copilot-owner@test.com");
    const strangerToken = await register("copilot-stranger@test.com");
    const conversationId = await createConversation(ownerToken);

    // Act
    const res = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}`, {
      method: "PATCH",
      headers: authenticated(strangerToken),
      body: JSON.stringify({ title: "劫持标题" })
    });

    // Assert: user scoping turns a foreign conversation into a 404.
    assert.equal(res.status, 404);
    const list = await listConversations(ownerToken);
    assert.notEqual(list.find((conversation) => conversation.id === conversationId)?.title, "劫持标题");
  });

  it("deletes a conversation and keeps the delete scoped to its owner", async () => {
    // Arrange
    const ownerToken = await register("copilot-delete-owner@test.com");
    const strangerToken = await register("copilot-delete-stranger@test.com");
    const keptId = await createConversation(ownerToken);
    const removedId = await createConversation(ownerToken);

    // Act
    const strangerDelete = await fetch(`${baseUrl}/api/v1/copilot/conversations/${removedId}`, {
      method: "DELETE",
      headers: authenticated(strangerToken)
    });
    const ownerDelete = await fetch(`${baseUrl}/api/v1/copilot/conversations/${removedId}`, {
      method: "DELETE",
      headers: authenticated(ownerToken)
    });
    const ownerList = await listConversations(ownerToken);

    // Assert
    assert.equal(strangerDelete.status, 404);
    assert.equal(ownerDelete.status, 200);
    assert.equal(ownerList.some((conversation) => conversation.id === removedId), false);
    assert.equal(ownerList.some((conversation) => conversation.id === keptId), true);
  });

  it("404s when deleting an already-deleted conversation", async () => {
    // Arrange
    const token = await register("copilot-delete-repeat@test.com");
    const conversationId = await createConversation(token);
    await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}`, {
      method: "DELETE",
      headers: authenticated(token)
    });

    // Act
    const res = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}`, {
      method: "DELETE",
      headers: authenticated(token)
    });

    // Assert: the row is gone; repeat deletes report the same terminal state
    // as any other missing conversation instead of silently succeeding.
    assert.equal(res.status, 404);
  });

  async function register(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    const body = (await res.json()) as AuthResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.token;
  }

  function authenticated(token: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  async function createConversation(token: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/copilot/conversations`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({})
    });
    const body = (await res.json()) as ConversationResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data!.conversation!.id;
  }

  async function listConversations(token: string): Promise<ConversationResponseBody["data"]> {
    const res = await fetch(`${baseUrl}/api/v1/copilot/conversations`, {
      headers: authenticated(token)
    });
    const body = (await res.json()) as ConversationResponseBody;
    assert.equal(res.status, 200, JSON.stringify(body));
    return body.data?.conversations ?? [];
  }
});

describe("copilot edit-message route", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;
  let db: Database;
  let seededEmails: string[];

  // The orchestrator's runTurn invokes the LLM client; tests stub the fetch so
  // no network egress happens and the model returns a deterministic no-tool
  // assistant turn. Each seedModel call below configures one user.
  function seedModel(email: string): void {
    const userId = deriveUserId(email);
    const repo = new ModelProviderRepository(db, userId, masterKey);
    const provider = repo.createProviderProfile({
      name: "Stub",
      providerKey: "stub",
      // Use a public IP literal so the fake fetch remains hermetic in CI while
      // still exercising the production SSRF validation path.
      baseUrl: "https://8.8.8.8",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["opencode"]
    });
    repo.createModelProfile({
      providerProfileId: provider.id,
      name: "Stub model",
      modelId: "stub-model",
      capabilities: ["chat"],
      isDefault: true
    });
    repo.createCredential({ providerProfileId: provider.id, label: "key", plaintextSecret: "secret" });
  }

  before(async () => {
    db = createTestDb();
    const stubFetch: typeof fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "stubbed answer", tool_calls: [] } }]
      })
    }) as Response;
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager(mockTmuxClient as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      llmFetch: stubFetch
    });
    await new Promise<void>((resolve) => {
      server = app.server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string") {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
    seededEmails = [];
  });

  // Each edit-message test runs in its own user namespace, so seed the model
  // profile after the user has been minted by `register()`.
  async function withSeededModel<T>(email: string, body: () => Promise<T>): Promise<T> {
    if (!seededEmails.includes(email)) {
      seedModel(email);
      seededEmails.push(email);
    }
    return body();
  }

  after(() => {
    server.close();
  });

  it("truncates the edit target and everything after it before running a new turn", async () => {
    const token = await register("copilot-edit@test.com");
    return withSeededModel("copilot-edit@test.com", async () => {
      const conversationId = await createConversation(token);
      // Persist three messages directly so we can assert the cascade without
      // going through the LLM-backed runTurn path for the original messages.
      const log = new CopilotConversationLog(db, deriveUserId("copilot-edit@test.com"));
      const m1 = log.appendMessage(conversationId, { role: "user", kind: "text", content: "first question" });
      log.appendMessage(conversationId, { role: "assistant", kind: "text", content: "first answer" });
      const m3 = log.appendMessage(conversationId, { role: "user", kind: "text", content: "follow-up question" });

      // Act: edit the first user message; the assistant reply and the follow-up
      // must be discarded, but the edited message keeps its original sequence
      // and the runTurn that follows must not append a duplicate user message.
      const res = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}/edit-message`, {
        method: "POST",
        headers: authenticated(token),
        body: JSON.stringify({ messageId: m1.id, content: "revised question" })
      });

      // Assert
      const body = (await res.json()) as { code: number; data?: { runId?: string } };
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.ok(body.data?.runId);
      const remaining = new CopilotConversationLog(db, deriveUserId("copilot-edit@test.com")).listMessages(conversationId);
      const userMessages = remaining.filter((message) => message.role === "user");
      assert.equal(userMessages.length, 1, "only the edited user message survives");
      assert.equal(userMessages[0]?.content, "revised question");
      assert.equal(userMessages[0]?.sequence, m1.sequence);
      assert.equal(remaining.some((message) => message.id === m3.id), false);
      // The orchestrator emits one assistant turn for the new prompt.
      const assistantMessages = remaining.filter((message) => message.role === "assistant");
      assert.equal(assistantMessages.length, 1, "the rerun produced exactly one assistant turn");
      assert.equal(assistantMessages[0]?.content, "stubbed answer");
    });
  });

  it("404s when the edit target belongs to another user", async () => {
    // Arrange
    const ownerToken = await register("copilot-edit-owner@test.com");
    const strangerToken = await register("copilot-edit-stranger@test.com");
    const conversationId = await createConversation(ownerToken);
    const log = new CopilotConversationLog(db, deriveUserId("copilot-edit-owner@test.com"));
    const target = log.appendMessage(conversationId, { role: "user", kind: "text", content: "private" });

    // Act
    const res = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}/edit-message`, {
      method: "POST",
      headers: authenticated(strangerToken),
      body: JSON.stringify({ messageId: target.id, content: "劫持" })
    });

    // Assert
    assert.equal(res.status, 404);
    const remaining = new CopilotConversationLog(db, deriveUserId("copilot-edit-owner@test.com")).listMessages(conversationId);
    assert.equal(remaining[0]?.content, "private");
  });

  it("rejects an empty or oversized edit content", async () => {
    // Arrange
    const token = await register("copilot-edit-invalid@test.com");
    const conversationId = await createConversation(token);
    const log = new CopilotConversationLog(db, deriveUserId("copilot-edit-invalid@test.com"));
    const target = log.appendMessage(conversationId, { role: "user", kind: "text", content: "ok" });

    for (const content of ["", " ".repeat(32 * 1024 + 1)]) {
      // Act
      const res = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}/edit-message`, {
        method: "POST",
        headers: authenticated(token),
        body: JSON.stringify({ messageId: target.id, content })
      });

      // Assert
      assert.equal(res.status, 400);
    }
  });

  it("auto-generates the conversation title after the first completed turn", async () => {
    const token = await register("copilot-autotitle@test.com");
    return withSeededModel("copilot-autotitle@test.com", async () => {
      const conversationId = await createConversation(token);
      // Fire any first-turn: the LLM stub returns "stubbed answer", so the
      // orchestrator should kick off the fire-and-forget title generation and
      // persist a sanitized title. We poll briefly because the title call is
      // async and not awaited by the route.
      const send = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: authenticated(token),
        body: JSON.stringify({ content: "我想排查 K8s pod 启动失败" })
      });
      assert.equal(send.status, 201);

      let titledConversation: Awaited<ReturnType<CopilotConversationLog["getConversation"]>>;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        titledConversation = new CopilotConversationLog(db, deriveUserId("copilot-autotitle@test.com")).getConversation(conversationId);
        if (titledConversation?.title) break;
      }
      assert.ok(titledConversation?.title, "auto-title should land on the conversation row");
      assert.ok((titledConversation?.title ?? "").length > 0);
      assert.ok((titledConversation?.title ?? "").length <= 24, "title respects the 24-char cap");
    });
  });

  it("does not overwrite a user-renamed title on subsequent turns", async () => {
    const token = await register("copilot-autotitle-rename@test.com");
    return withSeededModel("copilot-autotitle-rename@test.com", async () => {
      const conversationId = await createConversation(token);
      // Owner renames before any run.
      const renamed = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}`, {
        method: "PATCH",
        headers: authenticated(token),
        body: JSON.stringify({ title: "我手动起的标题" })
      });
      assert.equal(renamed.status, 200);
      // First user turn — auto-title must NOT clobber the owner-set title.
      const send = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: authenticated(token),
        body: JSON.stringify({ content: "first question" })
      });
      assert.equal(send.status, 201);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const conversation = new CopilotConversationLog(db, deriveUserId("copilot-autotitle-rename@test.com")).getConversation(conversationId);
      assert.equal(conversation?.title, "我手动起的标题");
    });
  });

  async function register(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    const body = (await res.json()) as AuthResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    registeredUserIds.set(email, body.data.user.id);
    return body.data.token;
  }

  function authenticated(token: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  async function createConversation(token: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/copilot/conversations`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({})
    });
    const body = (await res.json()) as ConversationResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data!.conversation!.id;
  }
});

// Tracks the user ids minted by `register` so test bodies can construct a
// CopilotConversationLog directly (the route handler exposes data via API,
// but the new edit-message tests need to seed messages before exercising it).
const registeredUserIds = new Map<string, string>();

function deriveUserId(email: string): string {
  const id = registeredUserIds.get(email);
  if (!id) throw new Error(`No registered user for ${email}`);
  return id;
}
