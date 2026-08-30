import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createRenderPlan,
  writeConfigPlan,
  type ConfigWriteError
} from "../../src/config-generation/index.js";

describe("writeConfigPlan", () => {
  it("requires explicit actions for existing file conflicts", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# Existing", "utf8");

    await assert.rejects(
      () => writeConfigPlan(plan(root, [{ relativePath: ".claude/CLAUDE.md", content: "# Incoming" }])),
      (error: unknown) => {
        const configError = error as ConfigWriteError;
        assert.equal(configError.name, "ConfigWriteError");
        assert.equal(configError.conflicts[0]?.relativePath, ".claude/CLAUDE.md");
        assert.equal(configError.conflicts[0]?.conflictType, "modified");
        return true;
      }
    );

    assert.equal(await readFile(join(root, ".claude", "CLAUDE.md"), "utf8"), "# Existing");
  });

  it("skips existing files when the user explicitly chooses skip", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# Existing", "utf8");

    const result = await writeConfigPlan(
      plan(root, [{ relativePath: ".claude/CLAUDE.md", content: "# Incoming" }]),
      {
        decisions: { ".claude/CLAUDE.md": "skip" }
      }
    );

    assert.deepEqual(result.writtenFiles, []);
    assert.deepEqual(result.skippedFiles, [".claude/CLAUDE.md"]);
    assert.equal(await readFile(join(root, ".claude", "CLAUDE.md"), "utf8"), "# Existing");
  });

  it("auto-skips identical existing files without explicit decisions", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# Same", "utf8");

    const result = await writeConfigPlan(
      plan(root, [{ relativePath: ".claude/CLAUDE.md", content: "# Same" }])
    );

    assert.deepEqual(result.writtenFiles, []);
    assert.deepEqual(result.skippedFiles, [".claude/CLAUDE.md"]);
    assert.equal(await readFile(join(root, ".claude", "CLAUDE.md"), "utf8"), "# Same");
  });

  it("rejects write decisions that are not allowed for the conflict", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# Same", "utf8");

    await assert.rejects(
      () =>
        writeConfigPlan(plan(root, [{ relativePath: ".claude/CLAUDE.md", content: "# Same" }]), {
          decisions: { ".claude/CLAUDE.md": "overwrite" }
        }),
      (error: unknown) => {
        const configError = error as ConfigWriteError;
        assert.equal(configError.name, "ConfigWriteError");
        assert.equal(configError.conflicts[0]?.allowedActions.includes("overwrite"), false);
        return true;
      }
    );

    assert.equal(await readFile(join(root, ".claude", "CLAUDE.md"), "utf8"), "# Same");
  });

  it("backs up and overwrites existing files when the user explicitly chooses overwrite", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# Existing", "utf8");

    const result = await writeConfigPlan(
      plan(root, [{ relativePath: ".claude/CLAUDE.md", content: "# Incoming" }]),
      {
        decisions: { ".claude/CLAUDE.md": "overwrite" }
      }
    );

    assert.deepEqual(result.writtenFiles, [".claude/CLAUDE.md"]);
    assert.equal(await readFile(join(root, ".claude", "CLAUDE.md"), "utf8"), "# Incoming");
    assert.match(result.backupPath, /\.forgebadger\/backups\/config-writes\//);
    assert.equal(
      await readFile(join(result.backupPath, ".claude", "CLAUDE.md"), "utf8"),
      "# Existing"
    );
  });

  it("rolls back created and overwritten files after a partial write failure", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# Existing", "utf8");

    const result = await writeConfigPlan(
      plan(root, [
        { relativePath: ".claude/CLAUDE.md", content: "# Incoming" },
        { relativePath: ".claude/settings.json", content: "{}" }
      ]),
      {
        decisions: {
          ".claude/CLAUDE.md": "overwrite"
        },
        failBeforeWrite: ".claude/settings.json"
      }
    );

    assert.equal(result.rollbackAvailable, false);
    assert.deepEqual(result.rollbackResult, {
      restoredFiles: [".claude/CLAUDE.md"],
      removedFiles: [],
      failedFiles: [],
      success: true
    });
    assert.equal(await readFile(join(root, ".claude", "CLAUDE.md"), "utf8"), "# Existing");
    await assert.rejects(readFile(join(root, ".claude", "settings.json"), "utf8"), /ENOENT/);
  });

  it("reports rollback failures with files requiring manual inspection", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "CLAUDE.md"), "# Existing", "utf8");

    const result = await writeConfigPlan(
      plan(root, [
        { relativePath: ".claude/CLAUDE.md", content: "# Incoming" },
        { relativePath: ".claude/settings.json", content: "{}" }
      ]),
      {
        decisions: {
          ".claude/CLAUDE.md": "overwrite"
        },
        failBeforeWrite: ".claude/settings.json",
        failRollbackFor: [".claude/CLAUDE.md"]
      }
    );

    assert.deepEqual(result.rollbackResult, {
      restoredFiles: [],
      removedFiles: [],
      failedFiles: [".claude/CLAUDE.md"],
      success: false
    });
    assert.equal(await readFile(join(root, ".claude", "CLAUDE.md"), "utf8"), "# Incoming");
  });
});

function plan(
  root: string,
  files: Array<{ relativePath: string; content: string }>
) {
  return createRenderPlan({
    projectId: "project_1",
    targetRoot: root,
    templateId: "claude-default",
    credentialMode: "host_environment",
    dryRun: false,
    variables: {},
    templateFiles: files.map((file, index) => ({
      id: `template_file_${index}`,
      relativePath: file.relativePath,
      content: file.content
    }))
  });
}

async function projectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forgebadger-gate-b-"));
}
