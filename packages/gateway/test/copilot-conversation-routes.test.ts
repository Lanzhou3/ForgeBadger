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

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;

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
