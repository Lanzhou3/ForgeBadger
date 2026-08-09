import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { SkillRepository } from "../src/db/repositories/skill-repository.js";
import { defaultLocalSkillRoots, discoverLocalSkills, syncLocalSkills } from "../src/services/local-skills.js";

function createTestDb(): Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("local skill discovery", () => {
  it("discovers folder-based SKILL.md files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-local-skills-"));
    const projectSkills = path.join(root, ".claude", "skills");
    const userSkills = path.join(root, "user-skills");
    await mkdir(path.join(projectSkills, "plan-workflow"), { recursive: true });
    await mkdir(path.join(userSkills, "reviewer"), { recursive: true });
    await writeFile(
      path.join(projectSkills, "plan-workflow", "SKILL.md"),
      [
        "---",
        "name: plan-workflow",
        "description: Use this when planning work.",
        "---",
        "",
        "# Plan Workflow"
      ].join("\n")
    );
    await writeFile(
      path.join(userSkills, "reviewer", "SKILL.md"),
      [
        "---",
        "name: code-reviewer",
        "description: Review code with file and line evidence.",
        "version: 2.0.0",
        "---",
        "",
        "# Code Reviewer",
        "",
        "Review code changes."
      ].join("\n")
    );

    const skills = discoverLocalSkills({ roots: [projectSkills, userSkills] });
    const canonicalProjectSkills = await realpath(projectSkills);

    assert.equal(skills.length, 2);
    assert.deepEqual(skills.map((skill) => skill.name).sort(), ["code-reviewer", "plan-workflow"]);
    assert.equal(skills.find((skill) => skill.name === "plan-workflow")?.root, canonicalProjectSkills);
    assert.equal(skills.find((skill) => skill.name === "code-reviewer")?.path.endsWith("SKILL.md"), true);
    assert.equal(skills.find((skill) => skill.name === "code-reviewer")?.version, "2.0.0");
    assert.equal(
      skills.find((skill) => skill.name === "code-reviewer")?.description,
      "Review code with file and line evidence."
    );
  });

  it("discovers plugin-provided skills from nested Codex plugin cache layouts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-plugin-skills-"));
    const pluginSkillDir = path.join(
      root,
      "openai-curated",
      "github",
      "3c463363",
      "skills",
      "gh-fix-ci"
    );
    await mkdir(pluginSkillDir, { recursive: true });
    await writeFile(
      path.join(pluginSkillDir, "SKILL.md"),
      [
        "---",
        "name: github:gh-fix-ci",
        "description: Fix GitHub Actions failures.",
        "---",
        "",
        "# Fix CI"
      ].join("\n")
    );

    const skills = discoverLocalSkills({ roots: [root] });

    assert.ok(skills.some((skill) => skill.name === "github-gh-fix-ci"));
  });

  it("does not let an early large root hide Skills from later local roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-large-skill-roots-"));
    const largeRoot = path.join(root, "large-skills");
    const laterRoot = path.join(root, "later-skills");
    await mkdir(largeRoot, { recursive: true });
    await mkdir(path.join(laterRoot, "later-review"), { recursive: true });

    for (let index = 0; index < 230; index += 1) {
      const skillDir = path.join(largeRoot, `bulk-${index}`);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          `name: bulk-${index}`,
          `description: Bulk Skill ${index}.`,
          "---",
          "",
          `# Bulk ${index}`
        ].join("\n")
      );
    }
    await writeFile(
      path.join(laterRoot, "later-review", "SKILL.md"),
      [
        "---",
        "name: later-review",
        "description: Later root Skill.",
        "---",
        "",
        "# Later Review"
      ].join("\n")
    );

    const skills = discoverLocalSkills({ roots: [largeRoot, laterRoot] });

    assert.ok(skills.length > 200);
    assert.ok(skills.some((skill) => skill.name === "later-review"));
  });

  it("uses only root Claude Code and Agents skill directories as the default discovery roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-ancestor-skills-"));
    const nestedCwd = path.join(root, "packages", "gateway");
    const projectSkillDir = path.join(root, ".claude", "skills", "verify-workflow");
    const agentSkillDir = path.join(root, ".agents", "skills", "agent-workflow");
    const opencodeSkillDir = path.join(root, ".opencode", "skills", "opencode-workflow");
    await mkdir(nestedCwd, { recursive: true });
    await mkdir(projectSkillDir, { recursive: true });
    await mkdir(agentSkillDir, { recursive: true });
    await mkdir(opencodeSkillDir, { recursive: true });
    await writeFile(
      path.join(projectSkillDir, "SKILL.md"),
      [
        "---",
        "name: verify-workflow",
        "description: Verify work before completion.",
        "---",
        "",
        "# Verify Workflow"
      ].join("\n")
    );
    await writeFile(
      path.join(agentSkillDir, "SKILL.md"),
      [
        "---",
        "name: agent-workflow",
        "description: Agent-compatible workflow.",
        "---",
        "",
        "# Agent Workflow"
      ].join("\n")
    );
    await writeFile(
      path.join(opencodeSkillDir, "SKILL.md"),
      [
        "---",
        "name: opencode-workflow",
        "description: OpenCode workflow.",
        "---",
        "",
        "# OpenCode Workflow"
      ].join("\n")
    );

    const roots = defaultLocalSkillRoots(nestedCwd, {});
    const skills = discoverLocalSkills({ cwd: nestedCwd, env: {}, maxFiles: 20 });

    assert.deepEqual(roots, [
      path.join(homedir(), ".claude", "skills"),
      path.join(homedir(), ".agents", "skills")
    ]);
    assert.equal(skills.some((skill) => skill.name === "verify-workflow"), false);
    assert.equal(skills.some((skill) => skill.name === "agent-workflow"), false);
    assert.equal(skills.some((skill) => skill.name === "opencode-workflow"), false);
  });

  it("does not include command or plugin cache directories in default discovery roots", () => {
    const roots = defaultLocalSkillRoots("/tmp/openforge-project", {});

    assert.ok(!roots.includes(path.join(homedir(), ".claude", "commands")));
    assert.ok(!roots.includes(path.join(homedir(), ".claude", "plugins", "cache")));
    assert.ok(!roots.includes(path.join(homedir(), ".claude", "plugins", "marketplaces")));
    assert.ok(!roots.includes(path.join(homedir(), ".codex", "skills")));
    assert.ok(!roots.includes(path.join(homedir(), ".codex", "plugins", "cache")));
  });

  it("ignores custom skill directory environment variables for default discovery", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-config-skills-"));
    const configDir = path.join(root, "custom-claude");
    const agentsHome = path.join(root, "agents-home");
    const configuredDir = path.join(root, "configured-skills");
    const userSkillDir = path.join(configDir, "skills", "custom-review");
    const agentSkillDir = path.join(agentsHome, "skills", "agent-review");
    const configuredSkillDir = path.join(configuredDir, "configured-review");
    await mkdir(userSkillDir, { recursive: true });
    await mkdir(agentSkillDir, { recursive: true });
    await mkdir(configuredSkillDir, { recursive: true });
    await writeFile(
      path.join(userSkillDir, "SKILL.md"),
      [
        "---",
        "name: custom-review",
        "description: Review with a custom Claude config dir.",
        "---",
        "",
        "# Custom Review"
      ].join("\n")
    );
    await writeFile(
      path.join(agentSkillDir, "SKILL.md"),
      [
        "---",
        "name: agent-review",
        "description: Review from AGENTS_HOME.",
        "---",
        "",
        "# Agent Review"
      ].join("\n")
    );
    await writeFile(
      path.join(configuredSkillDir, "SKILL.md"),
      [
        "---",
        "name: configured-review",
        "description: Review from OPENFORGE_SKILL_DIRS.",
        "---",
        "",
        "# Configured Review"
      ].join("\n")
    );

    const roots = defaultLocalSkillRoots(path.join(root, "project"), {
      CLAUDE_CONFIG_DIR: configDir,
      OPENFORGE_SKILL_DIRS: configuredDir,
      AGENTS_HOME: agentsHome
    });
    const skills = discoverLocalSkills({
      cwd: path.join(root, "project"),
      env: {
        CLAUDE_CONFIG_DIR: configDir,
        OPENFORGE_SKILL_DIRS: configuredDir,
        AGENTS_HOME: agentsHome
      }
    });

    assert.deepEqual(roots, [
      path.join(homedir(), ".claude", "skills"),
      path.join(homedir(), ".agents", "skills")
    ]);
    assert.equal(skills.some((skill) => skill.name === "custom-review"), false);
    assert.equal(skills.some((skill) => skill.name === "agent-review"), false);
    assert.equal(skills.some((skill) => skill.name === "configured-review"), false);
  });

  it("follows symlinked local Skill directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-symlink-skills-"));
    const realSkillDir = path.join(root, "real-skills", "linked-review");
    const skillRoot = path.join(root, ".claude", "skills");
    await mkdir(realSkillDir, { recursive: true });
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      path.join(realSkillDir, "SKILL.md"),
      [
        "---",
        "name: linked-review",
        "description: Review from a symlinked Skill directory.",
        "---",
        "",
        "# Linked Review"
      ].join("\n")
    );
    await symlink(realSkillDir, path.join(skillRoot, "linked-review"), "dir");

    const skills = discoverLocalSkills({ roots: [skillRoot] });

    assert.ok(skills.some((skill) => skill.name === "linked-review"));
  });

  it("syncs discovered local Skills into the current user's library and refreshes changed content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-sync-local-skills-"));
    const skillRoot = path.join(root, "skills", "safe-review");
    await mkdir(skillRoot, { recursive: true });
    const skillPath = path.join(skillRoot, "SKILL.md");
    await writeFile(
      skillPath,
      [
        "---",
        "name: safe-review",
        "description: Initial local review skill.",
        "---",
        "",
        "# Safe Review"
      ].join("\n")
    );
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("local-sync@example.com", "hash");
      const repo = new SkillRepository(db, user.id);

      const first = syncLocalSkills(repo, { roots: [path.join(root, "skills")] });
      const canonicalSkillRoot = await realpath(path.join(root, "skills"));

      assert.equal(first.discoveredCount, 1);
      assert.equal(first.createdCount, 1);
      assert.deepEqual(first.discoveredRoots, [canonicalSkillRoot]);
      assert.equal(repo.list()[0]?.description, "Initial local review skill.");

      await writeFile(
        skillPath,
        [
          "---",
          "name: safe-review",
          "description: Updated local review skill.",
          "version: 2.0.0",
          "---",
          "",
          "# Updated Safe Review"
        ].join("\n")
      );

      const second = syncLocalSkills(repo, { roots: [path.join(root, "skills")] });

      assert.equal(second.updatedCount, 1);
      const skill = repo.list()[0];
      assert.equal(skill?.description, "Updated local review skill.");
      assert.equal(skill?.version, "2.0.0");
      assert.equal(skill?.content.includes("Updated Safe Review"), true);
    } finally {
      db.close();
    }
  });

  it("does not delete local Skills that are no longer discovered under the current roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-prune-local-skills-"));
    const currentSkillRoot = path.join(root, "skills", "safe-review");
    await mkdir(currentSkillRoot, { recursive: true });
    await writeFile(
      path.join(currentSkillRoot, "SKILL.md"),
      [
        "---",
        "name: safe-review",
        "description: Current local review skill.",
        "---",
        "",
        "# Safe Review"
      ].join("\n")
    );
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("local-prune@example.com", "hash");
      const repo = new SkillRepository(db, user.id);
      repo.create({
        name: "openclaw-stale",
        description: "Old OpenClaw Skill that should not remain listed.",
        source: "local",
        content: [
          "---",
          "name: openclaw-stale",
          "description: Old OpenClaw Skill that should not remain listed.",
          "---",
          "",
          "# OpenClaw Stale"
        ].join("\n")
      });
      repo.create({
        name: "manual-local",
        description: "Manual local Skill content should not be pruned.",
        source: "local",
        content: "<script>alert('xss')</script>"
      });
      repo.create({
        name: "remote-installed",
        description: "Non-local installed Skill should not be pruned by local sync.",
        source: "github:raw",
        content: "# Remote Installed"
      });

      const result = syncLocalSkills(repo, { roots: [path.join(root, "skills")] });
      const names = repo.list().map((skill) => skill.name).sort();

      assert.equal(result.discoveredCount, 1);
      assert.equal(result.deletedCount, 0);
      assert.deepEqual(names, ["manual-local", "openclaw-stale", "remote-installed", "safe-review"]);
    } finally {
      db.close();
    }
  });
});
