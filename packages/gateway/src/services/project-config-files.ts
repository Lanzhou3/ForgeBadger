import { hasFrontmatter } from "./skill-frontmatter.js";
import { parseSkillResourceManifest, skillExportManifest, assertUniqueConfigPaths } from "./skill-resources.js";
import type { TemplateFileInput } from "../config-generation/types.js";
import type { ProjectSkill } from "../db/repositories/project-skill-repository.js";
import type { AdapterId } from "./adapter-discovery.js";

export interface BuildProjectConfigFilesInput {
  adapter?: AdapterId | undefined;
  templateFiles: TemplateFileInput[];
  skills?: ProjectSkill[];
}


export function buildProjectConfigFiles(input: BuildProjectConfigFilesInput): TemplateFileInput[] {
  const adapter = input.adapter ?? "claude";
  const files = [
    ...adaptTemplateFiles(input.templateFiles, adapter),
    ...(input.skills ?? [])
      .filter((skill) => skill.isEnabled && skill.runtimeTarget !== "copilot")
      .flatMap((skill) => skillToTemplateFiles(skill, adapter))
  ];
  assertUniqueConfigPaths(files);
  return files;
}

function adaptTemplateFiles(
  files: TemplateFileInput[],
  adapter: AdapterId
): TemplateFileInput[] {
  if (adapter === "claude") {
    return files.map((file) => {
      if (file.relativePath === ".claude/CLAUDE.md") {
        return {
          ...file,
          relativePath: "CLAUDE.md"
        };
      }
      return file;
    });
  }
  const root = adapterConfigRoot(adapter);
  return files.flatMap((file) => {
    if (file.relativePath === "AGENTS.md") {
      return [file];
    }
    if (file.relativePath === `${root}/AGENTS.md`) {
      return [{
        ...file,
        relativePath: "AGENTS.md"
      }];
    }
    if (file.relativePath.startsWith(`${root}/`)) {
      return [file];
    }
    if (file.relativePath === ".claude/CLAUDE.md" || file.relativePath.endsWith("/CLAUDE.md")) {
      return [{
        ...file,
        relativePath: "AGENTS.md",
        content: adaptInstructionContent(file.content, adapter)
      }];
    }
    if (adapter === "opencode" && (file.relativePath === "opencode.json" || file.relativePath === "opencode.jsonc")) {
      return [file];
    }
    if (adapter === "codex" && file.relativePath === "AGENTS.override.md") {
      return [file];
    }
    if (adapter === "codex" && file.relativePath.startsWith(".agents/skills/")) {
      return [file];
    }
    return [];
  });
}

function skillToTemplateFiles(skill: ProjectSkill, adapter: AdapterId): TemplateFileInput[] {
  const relativePath = skillConfigPath(skill.name, adapter);
  const directory = relativePath.slice(0, -"/SKILL.md".length);
  const content = hasFrontmatter(skill.content) ? skill.content : [
    "---", `name: ${JSON.stringify(slugify(skill.name))}`,
    `description: ${JSON.stringify(skill.description ?? skill.name)}`, "---", "", skill.content
  ].join("\n");
  const files: TemplateFileInput[] = [{renderVariables:false,id:`skill:${skill.skillId}`,relativePath,content},
    ...parseSkillResourceManifest(skill.resourceManifest).map(resource=>({
      renderVariables:false,id:`skill:${skill.skillId}:${resource.relativePath}`,
      relativePath:`${directory}/${resource.relativePath}`,content:resource.content
    }))
  ];
  return [...files,skillExportManifest(skill.skillId,directory,files)];
}

function skillConfigPath(name: string, adapter: AdapterId): string {
  const slug = slugify(name);
  if (adapter === "codex") {
    return `.agents/skills/${slug}/SKILL.md`;
  }
  return `${adapterConfigRoot(adapter)}/skills/${slug}/SKILL.md`;
}

export function adapterConfigRoot(adapter: AdapterId): ".claude" | ".opencode" | ".codex" | ".kimi-code" {
  if (adapter === "opencode") return ".opencode";
  if (adapter === "codex") return ".codex";
  if (adapter === "kimi") return ".kimi-code";
  return ".claude";
}

function adaptInstructionContent(content: string, adapter: AdapterId): string {
  const adapterLabel =
    adapter === "opencode" ? "OpenCode" : adapter === "kimi" ? "Kimi Code" : "Codex";
  return content
    .replaceAll("CLAUDE.md", "AGENTS.md")
    .replaceAll("Claude Code", adapterLabel)
    .replaceAll("Claude", adapterLabel);
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "item";
}
