import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
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
  it("discovers flat project skills and folder-based SKILL.md files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-local-skills-"));
    const projectSkills = path.join(root, ".claude", "skills");
    const userSkills = path.join(root, "user-skills");
    await mkdir(projectSkills, { recursive: true });
    await mkdir(path.join(userSkills, "reviewer"), { recursive: true });
    await writeFile(
      path.join(projectSkills, "plan-workflow.md"),
      "# Plan Workflow\n\nUse this when planning work.\n"
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

    assert.equal(skills.length, 2);
    assert.deepEqual(skills.map((skill) => skill.name).sort(), ["code-reviewer", "plan-workflow"]);
    assert.equal(skills.find((skill) => skill.name === "plan-workflow")?.root, projectSkills);
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

  it("includes ancestor project .claude skills when Gateway starts from a package directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-ancestor-skills-"));
    const nestedCwd = path.join(root, "packages", "gateway");
    const projectSkillDir = path.join(root, ".claude", "skills", "verify-workflow");
    await mkdir(nestedCwd, { recursive: true });
    await mkdir(projectSkillDir, { recursive: true });
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

    const roots = defaultLocalSkillRoots(nestedCwd, {});
    const skills = discoverLocalSkills({ cwd: nestedCwd, env: {}, maxFiles: 20 });

    assert.ok(roots.includes(path.join(root, ".claude", "skills")));
    assert.ok(skills.some((skill) => skill.name === "verify-workflow"));
  });

  it("includes Claude Code plugin cache skills in default discovery roots", () => {
    const roots = defaultLocalSkillRoots("/tmp/openforge-project", {});

    assert.ok(roots.includes(path.join(homedir(), ".claude", "plugins", "cache")));
  });

  it("uses CLAUDE_CONFIG_DIR for Claude Code user skills and plugin cache", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-config-skills-"));
    const configDir = path.join(root, "custom-claude");
    const userSkillDir = path.join(configDir, "skills", "custom-review");
    const pluginSkillDir = path.join(
      configDir,
      "plugins",
      "cache",
      "vendor",
      "plugin",
      "1.0.0",
      "skills",
      "plugin-review"
    );
    await mkdir(userSkillDir, { recursive: true });
    await mkdir(pluginSkillDir, { recursive: true });
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
      path.join(pluginSkillDir, "SKILL.md"),
      [
        "---",
        "name: plugin-review",
        "description: Review from a cached plugin.",
        "---",
        "",
        "# Plugin Review"
      ].join("\n")
    );

    const roots = defaultLocalSkillRoots(path.join(root, "project"), {
      CLAUDE_CONFIG_DIR: configDir
    });
    const skills = discoverLocalSkills({
      cwd: path.join(root, "project"),
      env: { CLAUDE_CONFIG_DIR: configDir }
    });

    assert.ok(roots.includes(path.join(configDir, "skills")));
    assert.ok(roots.includes(path.join(configDir, "plugins", "cache")));
    assert.ok(skills.some((skill) => skill.name === "custom-review"));
    assert.ok(skills.some((skill) => skill.name === "plugin-review"));
  });

  it("discovers command-style skills from Claude plugin marketplaces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-marketplace-skills-"));
    const configDir = path.join(root, "custom-claude");
    const commandDir = path.join(configDir, "plugins", "marketplaces", "vendor", "workflow-pack", "commands");
    await mkdir(commandDir, { recursive: true });
    await writeFile(
      path.join(commandDir, "review-pr.md"),
      [
        "---",
        "description: Review the current pull request with repository context.",
        "---",
        "",
        "# Review PR",
        "",
        "Inspect the pull request and report concrete findings."
      ].join("\n")
    );

    const roots = defaultLocalSkillRoots(path.join(root, "project"), {
      CLAUDE_CONFIG_DIR: configDir
    });
    const skills = discoverLocalSkills({
      cwd: path.join(root, "project"),
      env: { CLAUDE_CONFIG_DIR: configDir }
    });

    assert.ok(roots.includes(path.join(configDir, "plugins", "marketplaces")));
    assert.ok(skills.some((skill) => skill.name === "review-pr"));
    assert.equal(
      skills.find((skill) => skill.name === "review-pr")?.description,
      "Review the current pull request with repository context."
    );
  });

  it("uses explicit Codex and Agents home directories in default discovery roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-skill-homes-"));
    const codexHome = path.join(root, "codex-home");
    const agentsHome = path.join(root, "agents-home");
    const codexSkillDir = path.join(codexHome, "skills", "codex-review");
    const agentSkillDir = path.join(agentsHome, "skills", "agent-review");
    await mkdir(codexSkillDir, { recursive: true });
    await mkdir(agentSkillDir, { recursive: true });
    await writeFile(
      path.join(codexSkillDir, "SKILL.md"),
      [
        "---",
        "name: codex-review",
        "description: Review from CODEX_HOME.",
        "---",
        "",
        "# Codex Review"
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

    const roots = defaultLocalSkillRoots(path.join(root, "project"), {
      CODEX_HOME: codexHome,
      AGENTS_HOME: agentsHome
    });
    const skills = discoverLocalSkills({
      cwd: path.join(root, "project"),
      env: { CODEX_HOME: codexHome, AGENTS_HOME: agentsHome }
    });

    assert.ok(roots.includes(path.join(codexHome, "skills")));
    assert.ok(roots.includes(path.join(agentsHome, "skills")));
    assert.ok(skills.some((skill) => skill.name === "codex-review"));
    assert.ok(skills.some((skill) => skill.name === "agent-review"));
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

      assert.equal(first.discoveredCount, 1);
      assert.equal(first.createdCount, 1);
      assert.deepEqual(first.discoveredRoots, [path.join(root, "skills")]);
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
});
