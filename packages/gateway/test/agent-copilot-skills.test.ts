import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { SkillRepository } from "../src/db/repositories/skill-repository.js";
import {
  BUILTIN_COPILOT_SKILLS,
  getCopilotSkill,
  listCopilotSkillSummaries
} from "../src/services/agent/skills/copilot-skills.js";
import { listEnabledCopilotSkillSummaries } from "../src/services/agent/skills/skill-queries.js";
import { createSkillTools } from "../src/services/agent/tools/skills.js";
import { stripFrontmatter } from "../src/services/skill-frontmatter.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function seededContext(): { db: Database.Database; userId: string; context: AgentToolContext } {
  const db = createTestDb();
  const user = new UserRepository(db).create("skill-seed@example.com", "hash");
  const userId = user.id;
  // Seed the builtin playbooks the same way the Skills routes do.
  for (const skill of BUILTIN_COPILOT_SKILLS) {
    new SkillRepository(db, userId).createIfMissing({
      name: skill.name,
      description: skill.description,
      source: "builtin",
      content: skill.body,
      version: "1.0.0",
      visibility: "private",
      isEnabled: true
    });
  }
  const context: AgentToolContext = {
    userId,
    db,
    masterKey: "abcdef0123456789abcdef0123456789"
  };
  return { db, userId, context };
}

describe("copilot skills registry", () => {
  it("ships the builtin engineering playbooks with unique names and bodies", () => {
    const names = BUILTIN_COPILOT_SKILLS.map((skill) => skill.name);
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes("autonomous-work-item-loop"));
    assert.ok(names.includes("safety-and-approvals"));
    for (const skill of BUILTIN_COPILOT_SKILLS) {
      assert.ok(skill.description.length > 10, `${skill.name} needs a summary`);
      assert.ok(skill.body.length > 200, `${skill.name} body too thin`);
    }
  });

  it("tier-1 summaries never leak full bodies", () => {
    for (const summary of listCopilotSkillSummaries()) {
      const skill = getCopilotSkill(summary.name);
      assert.ok(skill);
      assert.ok(summary.description.length < skill!.body.length / 4);
    }
  });
});

describe("skill queries", () => {
  it("lists enabled builtin summaries from the platform store", () => {
    const { db, userId } = seededContext();
    try {
      const summaries = listEnabledCopilotSkillSummaries(db, userId);
      const names = summaries.map((s) => s.name);
      // Every Copilot playbook is seeded; the two legacy builtins also appear.
      for (const skill of BUILTIN_COPILOT_SKILLS) {
        assert.ok(names.includes(skill.name), `expected ${skill.name}`);
      }
    } finally {
      db.close();
    }
  });

  it("excludes disabled skills but keeps the builtin seeds", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("skill-disabled@example.com", "hash");
    const repo = new SkillRepository(db, user.id);
    repo.create({ name: "kept", description: "kept skill", content: "# kept", source: "local", isEnabled: true });
    repo.create({ name: "hidden", description: "hidden skill", content: "# hidden", source: "local", isEnabled: false });
    try {
      const summaries = listEnabledCopilotSkillSummaries(db, user.id);
      const names = summaries.map((s) => s.name);
      assert.ok(names.includes("kept"));
      assert.ok(!names.includes("hidden"));
    } finally {
      db.close();
    }
  });
});

describe("frontmatter", () => {
  it("strips a leading YAML frontmatter block", () => {
    const content = ["---", "name: review", "description: review skill", "---", "", "# Review", "body text"].join("\n");
    assert.equal(stripFrontmatter(content), "\n# Review\nbody text");
  });

  it("leaves plain body text unchanged", () => {
    const content = "# Session Dispatch\n\nsome body";
    assert.equal(stripFrontmatter(content), content);
  });
});

describe("skill tools", () => {
  it("exposes exactly two read tools", () => {
    const tools = createSkillTools();
    assert.deepEqual(
      tools.map((tool) => [tool.name, tool.risk, tool.requiresApproval]),
      [
        ["list_skills", "read", false],
        ["load_skill", "read", false]
      ]
    );
  });

  it("lists tier-1 metadata from the platform store", async () => {
    const { db, context } = seededContext();
    try {
      const [listTool] = createSkillTools();
      const result = (await listTool.execute({}, context)) as {
        count: number;
        skills: Array<{ name: string; description: string }>;
      };
      assert.equal(result.count, listEnabledCopilotSkillSummaries(db, context.userId as string).length);
      assert.equal(typeof result.skills[0]?.description, "string");
    } finally {
      db.close();
    }
  });

  it("loads a full playbook and reports unknown names as not-found", async () => {
    const { db, context } = seededContext();
    try {
      const [, loadTool] = createSkillTools();

      const hit = (await loadTool.execute({ name: "autonomous-work-item-loop" }, context)) as {
        found: boolean;
        body: string;
      };
      assert.equal(hit.found, true);
      assert.match(hit.body, /pm_start_task_packet/u);

      const miss = (await loadTool.execute({ name: "no-such-skill" }, context)) as { found: boolean };
      assert.equal(miss.found, false);
    } finally {
      db.close();
    }
  });

  it("rejects malformed input", async () => {
    const { db, context } = seededContext();
    try {
      const [, loadTool] = createSkillTools();
      await assert.rejects(() => loadTool.execute({}, context));
    } finally {
      db.close();
    }
  });
});
