import { parseSkillRemoteProvenance, type Skill } from "@/lib/api";

export type SkillStatus = "all" | "enabled" | "disabled" | "updates";

export function skillSource(skill: Skill): string {
  const provenance = parseSkillRemoteProvenance(skill);
  if (
    skill.source.startsWith("github") ||
    provenance?.kind === "github" ||
    provenance?.kind === "marketplace"
  )
    return "github";
  if (skill.source.startsWith("clawhub") || provenance?.kind === "clawhub")
    return "clawhub";
  return skill.source || "local";
}

export function hasSkillUpdate(skill: Skill): boolean {
  return parseSkillRemoteProvenance(skill)?.lastCheck?.updateAvailable === true;
}

export function matchesSkillStatus(skill: Skill, status: SkillStatus): boolean {
  if (status === "enabled") return skill.isEnabled;
  if (status === "disabled") return !skill.isEnabled;
  if (status === "updates") return hasSkillUpdate(skill);
  return true;
}

export function readStoredSkillFiles(
  skill: Skill,
): Array<{ path: string; content: string }> {
  const files = [{ path: "SKILL.md", content: skill.content ?? "" }];
  if (!skill.resourceManifest) return files;
  const manifest: unknown = JSON.parse(skill.resourceManifest);
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("files" in manifest) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("Invalid resource manifest");
  }
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file !== "object" ||
      typeof file.relativePath !== "string" ||
      typeof file.content !== "string"
    ) {
      throw new Error("Invalid resource file");
    }
    files.push({ path: file.relativePath, content: file.content });
  }
  return files;
}
