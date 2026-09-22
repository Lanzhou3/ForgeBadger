import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";

import { createAuthRouter } from "../src/routes/auth.js";
import { createCatalogRoutes } from "../src/routes/catalog.js";
import { createSkillRoutes } from "../src/routes/skills.js";
import { CatalogRepository } from "../src/db/repositories/catalog-repository.js";
import { UserRepository } from "../src/db/repositories/index.js";
import type { GitHubFetchResponse } from "../src/services/github-skill-source.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

function allowTestResolver() {
  return async () => [{ address: "8.8.8.8", family: 4 }];
}

function jsonResponse(value: unknown, status = 200): GitHubFetchResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer as ArrayBuffer
  };
}

function textResponse(body: string, status = 200): GitHubFetchResponse {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer as ArrayBuffer
  };
}

const state = {
  helloSha: "sha1-hello",
  renameSha: "sha1-rename"
};

function skillContent(name: string, version: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\nversion: ${version}\n---\n\n# ${body}\n`;
}

const remoteFiles: Record<string, string> = {
  "octo/hello/sha1-hello/skills/pdf/SKILL.md": skillContent("pdf", "1.0.0", "PDF v1"),
  "octo/hello/sha2-hello/skills/pdf/SKILL.md": skillContent("pdf", "2.0.0", "PDF v2"),
  "octo/hello/sha1-hello/skills/xlsx/SKILL.md": skillContent("xlsx", "1.0.0", "XLSX v1"),
  "octo/rename/sha1-rename/skills/doc/SKILL.md": skillContent("doc", "1.0.0", "Doc v1"),
  "octo/rename/sha2-rename/skills/doc/SKILL.md": skillContent("doc-renamed", "1.0.0", "Doc v2")
};

const fetcher = async (url: string): Promise<GitHubFetchResponse> => {
  const parsed = new URL(url);
  if (parsed.hostname === "api.github.com") {
    if (parsed.pathname.includes("/git/trees/")) {
      return jsonResponse({
        tree: [{ path: "skills/pdf/SKILL.md", type: "blob" }],
        truncated: false
      });
    }
    const match = /^\/repos\/([^/]+)\/([^/]+)(?:\/commits\/([^/]+))?$/.exec(parsed.pathname);
    const owner = match?.[1];
    const repo = match?.[2];
    const commitRef = match?.[3];
    if (!owner || !repo) return jsonResponse({}, 404);
    if (!commitRef) {
      return jsonResponse({ default_branch: "main" });
    }
    const sha = owner === "octo" && repo === "hello" ? state.helloSha : state.renameSha;
    return jsonResponse({ sha });
  }
  if (parsed.hostname === "raw.githubusercontent.com") {
    const key = parsed.pathname.replace(/^\//u, "");
    const body = remoteFiles[key];
    return body ? textResponse(body) : jsonResponse({}, 404);
  }
  return jsonResponse({}, 404);
};

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

interface ApiBody {
  code: number;
  message?: string;
  data?: {
    sha?: string;
    ref?: string;
    repo?: string;
    skills?: Array<{ path: string; name: string }>;
    skill?: {
      id: string;
      name: string;
      source: string;
      isEnabled: boolean;
      version?: string;
      content?: string;
      remoteProvenance?: string | null;
    };
    provenance?: {
      kind: string;
      repo: string;
      resolvedCommitSha: string;
      lastCheck?: { updateAvailable: boolean; latestCommitSha: string };
    };
    installedToAgentsHome?: boolean;
    check?: {
      updateAvailable: boolean;
      currentSha: string;
      latestSha: string;
    };
    results?: Array<{ skillId: string; name: string; updateAvailable: boolean }>;
  };
}

let server: ReturnType<express.Express["listen"]>;
let baseUrl: string;
let db: Database;
let agentsHome: string;
let ownerToken = "";

describe("remote skill install API", () => {
  before(async () => {
    db = createTestDb();
    agentsHome = mkdtempSync(path.join(tmpdir(), "forgebadger-remote-api-"));
    process.env.AGENTS_HOME = agentsHome;

    const app = express();
    app.use(express.json());
    app.locals.jwtSecret = jwtSecret;
    app.use("/api/v1/auth", createAuthRouter(new UserRepository(db), jwtSecret));
    app.use("/api/v1/catalog", createCatalogRoutes(db, { fetcher, resolveHost: allowTestResolver() }));
    app.use("/api/v1", createSkillRoutes(db, { fetcher, resolveHost: allowTestResolver() }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string") {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });

    ownerToken = await register("remote-install-owner@example.com");
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    db.close();
    rmSync(agentsHome, { recursive: true, force: true });
    delete process.env.AGENTS_HOME;
  });

  it("previews a GitHub repo and lists discovered skills pinned to a sha", async () => {
    const res = await fetch(`${baseUrl}/api/v1/skills/install/github/preview`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ repo: "octo/hello", ref: "main" })
    });
    const body = (await res.json()) as ApiBody;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.sha, "sha1-hello");
    assert.deepEqual(
      body.data?.skills?.map((skill) => skill.path),
      ["skills/pdf/SKILL.md"]
    );
  });

  it("installs a GitHub skill disabled by default with provenance and FS mirror", async () => {
    const res = await fetch(`${baseUrl}/api/v1/skills/install/github`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ repo: "octo/hello", path: "skills/pdf/SKILL.md" })
    });
    const body = (await res.json()) as ApiBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    const skill = body.data?.skill;
    assert.ok(skill);
    assert.equal(skill.name, "pdf");
    assert.equal(skill.source, "github:octo/hello");
    assert.equal(skill.isEnabled, false);
    assert.equal(body.data?.installedToAgentsHome, true);
    assert.equal(body.data?.provenance?.resolvedCommitSha, "sha1-hello");

    const provenance = JSON.parse(skill.remoteProvenance ?? "null") as { kind: string; repo: string; path: string };
    assert.equal(provenance.kind, "github");
    assert.equal(provenance.repo, "octo/hello");
    assert.equal(provenance.path, "skills/pdf/SKILL.md");

    const mirror = path.join(agentsHome, "skills", "pdf", "SKILL.md");
    assert.ok(existsSync(mirror));
    assert.match(readFileSync(mirror, "utf8"), /PDF v1/);
    assert.ok(existsSync(path.join(agentsHome, "skills", "pdf", ".forgebadger-managed.json")));
  });

  it("returns 409 when the skill name already exists", async () => {
    const res = await fetch(`${baseUrl}/api/v1/skills/install/github`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ repo: "octo/hello", path: "skills/pdf/SKILL.md" })
    });
    const body = (await res.json()) as ApiBody;
    assert.equal(res.status, 409);
    assert.equal(body.code, 1);
  });

  it("checks for updates and persists lastCheck on the skill", async () => {
    const skillsRes = await fetch(`${baseUrl}/api/v1/skills`, { headers: jsonHeaders(ownerToken) });
    const skillsBody = (await skillsRes.json()) as {
      data: { skills: Array<{ id: string; name: string }> };
    };
    const pdf = skillsBody.data.skills.find((skill) => skill.name === "pdf");
    assert.ok(pdf);

    const sameRes = await fetch(`${baseUrl}/api/v1/skills/${pdf.id}/check-update`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({})
    });
    const sameBody = (await sameRes.json()) as ApiBody;
    assert.equal(sameRes.status, 200, JSON.stringify(sameBody));
    assert.equal(sameBody.data?.updateAvailable, false);
    assert.equal(sameBody.data?.currentSha, "sha1-hello");
    assert.equal(sameBody.data?.latestSha, "sha1-hello");

    state.helloSha = "sha2-hello";
    const newRes = await fetch(`${baseUrl}/api/v1/skills/${pdf.id}/check-update`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({})
    });
    const newBody = (await newRes.json()) as ApiBody;
    assert.equal(newBody.data?.updateAvailable, true);
    assert.equal(newBody.data?.latestSha, "sha2-hello");

    const afterRes = await fetch(`${baseUrl}/api/v1/skills/${pdf.id}`, { headers: jsonHeaders(ownerToken) });
    const afterBody = (await afterRes.json()) as ApiBody;
    const lastCheck = JSON.parse(afterBody.data?.skill?.remoteProvenance ?? "null") as {
      lastCheck?: { updateAvailable: boolean; latestCommitSha: string };
    } | null;
    assert.equal(lastCheck?.lastCheck?.updateAvailable, true);
    assert.equal(lastCheck?.lastCheck?.latestCommitSha, "sha2-hello");
  });

  it("rejects update checks for non-remote skills", async () => {
    const createRes = await fetch(`${baseUrl}/api/v1/skills`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ name: "manual-skill", content: "# Manual\n" })
    });
    const created = (await createRes.json()) as ApiBody;
    const res = await fetch(`${baseUrl}/api/v1/skills/${created.data?.skill?.id}/check-update`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({})
    });
    const body = (await res.json()) as ApiBody;
    assert.equal(res.status, 400);
    assert.match(body.message ?? "", /not a remote Skill/);
  });

  it("updates a remote skill to the latest sha and refreshes the FS mirror", async () => {
    const skillsRes = await fetch(`${baseUrl}/api/v1/skills`, { headers: jsonHeaders(ownerToken) });
    const skillsBody = (await skillsRes.json()) as {
      data: { skills: Array<{ id: string; name: string }> };
    };
    const pdf = skillsBody.data.skills.find((skill) => skill.name === "pdf");
    assert.ok(pdf);

    const res = await fetch(`${baseUrl}/api/v1/skills/${pdf.id}/update`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({})
    });
    const body = (await res.json()) as ApiBody;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.skill?.version, "2.0.0");
    assert.equal(body.data?.provenance?.resolvedCommitSha, "sha2-hello");
    assert.match(body.data?.skill?.content ?? "", /PDF v2/);
    assert.match(
      readFileSync(path.join(agentsHome, "skills", "pdf", "SKILL.md"), "utf8"),
      /PDF v2/
    );
  });

  it("refuses updates when the remote skill was renamed", async () => {
    const installRes = await fetch(`${baseUrl}/api/v1/skills/install/github`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ repo: "octo/rename", path: "skills/doc/SKILL.md" })
    });
    const installed = (await installRes.json()) as ApiBody;
    assert.equal(installRes.status, 201, JSON.stringify(installed));

    state.renameSha = "sha2-rename";
    const res = await fetch(`${baseUrl}/api/v1/skills/${installed.data?.skill?.id}/update`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({})
    });
    const body = (await res.json()) as ApiBody;
    assert.equal(res.status, 400);
    assert.match(body.message ?? "", /renamed/);
    state.renameSha = "sha1-rename";
  });

  it("checks all remote skills in one batch", async () => {
    const res = await fetch(`${baseUrl}/api/v1/skills/check-updates`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({})
    });
    const body = (await res.json()) as ApiBody;
    assert.equal(res.status, 200, JSON.stringify(body));
    const results = body.data?.results ?? [];
    assert.equal(results.length, 2);
    assert.ok(results.every((entry) => typeof entry.updateAvailable === "boolean"));
  });

  it("removes the managed FS mirror when deleting a remote skill", async () => {
    const skillsRes = await fetch(`${baseUrl}/api/v1/skills`, { headers: jsonHeaders(ownerToken) });
    const skillsBody = (await skillsRes.json()) as {
      data: { skills: Array<{ id: string; name: string }> };
    };
    const doc = skillsBody.data.skills.find((skill) => skill.name === "doc");
    assert.ok(doc);
    assert.ok(existsSync(path.join(agentsHome, "skills", "doc")));

    const res = await fetch(`${baseUrl}/api/v1/skills/${doc.id}`, {
      method: "DELETE",
      headers: jsonHeaders(ownerToken)
    });
    assert.equal(res.status, 200);
    assert.equal(existsSync(path.join(agentsHome, "skills", "doc")), false);
  });

  it("keeps user-owned directories without a marker on delete", async () => {
    const createRes = await fetch(`${baseUrl}/api/v1/skills`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ name: "user-dir-skill", content: "# User\n" })
    });
    const created = (await createRes.json()) as ApiBody;
    const userDir = path.join(agentsHome, "skills", "user-dir-skill");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(path.join(userDir, "SKILL.md"), "# user content\n");

    const res = await fetch(`${baseUrl}/api/v1/skills/${created.data?.skill?.id}`, {
      method: "DELETE",
      headers: jsonHeaders(ownerToken)
    });
    assert.equal(res.status, 200);
    assert.match(readFileSync(path.join(userDir, "SKILL.md"), "utf8"), /user content/);
    rmSync(userDir, { recursive: true, force: true });
  });

  it("installs marketplace catalog items by fetching from the pinned repo", async () => {
    const userId = new UserRepository(db).findByEmail("remote-install-owner@example.com")?.id;
    assert.ok(userId);
    const catalogRepo = new CatalogRepository(db, userId);
    const [item] = catalogRepo.replaceItems("demo-marketplace", [
      {
        sourceId: "demo-marketplace",
        itemType: "skill",
        externalId: "xlsx",
        name: "xlsx",
        metadata: {
          marketplace: {
            repo: "octo/hello",
            sha: "sha1-hello",
            pluginName: "xlsx",
            skillPath: "skills/xlsx"
          }
        }
      }
    ]);

    const res = await fetch(`${baseUrl}/api/v1/catalog/items/${item?.id}/install`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({})
    });
    const body = (await res.json()) as ApiBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.data?.skill?.source, "catalog:demo-marketplace");
    assert.equal(body.data?.skill?.name, "xlsx");
    const provenance = JSON.parse(body.data?.skill?.remoteProvenance ?? "null") as {
      kind: string;
      marketplaceSourceId?: string;
      pluginName?: string;
      resolvedCommitSha: string;
    } | null;
    assert.equal(provenance?.kind, "marketplace");
    assert.equal(provenance?.marketplaceSourceId, "demo-marketplace");
    assert.equal(provenance?.pluginName, "xlsx");
    assert.equal(provenance?.resolvedCommitSha, "sha1-hello");
    assert.ok(existsSync(path.join(agentsHome, "skills", "xlsx", "SKILL.md")));
  });
});

async function register(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" })
  });
  const body = (await res.json()) as { data: { token: string } };
  return body.data.token;
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}
