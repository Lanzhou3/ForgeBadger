import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createRenderPlan,
  detectConfigConflicts,
  sha256
} from "../../src/config-generation/index.js";

describe("detectConfigConflicts", () => {
  it("reports no conflicts for missing files and does not write during dry-run", async () => {
    const root = await projectRoot();
    const plan = createRenderPlan({
      projectId: "project_1",
      targetRoot: root,
      templateId: "claude-default",
      credentialMode: "host_environment",
      dryRun: true,
      variables: { projectName: "ForgeBadger" },
      templateFiles: [
        {
          id: "template_file_1",
          relativePath: ".claude/CLAUDE.md",
          content: "# {{projectName}}"
        }
      ]
    });

    const conflicts = await detectConfigConflicts(plan);

    assert.deepEqual(conflicts, []);
    await assert.rejects(readFile(join(root, ".claude", "CLAUDE.md"), "utf8"), /ENOENT/);
  });

  it("reports exists when existing content matches incoming content", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# ForgeBadger", "utf8");
    const plan = createRenderPlan({
      projectId: "project_1",
      targetRoot: root,
      templateId: "claude-default",
      credentialMode: "host_environment",
      dryRun: true,
      variables: { projectName: "ForgeBadger" },
      templateFiles: [
        {
          id: "template_file_1",
          relativePath: ".claude/CLAUDE.md",
          content: "# {{projectName}}"
        }
      ]
    });

    const conflicts = await detectConfigConflicts(plan);

    assert.deepEqual(conflicts, [
      {
        relativePath: ".claude/CLAUDE.md",
        existingSha256: sha256("# ForgeBadger"),
        incomingSha256: sha256("# ForgeBadger"),
        conflictType: "exists",
        allowedActions: ["skip"]
      }
    ]);
  });

  it("reports modified when existing content differs from incoming content", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# Existing", "utf8");
    const plan = createRenderPlan({
      projectId: "project_1",
      targetRoot: root,
      templateId: "claude-default",
      credentialMode: "host_environment",
      dryRun: true,
      variables: { projectName: "Incoming" },
      templateFiles: [
        {
          id: "template_file_1",
          relativePath: ".claude/CLAUDE.md",
          content: "# {{projectName}}"
        }
      ]
    });

    const conflicts = await detectConfigConflicts(plan);

    assert.equal(conflicts[0]?.conflictType, "modified");
    assert.equal(conflicts[0]?.existingSha256, sha256("# Existing"));
    assert.equal(conflicts[0]?.incomingSha256, sha256("# Incoming"));
  });

  it("includes readable line-level previews for modified conflicts", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# Existing\nkeep this", "utf8");
    const plan = createRenderPlan({
      projectId: "project_1",
      targetRoot: root,
      templateId: "claude-default",
      credentialMode: "host_environment",
      dryRun: true,
      variables: { projectName: "Incoming" },
      templateFiles: [
        {
          id: "template_file_1",
          relativePath: ".claude/CLAUDE.md",
          content: "# {{projectName}}\nkeep this"
        }
      ]
    });

    const conflicts = await detectConfigConflicts(plan);

    assert.deepEqual(conflicts[0]?.diffPreview, [
      { line: 1, existing: "# Existing", incoming: "# Incoming" }
    ]);
  });

  it("reports unsafe_path for absolute, traversal, encoded traversal, and unicode traversal-like paths", async () => {
    const root = await projectRoot();
    const plan = createRenderPlan({
      projectId: "project_1",
      targetRoot: root,
      templateId: "claude-default",
      credentialMode: "host_environment",
      dryRun: true,
      variables: {},
      templateFiles: [
        { id: "absolute", relativePath: "/tmp/outside", content: "" },
        { id: "traversal", relativePath: "../outside", content: "" },
        { id: "encoded", relativePath: "%2e%2e/outside", content: "" },
        { id: "unicode", relativePath: "..\u2215outside", content: "" }
      ]
    });

    const conflicts = await detectConfigConflicts(plan);

    assert.deepEqual(
      conflicts.map((conflict) => [conflict.relativePath, conflict.conflictType]),
      [
        ["/tmp/outside", "unsafe_path"],
        ["../outside", "unsafe_path"],
        ["%2e%2e/outside", "unsafe_path"],
        ["..\u2215outside", "unsafe_path"]
      ]
    );
  });

  it("reports unsafe_path for symlink escapes", async () => {
    const root = await projectRoot();
    const outside = await projectRoot();
    await symlink(outside, join(root, "linked-outside"));
    const plan = createRenderPlan({
      projectId: "project_1",
      targetRoot: root,
      templateId: "claude-default",
      credentialMode: "host_environment",
      dryRun: true,
      variables: {},
      templateFiles: [
        {
          id: "template_file_1",
          relativePath: "linked-outside/CLAUDE.md",
          content: ""
        }
      ]
    });

    const conflicts = await detectConfigConflicts(plan);

    assert.equal(conflicts[0]?.conflictType, "unsafe_path");
  });
});

async function projectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forgebadger-gate-b-"));
}
