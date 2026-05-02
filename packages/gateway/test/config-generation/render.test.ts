import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { createRenderPlan } from "../../src/config-generation/index.js";

describe("createRenderPlan", () => {
  it("creates the Gate B render plan contract with rendered file hashes", () => {
    const plan = createRenderPlan({
      projectId: "project_1",
      targetRoot: "/tmp/openforge-project",
      templateId: "claude-default",
      credentialMode: "host_environment",
      dryRun: true,
      variables: {
        projectName: "OpenForge",
        agentName: "Claude"
      },
      templateFiles: [
        {
          id: "template_file_1",
          relativePath: ".claude/CLAUDE.md",
          content: "# {{projectName}}\nUse {{agentName}}.\nMissing: {{missing}}",
          mode: "0644"
        }
      ]
    });

    assert.equal(plan.projectId, "project_1");
    assert.equal(plan.targetRoot, "/tmp/openforge-project");
    assert.equal(plan.templateId, "claude-default");
    assert.equal(plan.credentialMode, "host_environment");
    assert.equal(plan.dryRun, true);
    assert.deepEqual(plan.variables, {
      projectName: "OpenForge",
      agentName: "Claude"
    });
    assert.equal(plan.files.length, 1);
    assert.deepEqual(plan.files[0], {
      relativePath: ".claude/CLAUDE.md",
      content: "# OpenForge\nUse Claude.\nMissing: ",
      mode: "0644",
      sha256: sha256("# OpenForge\nUse Claude.\nMissing: "),
      sourceTemplateFileId: "template_file_1"
    });
  });
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
