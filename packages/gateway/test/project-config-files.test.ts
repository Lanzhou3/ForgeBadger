import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProjectConfigFiles } from "../src/services/project-config-files.js";

describe("buildProjectConfigFiles", () => {
  it("combines template files with active agents and enabled skills", () => {
    const files = buildProjectConfigFiles({
      templateFiles: [
        {
          id: "template-file-1",
          relativePath: ".claude/CLAUDE.md",
          content: "# {{projectName}}"
        }
      ],
      agents: [
        {
          id: "agent-1",
          name: "Code Reviewer",
          description: "Reviews changes",
          modelId: "model-1",
          tools: "Read,Edit",
          allowedDirs: "/tmp/project",
          customPrompt: "Review diffs only.",
          status: "active"
        },
        {
          id: "agent-2",
          name: "Disabled Agent",
          description: null,
          modelId: null,
          tools: null,
          allowedDirs: null,
          customPrompt: null,
          status: "disabled"
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

    const agentFile = files.find((file) => file.relativePath === ".claude/agents/code-reviewer.md");
    assert.ok(agentFile);
    assert.match(agentFile.content, /name: Code Reviewer/);
    assert.match(agentFile.content, /tools: Read,Edit/);
    assert.match(agentFile.content, /Review diffs only/);
    assert.equal(files.some((file) => file.relativePath.includes("disabled-agent")), false);

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
      agents: [
        {
          id: "agent-1",
          name: "Code Reviewer",
          description: "Reviews changes",
          modelId: null,
          tools: null,
          allowedDirs: null,
          customPrompt: "Review diffs only.",
          status: "active"
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
    assert.ok(files.some((file) => file.relativePath === ".opencode/agents/code-reviewer.md"));
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
      agents: [],
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
});
