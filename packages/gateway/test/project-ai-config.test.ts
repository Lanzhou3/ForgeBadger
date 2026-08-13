import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

interface AiConfigResponseBody {
  code: number;
  message?: string;
  data?: {
    adapter: "claude" | "opencode" | "codex" | "kimi";
    projectRoot: string;
    files: Array<{
      relativePath: string;
      scope: "project" | "global";
      role: string;
      fileType: string;
      exists: boolean;
      editable: boolean;
      content: string;
      sizeBytes: number;
    }>;
    forms: Array<{
      filePath: string;
      fields: Array<{ key: string; label: string; inputType: string }>;
    }>;
  };
}

interface AuthResponseBody {
  data: {
    token: string;
  };
}

interface ProjectResponseBody {
  data: {
    project: {
      id: string;
    };
  };
}

interface ScanResponseBody {
  data?: {
    path: string;
    exists: boolean;
    isDirectory: boolean;
    instructionFiles: string[];
  };
}

describe("project AI config routes", () => {
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

  it("returns project-level config files for the project's adapter", async () => {
    const token = await register("ai-config-reader@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-ai-config-read-"));
    await mkdir(path.join(rootPath, ".opencode", "agents"), { recursive: true });
    await writeFile(path.join(rootPath, "AGENTS.md"), "# Existing Agents\n", "utf8");
    await writeFile(path.join(rootPath, "opencode.json"), "{\"instructions\":[\"AGENTS.md\"]}\n", "utf8");
    await writeFile(path.join(rootPath, ".opencode", "agents", "reviewer.md"), "# Reviewer\n", "utf8");
    const canonicalRootPath = await realpath(rootPath);
    const projectId = await importProject(token, {
      name: "OpenCode Project",
      path: rootPath,
      aiTool: "opencode"
    });

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/ai-config?aiTool=opencode`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as AiConfigResponseBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.adapter, "opencode");
    assert.equal(body.data?.projectRoot, canonicalRootPath);
    assert.ok(body.data?.forms.some((form) => form.filePath === "opencode.json"));
    assert.ok(body.data?.forms.some((form) => form.fields.some((field) => field.key === "model")));
    assertFile(body, "AGENTS.md", true, "# Existing Agents\n");
    assertFile(body, "opencode.json", true, "{\"instructions\":[\"AGENTS.md\"]}\n");
    assertFile(body, ".opencode/agents/reviewer.md", true, "# Reviewer\n");
    assertFile(body, ".opencode/commands/review.md", false, "");
  });

  it("returns project-level config files for a Kimi Code project", async () => {
    const token = await register("ai-config-kimi-reader@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-ai-config-kimi-read-"));
    await mkdir(path.join(rootPath, ".kimi-code", "agents"), { recursive: true });
    await writeFile(path.join(rootPath, "AGENTS.md"), "# Existing Kimi Agents\n", "utf8");
    await writeFile(path.join(rootPath, ".kimi-code", "mcp.json"), "{}\n", "utf8");
    await writeFile(path.join(rootPath, ".kimi-code", "agents", "reviewer.md"), "# Reviewer\n", "utf8");
    const projectId = await importProject(token, {
      name: "Kimi Project",
      path: rootPath,
      aiTool: "kimi"
    });

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/ai-config?aiTool=kimi`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as AiConfigResponseBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.adapter, "kimi");
    assert.ok(body.data?.forms.some((form) => form.filePath === "AGENTS.md"));
    assertFile(body, "AGENTS.md", true, "# Existing Kimi Agents\n");
    assertFile(body, ".kimi-code/mcp.json", true, "{}\n");
    assertFile(body, ".kimi-code/agents/reviewer.md", true, "# Reviewer\n");
  });

  it("reports existing root instruction files when scanning an import directory", async () => {
    const token = await register("scan-existing-config@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-scan-config-"));
    await writeFile(path.join(rootPath, "CLAUDE.md"), "# Existing Claude\n", "utf8");
    await writeFile(path.join(rootPath, "AGENTS.md"), "# Existing Agents\n", "utf8");
    const canonicalRootPath = await realpath(rootPath);

    const res = await fetch(`${baseUrl}/api/v1/projects/scan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: rootPath })
    });
    const body = (await res.json()) as ScanResponseBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.path, canonicalRootPath);
    assert.deepEqual(body.data?.instructionFiles, ["AGENTS.md", "CLAUDE.md"]);
  });

  it("uses root CLAUDE.md as the Claude Code project instruction file", async () => {
    const token = await register("ai-config-claude-root@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-ai-config-claude-"));
    await mkdir(path.join(rootPath, ".claude"), { recursive: true });
    await writeFile(path.join(rootPath, "CLAUDE.md"), "# Root Claude\n", "utf8");
    await writeFile(path.join(rootPath, ".claude", "CLAUDE.md"), "# Legacy Nested Claude\n", "utf8");
    await writeFile(path.join(rootPath, ".claude", "settings.json"), "{}\n", "utf8");
    const projectId = await importProject(token, {
      name: "Claude Project",
      path: rootPath,
      aiTool: "claude"
    });

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/ai-config`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as AiConfigResponseBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.adapter, "claude");
    assertFile(body, "CLAUDE.md", true, "# Root Claude\n");
    assertFile(body, ".claude/settings.json", true, "{}\n");
    assert.equal(
      body.data?.files.some((file) => file.relativePath === ".claude/CLAUDE.md"),
      false
    );
    assert.ok(body.data?.forms.some((form) => form.filePath === "CLAUDE.md"));
    assert.ok(body.data?.forms.some((form) => form.filePath === ".claude/settings.json"));
  });

  it("updates allowed project config files and rejects unsafe paths", async () => {
    const token = await register("ai-config-writer@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-ai-config-write-"));
    const projectId = await importProject(token, {
      name: "Codex Project",
      path: rootPath,
      aiTool: "codex"
    });

    const writeRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/ai-config/files`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        relativePath: "AGENTS.md",
        content: "# Updated Agents\n"
      })
    });
    const writeBody = (await writeRes.json()) as AiConfigResponseBody;
    assert.equal(writeRes.status, 200, JSON.stringify(writeBody));
    assert.equal(await readFile(path.join(rootPath, "AGENTS.md"), "utf8"), "# Updated Agents\n");
    assertFile(writeBody, "AGENTS.md", true, "# Updated Agents\n");

    const unsafeRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/ai-config/files`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        relativePath: "../AGENTS.md",
        content: "# Escape\n"
      })
    });
    const unsafeBody = (await unsafeRes.json()) as { code: number; message: string };
    assert.equal(unsafeRes.status, 400);
    assert.equal(unsafeBody.code, 1);
  });

  it("leaves the project untracked when no template is provided at import", async () => {
    const token = await register("ai-config-template-default@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-ai-config-default-"));

    const res = await fetch(`${baseUrl}/api/v1/projects/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "OpenCode Default",
        path: rootPath,
        aiTool: "opencode"
      })
    });
    const body = (await res.json()) as ProjectResponseBody & {
      data: { project: { templateId: string } };
    };

    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.data.project.templateId, null);
  });

  it("does not expose another user's project config", async () => {
    const ownerToken = await register("ai-config-owner@test.com");
    const readerToken = await register("ai-config-reader-other@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-ai-config-private-"));
    await writeFile(path.join(rootPath, "AGENTS.md"), "# Private\n", "utf8");
    const projectId = await importProject(ownerToken, {
      name: "Private Project",
      path: rootPath,
      aiTool: "codex"
    });

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/ai-config`, {
      headers: { Authorization: `Bearer ${readerToken}` }
    });
    const body = (await res.json()) as { code: number; message: string };

    assert.equal(res.status, 404);
    assert.equal(body.code, 1);
  });

  it("returns redacted read-only global config files and form metadata", async () => {
    const token = await register("ai-config-global@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-ai-config-global-project-"));
    const opencodeConfigDir = await mkdtemp(path.join(tmpdir(), "openforge-opencode-config-"));
    await writeFile(path.join(opencodeConfigDir, "AGENTS.md"), "# Personal OpenCode\n", "utf8");
    await writeFile(
      path.join(opencodeConfigDir, "opencode.json"),
      "{\n  \"model\": \"anthropic/claude-sonnet-4-5\",\n  \"apiKey\": \"sk-secret-value\"\n}\n",
      "utf8"
    );
    const projectId = await importProject(token, {
      name: "Global Config Project",
      path: rootPath,
      aiTool: "opencode"
    });
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir;

    try {
      const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/ai-config/global?aiTool=opencode`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = (await res.json()) as AiConfigResponseBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data?.adapter, "opencode");
      assertFile(body, "AGENTS.md", true, "# Personal OpenCode\n", "global");
      const configFile = assertFile(body, "opencode.json", true, undefined, "global");
      assert.equal(configFile.editable, false);
      assert.match(configFile.content, /REDACTED/);
      assert.doesNotMatch(configFile.content, /sk-secret-value/);
      assert.ok(body.data?.forms.some((form) => form.filePath === "opencode.json"));
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
    }
  });

  it("returns only ~/.claude/settings.json for Claude Code global config", async () => {
    const token = await register("ai-config-claude-global@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-ai-config-claude-global-project-"));
    const claudeConfigDir = await mkdtemp(path.join(tmpdir(), "openforge-claude-config-"));
    await writeFile(path.join(claudeConfigDir, "CLAUDE.md"), "# Personal Claude\n", "utf8");
    await writeFile(path.join(claudeConfigDir, "settings.local.json"), "{}\n", "utf8");
    await writeFile(
      path.join(claudeConfigDir, "settings.json"),
      "{\n  \"permissions\": { \"allow\": [\"Read\"], \"apiKey\": \"sk-secret-value\" }\n}\n",
      "utf8"
    );
    const projectId = await importProject(token, {
      name: "Claude Global Config Project",
      path: rootPath,
      aiTool: "claude"
    });
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

    try {
      const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/ai-config/global`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = (await res.json()) as AiConfigResponseBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data?.adapter, "claude");
      assert.deepEqual(body.data?.files.map((file) => file.relativePath), ["settings.json"]);
      const settings = assertFile(body, "settings.json", true, undefined, "global");
      assert.equal(settings.editable, false);
      assert.match(settings.content, /REDACTED/);
      assert.doesNotMatch(settings.content, /sk-secret-value/);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
    }
  });

  it("returns redacted read-only Kimi Code global config from KIMI_CODE_HOME", async () => {
    const token = await register("ai-config-kimi-global@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-ai-config-kimi-global-project-"));
    const kimiHome = await mkdtemp(path.join(tmpdir(), "openforge-kimi-home-"));
    await writeFile(path.join(kimiHome, "AGENTS.md"), "# Personal Kimi\n", "utf8");
    await writeFile(
      path.join(kimiHome, "config.toml"),
      "default_model = \"kimi-code/kimi-k2.5\"\napi_key = \"sk-secret-value\"\n",
      "utf8"
    );
    const projectId = await importProject(token, {
      name: "Kimi Global Config Project",
      path: rootPath,
      aiTool: "kimi"
    });
    const previousKimiHome = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;

    try {
      const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/ai-config/global?aiTool=kimi`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = (await res.json()) as AiConfigResponseBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data?.adapter, "kimi");
      assertFile(body, "AGENTS.md", true, "# Personal Kimi\n", "global");
      const configFile = assertFile(body, "config.toml", true, undefined, "global");
      assert.equal(configFile.editable, false);
      assert.match(configFile.content, /REDACTED/);
      assert.doesNotMatch(configFile.content, /sk-secret-value/);
    } finally {
      if (previousKimiHome === undefined) {
        delete process.env.KIMI_CODE_HOME;
      } else {
        process.env.KIMI_CODE_HOME = previousKimiHome;
      }
    }
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

  async function importProject(
    token: string,
    input: { name: string; path: string; aiTool: "claude" | "opencode" | "codex" | "kimi" }
  ): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    const body = (await res.json()) as ProjectResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.project.id;
  }

  function assertFile(
    body: AiConfigResponseBody,
    relativePath: string,
    exists: boolean,
    content?: string,
    scope: "project" | "global" = "project"
  ): NonNullable<AiConfigResponseBody["data"]>["files"][number] {
    const file = body.data?.files.find((candidate) => candidate.relativePath === relativePath);
    assert.ok(file, `Expected ${relativePath} in response`);
    assert.equal(file.scope, scope);
    assert.equal(file.exists, exists);
    if (content !== undefined) {
      assert.equal(file.content, content);
    }
    assert.equal(file.editable, scope === "project");
    return file;
  }
});
