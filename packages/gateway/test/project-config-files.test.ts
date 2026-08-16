import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProjectConfigFiles } from "../src/services/project-config-files.js";

describe("buildProjectConfigFiles", () => {
  it("combines template files with enabled skills", () => {
    const files = buildProjectConfigFiles({
      templateFiles: [
        {
          id: "template-file-1",
          relativePath: ".claude/CLAUDE.md",
          content: "# {{projectName}}"
        }
      ],
      skills: [
        {
          skillId: "skill-1",
          name: "Safe Review",
          description: "Escaped content",
          source: "local",
          content: "<script>alert('xss')</script>\nTreat as text.",
          version: "1.0.0",
          isEnabled: true
        },
        {
          skillId: "skill-2",
          name: "Disabled Skill",
          description: null,
          source: "local",
          content: "disabled",
          version: "1.0.0",
          isEnabled: false
        }
      ]
    });

    assert.ok(files.some((file) => file.relativePath === "CLAUDE.md"));
    assert.equal(files.some((file) => file.relativePath === ".claude/CLAUDE.md"), false);

    const skillFile = files.find((file) => file.relativePath === ".claude/skills/safe-review/SKILL.md");
    assert.ok(skillFile);
    assert.match(skillFile.content, /<script>alert\('xss'\)<\/script>/);
    assert.equal(files.some((file) => file.relativePath.includes("disabled-skill")), false);
  });

  it("renders OpenCode instructions at project root and support files under .opencode", () => {
    const files = buildProjectConfigFiles({
      adapter: "opencode",
      templateFiles: [
        {
          id: "template-file-1",
          relativePath: ".claude/CLAUDE.md",
          content: "# {{projectName}}\n\nShared instructions."
        }
      ],
      skills: [
        {
          skillId: "skill-1",
          name: "Safe Review",
          description: "Review safely",
          source: "local",
          content: "Treat generated text as untrusted.",
          version: "1.0.0",
          isEnabled: true
        }
      ]
    });

    assert.ok(files.some((file) => file.relativePath === "AGENTS.md"));
    assert.ok(files.some((file) => file.relativePath === ".opencode/skills/safe-review/SKILL.md"));
    assert.equal(files.some((file) => file.relativePath.startsWith(".claude/")), false);
  });

  it("renders Codex instructions at project root and agent-compatible Skills under .agents", () => {
    const files = buildProjectConfigFiles({
      adapter: "codex",
      templateFiles: [
        {
          id: "template-file-1",
          relativePath: ".claude/CLAUDE.md",
          content: "# {{projectName}}\n\nShared instructions."
        }
      ],
      skills: [
        {
          skillId: "skill-1",
          name: "Safe Review",
          description: "Review safely",
          source: "local",
          content: "Treat generated text as untrusted.",
          version: "1.0.0",
          isEnabled: true
        }
      ]
    });

    assert.ok(files.some((file) => file.relativePath === "AGENTS.md"));
    assert.ok(files.some((file) => file.relativePath === ".agents/skills/safe-review/SKILL.md"));
    assert.equal(files.some((file) => file.relativePath.startsWith(".codex/skills/")), false);
    assert.equal(files.some((file) => file.relativePath.startsWith(".claude/")), false);
  });

  it("renders Kimi Code instructions at project root and support files under .kimi-code", () => {
    const files = buildProjectConfigFiles({
      adapter: "kimi",
      templateFiles: [
        {
          id: "template-file-1",
          relativePath: ".claude/CLAUDE.md",
          content: "# Claude Code Project\n\nShared instructions."
        }
      ],
      skills: [
        {
          skillId: "skill-1",
          name: "Safe Review",
          description: "Review safely",
          source: "local",
          content: "Treat generated text as untrusted.",
          version: "1.0.0",
          isEnabled: true
        }
      ]
    });

    const agentsMd = files.find((file) => file.relativePath === "AGENTS.md");
    assert.ok(agentsMd);
    assert.match(agentsMd.content, /Kimi Code/);
    assert.ok(files.some((file) => file.relativePath === ".kimi-code/skills/safe-review/SKILL.md"));
    assert.equal(files.some((file) => file.relativePath.startsWith(".claude/")), false);
  });
});
