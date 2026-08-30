import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createInitRenderPlan,
  parseForgeBadgerCliArgs
} from "../src/cli/init.js";

describe("forgebadger init CLI prototype", () => {
  it("parses init arguments with template id and dry-run", () => {
    const command = parseForgeBadgerCliArgs([
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
      parseForgeBadgerCliArgs(["--", "init", "--path", "/tmp/demo"]).projectPath,
      "/tmp/demo"
    );
  });

  it("creates a dry-run render plan from the built-in template", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-init-"));

    const plan = await createInitRenderPlan({
      projectPath,
      templateId: "builtin-claude-code",
      credentialMode: "host_environment",
      dryRun: true
    });

    assert.equal(plan.targetRoot, projectPath);
    assert.equal(plan.templateId, "builtin-claude-code");
    assert.equal(plan.dryRun, true);
    assert.ok(plan.files.some((file) => file.relativePath === "CLAUDE.md"));
    assert.ok(plan.files.some((file) => file.relativePath === ".claude/settings.json"));
    assert.match(
      plan.files.find((file) => file.relativePath === "CLAUDE.md")?.content ?? "",
      /forgebadger-cli-init-/
    );
  });

  it("accepts the legacy Gateway URL only when the ForgeBadger value is absent", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-init-env-"));
    const legacyPlan = await createInitRenderPlan({
      projectPath,
      templateId: "builtin-claude-code",
      credentialMode: "host_environment",
      dryRun: true,
      env: { OPENFORGE_GATEWAY_URL: "http://legacy.example:48731" }
    });
    const currentPlan = await createInitRenderPlan({
      projectPath,
      templateId: "builtin-claude-code",
      credentialMode: "host_environment",
      dryRun: true,
      env: {
        FORGEBADGER_GATEWAY_URL: "http://current.example:48731",
        OPENFORGE_GATEWAY_URL: "http://legacy.example:48731"
      }
    });

    assert.match(JSON.stringify(legacyPlan.files), /http:\/\/legacy\.example:48731/);
    assert.match(JSON.stringify(currentPlan.files), /http:\/\/current\.example:48731/);
  });
});
