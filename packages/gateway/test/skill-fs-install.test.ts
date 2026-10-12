import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SkillRemoteProvenance } from "../src/services/github-skill-source.js";
import {
  installSkillToAgentsHome,
  isManagedSkill,
  removeManagedSkill,
  updateManagedSkillFile
} from "../src/services/skill-fs-install.js";

let agentsHome: string;
let originalAgentsHome: string | undefined;

const provenance: SkillRemoteProvenance = {
  kind: "github",
  repo: "octo/hello",
  ref: "main",
  path: "skills/pdf/SKILL.md",
  resolvedCommitSha: "abc123",
  contentHash: "sha256:xyz",
  installedAt: "2026-09-22T00:00:00.000Z"
};

function markerPath(name: string): string {
  return path.join(agentsHome, "skills", name, ".forgebadger-managed.json");
}

function skillPath(name: string): string {
  return path.join(agentsHome, "skills", name, "SKILL.md");
}

before(() => {
  agentsHome = mkdtempSync(path.join(tmpdir(), "forgebadger-skill-fs-"));
  originalAgentsHome = process.env.AGENTS_HOME;
  process.env.AGENTS_HOME = agentsHome;
});

after(() => {
  if (originalAgentsHome === undefined) {
    delete process.env.AGENTS_HOME;
  } else {
    process.env.AGENTS_HOME = originalAgentsHome;
  }
  rmSync(agentsHome, { recursive: true, force: true });
});

describe("installSkillToAgentsHome", () => {
  it("writes SKILL.md and the managed marker atomically", () => {
    const result = installSkillToAgentsHome({ name: "pdf", content: "# PDF\n", provenance });
    assert.equal(result.name, "pdf");
    assert.equal(readFileSync(skillPath("pdf"), "utf8"), "# PDF\n");
    const marker = JSON.parse(readFileSync(markerPath("pdf"), "utf8")) as {
      managedBy: string;
      name: string;
      provenance: SkillRemoteProvenance;
    };
    assert.equal(marker.managedBy, "forgebadger");
    assert.equal(marker.name, "pdf");
    assert.equal(marker.provenance.resolvedCommitSha, "abc123");
  });

  it("normalizes skill names into safe directory slugs", () => {
    const result = installSkillToAgentsHome({ name: "My Fancy Skill!", content: "# x\n", provenance });
    assert.equal(result.name, "my-fancy-skill");
    assert.ok(existsSync(skillPath("my-fancy-skill")));
  });

  it("creates the skills root when missing", () => {
    const nested = mkdtempSync(path.join(tmpdir(), "forgebadger-skill-fs-nested-"));
    installSkillToAgentsHome({ name: "rooted", content: "# x\n", provenance }, { AGENTS_HOME: nested });
    assert.ok(existsSync(path.join(nested, "skills", "rooted", "SKILL.md")));
    rmSync(nested, { recursive: true, force: true });
  });

  it("rejects names that normalize to nothing", () => {
    assert.throws(() => installSkillToAgentsHome({ name: "...", content: "# x\n", provenance }), /invalid/);
  });
});

describe("updateManagedSkillFile", () => {
  it("rewrites content only for managed skills", () => {
    installSkillToAgentsHome({ name: "pdf", content: "# v1\n", provenance });
    const ok = updateManagedSkillFile("pdf", "# v2\n", { ...provenance, resolvedCommitSha: "def456" });
    assert.equal(ok, true);
    assert.equal(readFileSync(skillPath("pdf"), "utf8"), "# v2\n");
    const marker = JSON.parse(readFileSync(markerPath("pdf"), "utf8")) as { provenance: SkillRemoteProvenance };
    assert.equal(marker.provenance.resolvedCommitSha, "def456");
  });

  it("refuses to rewrite user-owned directories without a marker", () => {
    mkdirSync(path.join(agentsHome, "skills", "user-own"), { recursive: true });
    writeFileSync(path.join(agentsHome, "skills", "user-own", "SKILL.md"), "# user\n");
    assert.equal(updateManagedSkillFile("user-own", "# hijack\n", provenance), false);
    assert.equal(readFileSync(path.join(agentsHome, "skills", "user-own", "SKILL.md"), "utf8"), "# user\n");
  });
});

describe("removeManagedSkill", () => {
  it("deletes managed skill directories including the marker", () => {
    installSkillToAgentsHome({ name: "pdf", content: "# PDF\n", provenance });
    assert.equal(isManagedSkill("pdf"), true);
    assert.equal(removeManagedSkill("pdf"), true);
    assert.equal(existsSync(path.join(agentsHome, "skills", "pdf")), false);
  });

  it("never deletes user-owned directories without a marker", () => {
    mkdirSync(path.join(agentsHome, "skills", "user-keep"), { recursive: true });
    writeFileSync(path.join(agentsHome, "skills", "user-keep", "SKILL.md"), "# keep\n");
    assert.equal(isManagedSkill("user-keep"), false);
    assert.equal(removeManagedSkill("user-keep"), false);
    assert.ok(existsSync(path.join(agentsHome, "skills", "user-keep", "SKILL.md")));
  });

  it("ignores malformed markers", () => {
    mkdirSync(path.join(agentsHome, "skills", "bad-marker"), { recursive: true });
    writeFileSync(path.join(agentsHome, "skills", "bad-marker", "SKILL.md"), "# keep\n");
    writeFileSync(markerPath("bad-marker"), "not json");
    assert.equal(isManagedSkill("bad-marker"), false);
    assert.equal(removeManagedSkill("bad-marker"), false);
    assert.ok(existsSync(path.join(agentsHome, "skills", "bad-marker")));
  });

  it("refuses symlink escapes out of the skills root", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "forgebadger-skill-outside-"));
    let symlinked = false;
    try {
      symlinkSync(outside, path.join(agentsHome, "skills", "escape"), "junction");
      symlinked = true;
    } catch {
      // Symlink creation needs privileges on some Windows hosts; the realpath
      // guard is still exercised on platforms that allow it.
    }
    if (symlinked) {
      assert.throws(
        () => installSkillToAgentsHome({ name: "escape", content: "# x\n", provenance }),
        /escapes the skills root/
      );
      assert.ok(existsSync(outside));
      rmSync(path.join(agentsHome, "skills", "escape"), { force: true });
    }
    rmSync(outside, { recursive: true, force: true });
  });
});
