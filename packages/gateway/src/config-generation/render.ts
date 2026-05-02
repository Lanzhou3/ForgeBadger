import { sha256 } from "./hash.js";
import type { CreateRenderPlanInput, RenderPlan } from "./types.js";

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function createRenderPlan(input: CreateRenderPlanInput): RenderPlan {
  return {
    projectId: input.projectId,
    targetRoot: input.targetRoot,
    templateId: input.templateId,
    variables: { ...input.variables },
    credentialMode: input.credentialMode,
    dryRun: input.dryRun,
    files: input.templateFiles.map((file) => {
      const content = renderTemplate(file.content, input.variables);
      const generatedFile = {
        relativePath: file.relativePath,
        content,
        sha256: sha256(content),
        sourceTemplateFileId: file.id
      };
      return file.mode === undefined ? generatedFile : { ...generatedFile, mode: file.mode };
    })
  };
}

function renderTemplate(content: string, variables: Record<string, string>): string {
  return content.replaceAll(VARIABLE_PATTERN, (_match, name: string) => variables[name] ?? "");
}
