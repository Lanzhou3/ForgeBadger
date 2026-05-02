import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createInitRenderPlan,
  parseOpenForgeCliArgs
} from "../src/cli/init.js";

describe("openforge init CLI prototype", () => {
  it("parses init arguments with template id and dry-run", () => {
    const command = parseOpenForgeCliArgs([
      "init",
      "--path",
      "/tmp/demo",
      "--template-id",
      "builtin-claude-code",
      "--dry-run"
    ]);

    assert.deepEqual(command, {
      command: "init",
      projectPath: "/tmp/demo",
      templateId: "builtin-claude-code",
      credentialMode: "host_environment",
      dryRun: true
    });

    assert.equal(
      parseOpenForgeCliArgs(["--", "init", "--path", "/tmp/demo"]).projectPath,
      "/tmp/demo"
    );
  });

  it("creates a dry-run render plan from the built-in template", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "openforge-cli-init-"));

    const plan = await createInitRenderPlan({
      projectPath,
      templateId: "builtin-claude-code",
      credentialMode: "host_environment",
      dryRun: true
    });

    assert.equal(plan.targetRoot, projectPath);
    assert.equal(plan.templateId, "builtin-claude-code");
    assert.equal(plan.dryRun, true);
    assert.ok(plan.files.some((file) => file.relativePath === ".claude/CLAUDE.md"));
    assert.ok(plan.files.some((file) => file.relativePath === ".claude/settings.json"));
    assert.match(
      plan.files.find((file) => file.relativePath === ".claude/CLAUDE.md")?.content ?? "",
      /openforge-cli-init-/
    );
  });
});
