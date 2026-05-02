export interface AgentPermissionPreviewInput {
  tools?: string | null;
  allowedDirs?: string | null;
  projectName?: string | null;
  modelName?: string | null;
}

export interface AgentPermissionPreview {
  tools: string[];
  allowedDirs: string[];
  scope: string;
  model: string;
}

export function splitCommaList(value?: string | null): string[] {
  return (value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildAgentPermissionPreview(input: AgentPermissionPreviewInput): AgentPermissionPreview {
  return {
    tools: splitCommaList(input.tools),
    allowedDirs: splitCommaList(input.allowedDirs),
    scope: input.projectName?.trim() || "Global",
    model: input.modelName?.trim() || "Default",
  };
}
