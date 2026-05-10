import type { TemplateFileInput } from "../config-generation/types.js";
import type { Agent } from "../db/repositories/agent-repository.js";
import type { ProjectSkill } from "../db/repositories/project-skill-repository.js";
import type { AdapterId } from "./adapter-discovery.js";

export interface BuildProjectConfigFilesInput {
  adapter?: AdapterId | undefined;
  templateFiles: TemplateFileInput[];
  agents?: Array<Pick<
    Agent,
    "id" | "name" | "description" | "modelId" | "tools" | "allowedDirs" | "customPrompt" | "status"
  >>;
  skills?: ProjectSkill[];
}

type ProjectConfigAgent = NonNullable<BuildProjectConfigFilesInput["agents"]>[number];

export function buildProjectConfigFiles(input: BuildProjectConfigFilesInput): TemplateFileInput[] {
  const adapter = input.adapter ?? "claude";
  return [
    ...adaptTemplateFiles(input.templateFiles, adapter),
    ...(input.agents ?? [])
      .filter((agent) => agent.status !== "disabled")
      .map((agent) => agentToTemplateFile(agent, adapter)),
    ...(input.skills ?? [])
      .filter((skill) => skill.isEnabled)
      .map((skill) => skillToTemplateFile(skill, adapter))
  ];
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
    return [];
  });
}

function agentToTemplateFile(agent: ProjectConfigAgent, adapter: AdapterId): TemplateFileInput {
  const content = [
    "---",
    `name: ${agent.name}`,
    agent.description ? `description: ${agent.description}` : undefined,
    agent.modelId ? `model: ${agent.modelId}` : undefined,
    agent.tools ? `tools: ${agent.tools}` : undefined,
    agent.allowedDirs ? `allowed_dirs: ${agent.allowedDirs}` : undefined,
    "---",
    "",
    agent.customPrompt ?? "",
    ""
  ].filter((line): line is string => line !== undefined).join("\n");

  return {
    id: `agent:${agent.id}`,
    relativePath: `${adapterConfigRoot(adapter)}/agents/${slugify(agent.name)}.md`,
    content
  };
}

function skillToTemplateFile(skill: ProjectSkill, adapter: AdapterId): TemplateFileInput {
  const slug = slugify(skill.name);
  const content = [
    "---",
    `name: ${slug}`,
    skill.description ? `description: ${skill.description}` : undefined,
    "---",
    "",
    `# ${skill.name}`,
    "",
    skill.description ?? "",
    "",
    skill.content,
    ""
  ].filter((line): line is string => line !== undefined).join("\n");

  return {
    id: `skill:${skill.skillId}`,
    relativePath: skillConfigPath(skill.name, adapter),
    content
  };
}

function skillConfigPath(name: string, adapter: AdapterId): string {
  const slug = slugify(name);
  if (adapter === "codex") {
    return `.agents/skills/${slug}/SKILL.md`;
  }
  return `${adapterConfigRoot(adapter)}/skills/${slug}/SKILL.md`;
}

function adapterConfigRoot(adapter: AdapterId): ".claude" | ".opencode" | ".codex" {
  if (adapter === "opencode") return ".opencode";
  if (adapter === "codex") return ".codex";
  return ".claude";
}

function adaptInstructionContent(content: string, adapter: AdapterId): string {
  const adapterLabel = adapter === "opencode" ? "OpenCode" : "Codex";
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
