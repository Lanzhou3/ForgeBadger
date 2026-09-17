/**
 * Skill tools — the progressive-disclosure seam (Path B).
 *
 * Procedural knowledge lives in versioned skill documents instead of growing
 * per-domain tool schemas. The model sees cheap tier-1 metadata via
 * list_skills and pulls full playbooks with load_skill only when relevant.
 * Executable capabilities remain native tools; skills teach how to compose
 * them.
 *
 * Skills resolve from the platform Skills store (the `skills` table) — the
 * same surface the Skills page manages — so imported and local skills are
 * immediately visible to the Copilot. The builtin engineering playbooks ship
 * as seeded rows (`source: "builtin"`), not hardcoded constants.
 */
import { z } from "zod";

import { SkillRepository } from "../../../db/repositories/skill-repository.js";
import type { Database } from "../../../db/types.js";
import { seedBuiltinSkills } from "../../builtin-skills.js";
import { stripFrontmatter } from "../../skill-frontmatter.js";
import { listEnabledCopilotSkillSummaries } from "../skills/skill-queries.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";

const listSkillsInput = z.object({}).strict();

const loadSkillInput = z.object({
  name: z.string().min(1).max(128)
}).strict();

export function createSkillTools(): AgentTool[] {
  return [
    {
      name: "list_skills",
      description:
        "List available Copilot skills (name + one-line summary). Skills are playbooks that teach how to combine action tools for complete engineering workflows — consult them before multi-step operations.",
      risk: "read",
      requiresApproval: false,
      inputSchema: listSkillsInput,
      async execute(_input, context: AgentToolContext) {
        const skills = listEnabledCopilotSkillSummaries(context.db as Database, context.userId as string);
        return { count: skills.length, skills };
      }
    },
    {
      name: "load_skill",
      description:
        "Load the full playbook body of one skill by name (from list_skills). Returns step-by-step guidance, exact tool names/parameters, error codes, and recovery rules.",
      risk: "read",
      requiresApproval: false,
      inputSchema: loadSkillInput,
      async execute(input, context: AgentToolContext) {
        const { name } = loadSkillInput.parse(input);
        const repo = new SkillRepository(context.db as Database, context.userId as string);
        seedBuiltinSkills(repo);
        const skill = repo.findReadableByName(name);
        if (!skill) return { found: false, name };
        return {
          found: true,
          name: skill.name,
          description: skill.description ?? "",
          body: stripFrontmatter(skill.content)
        };
      }
    }
  ];
}
