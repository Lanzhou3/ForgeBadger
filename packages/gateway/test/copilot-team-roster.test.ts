import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { signJwt } from "../src/auth/jwt.js";
import { loadEnv } from "../src/config/env.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { createGatewayApp } from "../src/server.js";
import { AgentError } from "../src/services/agent/types.js";
import { assertAdapterAutonomy } from "../src/services/agent/goal-grants.js";
import {
  copilotTeamRoster, defaultCopilotTeam, rosterForModel, setCopilotTeamRoster, writerMemberById, writerMemberFor,
  type TeamMember
} from "../src/services/agent/team-roster.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { createRuntimeSettingsStore } from "../src/services/runtime-settings.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

process.env.FORGEBADGER_JWT_SECRET = "0123456789abcdef0123456789abcdef";
process.env.FORGEBADGER_MASTER_KEY = "abcdef0123456789abcdef0123456789";

function member(over: Partial<TeamMember> = {}): TeamMember {
  return { id: "m1", name: "Ada", title: "Lead", description: "Writes code", adapter: "claude", roles: ["writer"], enabled: true, ...over };
}

afterEach(() => setCopilotTeamRoster(defaultCopilotTeam()));

describe("team roster helpers", () => {
  it("starts empty with the default parallel writer cap", () => {
    assert.deepEqual(copilotTeamRoster(), { maxParallelWriters: 3, members: [] });
    assert.equal(writerMemberFor("claude"), undefined);
  });

  it("finds the first enabled writer for an adapter", () => {
    setCopilotTeamRoster({ maxParallelWriters: 2, members: [
      member({ id: "off", enabled: false }), member({ id: "rev", roles: ["reviewer"] }),
      member({ id: "a" }), member({ id: "b" }), member({ id: "k", adapter: "kimi" })
    ] });
    assert.equal(writerMemberFor("claude")?.id, "a");
    assert.equal(writerMemberFor("kimi")?.id, "k");
    assert.equal(writerMemberFor("codex"), undefined);
    assert.equal(writerMemberById("a")?.id, "a");
    assert.equal(writerMemberById("off"), undefined);
    assert.equal(writerMemberById("rev"), undefined);
  });

  it("projects enabled members only and clips descriptions", () => {
    setCopilotTeamRoster({ maxParallelWriters: 3, members: [
      member({ id: "long", description: "x".repeat(300), roles: ["writer", "reviewer"] }), member({ id: "off", enabled: false })
    ] });
    const projected = rosterForModel();
    assert.equal(projected.length, 1);
    assert.equal(projected[0]!.id, "long");
    assert.equal(Array.from(projected[0]!.description).length, 201);
    assert.deepEqual(projected[0]!.roles, ["writer", "reviewer"]);
    assert.equal("enabled" in projected[0]!, false);
  });

  it("assertAdapterAutonomy requires a programmatic adapter and a writer member", () => {
    const denied = (error: unknown) => error instanceof AgentError && error.code === "COPILOT_ADAPTER_AUTONOMY_DENIED";
    assert.throws(() => assertAdapterAutonomy("claude"), denied);
    setCopilotTeamRoster({ maxParallelWriters: 3, members: [member(), member({ id: "g", adapter: "grok" })] });
    assert.doesNotThrow(() => assertAdapterAutonomy("claude"));
    assert.throws(() => assertAdapterAutonomy("grok"), denied);
  });
});

describe("team roster startup wiring", () => {
  it("applies the saved roster at startup and on PUT", async () => {
    const db = new Database(":memory:");
    migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
    const env = loadEnv({ FORGEBADGER_JWT_SECRET: process.env.FORGEBADGER_JWT_SECRET, FORGEBADGER_MASTER_KEY: process.env.FORGEBADGER_MASTER_KEY });
    const admin = new UserRepository(db).create("team-roster@example.com", "hash", { role: "admin" });
    createRuntimeSettingsStore(db, { env }).update(admin.id, { copilot_team: { maxParallelWriters: 4, members: [member()] } });
    const masterKey = process.env.FORGEBADGER_MASTER_KEY!;
    const gateway = createGatewayApp({
      db, env, jwtSecret: process.env.FORGEBADGER_JWT_SECRET!, masterKey,
      sessionManager: new InMemorySessionManager({} as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      eventBus: new ForgeBadgerEventBus(),
      sessionServerIpcPath: "/tmp/forgebadger-test-team-roster.sock"
    });
    try {
      assert.equal(copilotTeamRoster().maxParallelWriters, 4);
      assert.equal(writerMemberFor("claude")?.id, "m1");
      await new Promise<void>((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
      const port = (gateway.server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/runtime-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${signJwt({ userId: admin.id, email: admin.email }, process.env.FORGEBADGER_JWT_SECRET!)}` },
        body: JSON.stringify({ copilot_team: { maxParallelWriters: 1, members: [] } })
      });
      assert.equal(response.status, 200);
      assert.deepEqual(copilotTeamRoster(), { maxParallelWriters: 1, members: [] });
      const bad = await fetch(`http://127.0.0.1:${port}/api/v1/runtime-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${signJwt({ userId: admin.id, email: admin.email }, process.env.FORGEBADGER_JWT_SECRET!)}` },
        body: JSON.stringify({ copilot_team: { maxParallelWriters: 1, members: [member(), member()] } })
      });
      assert.equal(bad.status, 400);
    } finally {
      await gateway.close();
      db.close();
    }
  });
});
