import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUILTIN_COPILOT_SKILLS,
  getCopilotSkill,
  listCopilotSkillSummaries
} from "../src/services/agent/skills/copilot-skills.js";
import { createSkillTools } from "../src/services/agent/tools/skills.js";

describe("copilot skills registry", () => {
  it("ships the builtin engineering playbooks with unique names and bodies", () => {
    const names = BUILTIN_COPILOT_SKILLS.map((skill) => skill.name);
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes("autonomous-work-item-loop"));
    assert.ok(names.includes("safety-and-approvals"));
    for (const skill of BUILTIN_COPILOT_SKILLS) {
      assert.ok(skill.description.length > 10, `${skill.name} needs a summary`);
      assert.ok(skill.body.length > 200, `${skill.name} body too thin`);
    }
  });

  it("tier-1 summaries never leak full bodies", () => {
    for (const summary of listCopilotSkillSummaries()) {
      const skill = getCopilotSkill(summary.name);
      assert.ok(skill);
      assert.ok(summary.description.length < skill!.body.length / 4);
    }
  });
});

describe("skill tools", () => {
  it("exposes exactly two read tools", () => {
    const tools = createSkillTools();
    assert.deepEqual(
      tools.map((tool) => [tool.name, tool.risk, tool.requiresApproval]),
      [
        ["list_skills", "read", false],
        ["load_skill", "read", false]
      ]
    );
  });

  it("lists tier-1 metadata", async () => {
    const [listTool] = createSkillTools();
    const result = (await listTool.execute({}, { userId: "u" })) as {
      count: number;
      skills: Array<{ name: string; description: string }>;
    };
    assert.equal(result.count, listCopilotSkillSummaries().length);
    assert.equal(result.skills[0] && typeof result.skills[0].description, "string");
  });

  it("loads a full playbook and reports unknown names as not-found", async () => {
    const [, loadTool] = createSkillTools();

    const hit = (await loadTool.execute({ name: "autonomous-work-item-loop" }, { userId: "u" })) as {
      found: boolean;
      body: string;
    };
    assert.equal(hit.found, true);
    assert.match(hit.body, /pm_start_task_packet/u);

    const miss = (await loadTool.execute({ name: "no-such-skill" }, { userId: "u" })) as { found: boolean };
    assert.equal(miss.found, false);
  });

  it("rejects malformed input", async () => {
    const [, loadTool] = createSkillTools();
    await assert.rejects(() => loadTool.execute({}, { userId: "u" }));
  });
});
