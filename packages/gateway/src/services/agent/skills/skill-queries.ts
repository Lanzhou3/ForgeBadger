/**
 * Copilot skill queries — read the platform Skills store for the agent seam.
 *
 * The single source of truth for the Copilot's skill surface is the `skills`
 * table (SkillRepository). These helpers expose the user's readable + enabled
 * skills as name/description summaries for `list_skills`, `load_skill`, and the
 * `/skills` slash command so all three surfaces stay byte-identical.
 */
import type { Database } from "../../../db/types.js";
import { SkillRepository } from "../../../db/repositories/skill-repository.js";
import { seedBuiltinSkills } from "../../builtin-skills.js";

export interface CopilotSkillSummary {
  name: string;
  description: string;
}

export function listEnabledCopilotSkillSummaries(db: Database, userId: string): CopilotSkillSummary[] {
  const repo = new SkillRepository(db, userId);
  seedBuiltinSkills(repo);
  return repo
    .list()
    .filter((skill) => skill.isEnabled)
    .map((skill) => ({ name: skill.name, description: skill.description ?? "" }));
}
