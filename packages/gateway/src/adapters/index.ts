import { createClaudeLaunchPlan, type CredentialMode, type LaunchPlan } from "./claude.js";
import type { AdapterId } from "../services/adapter-discovery.js";

export interface AdapterModelSelection {
  provider: string;
  modelId: string;
}

export interface AdapterLaunchPlanInput {
  adapter: AdapterId;
  projectRoot: string;
  credentialMode: CredentialMode;
  env?: Record<string, string> | undefined;
  secretEnvNames?: string[] | undefined;
  model?: AdapterModelSelection | undefined;
  pluginDirs?: string[] | undefined;
}

export function createAdapterLaunchPlan(input: AdapterLaunchPlanInput): LaunchPlan {
  switch (input.adapter) {
    case "claude":
      return createClaudeLaunchPlan({
        projectRoot: input.projectRoot,
        credentialMode: input.credentialMode,
        ...(input.env ? { env: input.env } : {}),
        ...(input.secretEnvNames ? { secretEnvNames: input.secretEnvNames } : {}),
        ...(input.pluginDirs ? { pluginDirs: input.pluginDirs } : {})
      });
    case "opencode":
      return {
        command: "opencode",
        args: modelArgs(input.adapter, input.model),
        cwd: input.projectRoot,
        env: input.env ?? {},
        secretEnvNames: input.secretEnvNames ?? [],
        credentialMode: input.credentialMode
      };
    case "codex":
      return {
        command: "codex",
        args: modelArgs(input.adapter, input.model),
        cwd: input.projectRoot,
        env: input.env ?? {},
        secretEnvNames: input.secretEnvNames ?? [],
        credentialMode: input.credentialMode
      };
  }
}

export function formatAdapterModelId(
  adapter: AdapterId,
  provider: string,
  modelId: string
): string {
  if (adapter === "opencode" && !modelId.includes("/")) {
    return `${provider}/${modelId}`;
  }
  return modelId;
}

function modelArgs(
  adapter: AdapterId,
  model: AdapterModelSelection | undefined
): string[] {
  if (!model) return [];
  const modelId = formatAdapterModelId(adapter, model.provider, model.modelId);
  if (adapter === "opencode") {
    return ["--model", modelId];
  }
  if (adapter === "codex") {
    return ["-m", modelId];
  }
  return [];
}
