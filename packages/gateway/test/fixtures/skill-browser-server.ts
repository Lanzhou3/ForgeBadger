// Isolated rendered smoke harness: real Gateway routes, SQLite and HTTP; no CLI processes.
// `node --test` discovers every file under test/: this harness starts a
// listening Gateway, so exit quietly when loaded by the test runner.
if (process.env.NODE_TEST_CONTEXT) process.exit(0);
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { skillFixture } from "./skill-registry.js";
import { createGatewayApp } from "../../src/server.js";
import { InMemorySessionManager } from "../../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../../src/secrets/api-key-store.js";
import { signJwt } from "../../src/auth/jwt.js";
import { CatalogRepository } from "../../src/db/repositories/catalog-repository.js";
import { ProjectRepository } from "../../src/db/repositories/project-repository.js";
const state = mkdtempSync(path.join(tmpdir(), "fb-skill-browser-"));
process.env.AGENTS_HOME = path.join(state, "agents");
process.env.FORGEBADGER_STATE_DIR = state;
process.env.FORGEBADGER_MASTER_KEY = "abcdef0123456789abcdef0123456789";
process.env.FORGEBADGER_JWT_SECRET = "0123456789abcdef0123456789abcdef";
const f = skillFixture();
const sources = new CatalogRepository(f.db, f.owner.id);
for (const repo of [
  "anthropics/skills",
  "openai/skills",
  "vercel-labs/agent-skills",
]) {
  sources.upsertSource({
    sourceId: `github:${repo}`,
    type: "skill",
    label: repo,
    url: `https://github.com/${repo}`,
  });
  sources.setSourceStatus(`github:${repo}`, "disabled");
}
// Index one real public Skill without spending a full public-GitHub crawl on each UI run.
sources.upsertSource({
  sourceId: "github:anthropics/skills",
  type: "skill",
  label: "anthropics/skills",
  url: "https://github.com/anthropics/skills",
});
sources.replaceItems(
  "github:anthropics/skills",
  [
    {
      sourceId: "github:anthropics/skills",
      itemType: "skill",
      externalId: "anthropics/skills/template/SKILL.md",
      name: "template-skill",
      description: "A template for authoring a Skill",
      metadata: {
        marketplace: {
          repo: "anthropics/skills",
          ref: "main",
          skillPath: "template/SKILL.md",
        },
      },
    },
  ],
  "skill",
);
const projectRoot = path.join(state, "project");
mkdirSync(projectRoot);
const project = new ProjectRepository(f.db, f.owner.id).create({
  name: "Skill smoke project",
  path: projectRoot,
  aiTool: "claude",
});
const backend = {
  async createSession() {},
  async killSession() {},
  async capturePane() {
    return "";
  },
  async listSessions() {
    return [];
  },
};
const gateway = createGatewayApp({
  sessionServerIpcPath: path.join(state, "session.sock"),
  jwtSecret: process.env.FORGEBADGER_JWT_SECRET,
  masterKey: process.env.FORGEBADGER_MASTER_KEY,
  db: f.db,
  sessionManager: new InMemorySessionManager(backend as never),
  apiKeyStore: new InMemoryApiKeyStore({
    masterKey: process.env.FORGEBADGER_MASTER_KEY,
  }),
});
writeFileSync(
  "/tmp/forgebadger-skill-browser-auth.json",
  JSON.stringify({
    token: signJwt(
      { userId: f.owner.id, email: f.owner.email },
      process.env.FORGEBADGER_JWT_SECRET,
    ),
    user: { id: f.owner.id, email: f.owner.email, role: f.owner.role },
    projectId: project.id,
    state,
  }),
  { mode: 0o600 },
);
gateway.server.listen(49731, "127.0.0.1", () =>
  console.log("Isolated Skill browser Gateway ready on 49731"),
);
