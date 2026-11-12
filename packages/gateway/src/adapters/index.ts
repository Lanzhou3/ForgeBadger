import { createClaudeLaunchPlan, type CredentialMode, type LaunchPlan } from "./claude.js";
import type { AdapterId } from "../services/adapter-discovery.js";

export interface AdapterModelSelection {
  provider: string;
  modelId: string;
  baseUrl?: string | undefined;
  envName?: string | undefined;
  wireApi?: string | undefined;
}

export interface AdapterLaunchPlanInput {
  adapter: AdapterId;
  projectRoot: string;
  credentialMode: CredentialMode;
  env?: Record<string, string> | undefined;
  secretEnvNames?: string[] | undefined;
  model?: AdapterModelSelection | undefined;
  pluginDirs?: string[] | undefined;
  /**
   * Native CLI session id to resume (claude `--resume`, codex `resume`,
   * opencode/kimi/pi `--session`). Adapters without a resume surface ignore it.
   */
  resumeSessionId?: string | undefined;
}

export function createAdapterLaunchPlan(input: AdapterLaunchPlanInput): LaunchPlan {
  switch (input.adapter) {
    case "claude":
      return createClaudeLaunchPlan({
        projectRoot: input.projectRoot,
        credentialMode: input.credentialMode,
        ...(input.env ? { env: input.env } : {}),
        ...(input.secretEnvNames ? { secretEnvNames: input.secretEnvNames } : {}),
        ...(input.pluginDirs ? { pluginDirs: input.pluginDirs } : {}),
        ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {})
      });
    case "opencode":
      return {
        command: "opencode",
        // --session <id> continues an existing session and creates it if
        // missing, so a stale id degrades to a fresh session instead of failing.
        args: [...resumeArgs("opencode", input.resumeSessionId), ...modelArgs(input.adapter, input.model)],
        cwd: input.projectRoot,
        env: input.env ?? {},
        secretEnvNames: input.secretEnvNames ?? [],
        credentialMode: input.credentialMode
      };
    case "codex":
      return {
        command: "codex",
        // The shared Codex daemon retains its launch environment, including
        // another terminal's hook identity. Keep execution inside this PTY's
        // process tree so hooks inherit this session's id and attach token.
        args: input.resumeSessionId
          ? ["resume", input.resumeSessionId, "--no-daemon", "-c", 'tui.notifications=["approval-requested"]',
            "-c", 'tui.notification_method="osc9"', "-c", 'tui.notification_condition="always"',
            ...modelArgs(input.adapter, input.model)]
          : ["--no-daemon", "-c", 'tui.notifications=["approval-requested"]',
            "-c", 'tui.notification_method="osc9"', "-c", 'tui.notification_condition="always"',
            ...modelArgs(input.adapter, input.model)],
        cwd: input.projectRoot,
        env: input.env ?? {},
        secretEnvNames: input.secretEnvNames ?? [],
        credentialMode: input.credentialMode
      };
    case "kimi":
      return {
        command: "kimi",
        args: [...resumeArgs("kimi", input.resumeSessionId), ...modelArgs(input.adapter, input.model)],
        cwd: input.projectRoot,
        env: input.env ?? {},
        secretEnvNames: input.secretEnvNames ?? [],
        credentialMode: input.credentialMode
      };
    case "pi":
      // Zero-arg launch (host_environment policy, same as Kimi): provider,
      // model, and credential selection live in the applied global config
      // (~/.pi/agent/models.json + settings.json defaultModel/defaultProvider),
      // never in launch-time args/env. `--provider`/`--model`/`--api-key`
      // flags exist in pi but are intentionally not used. `--session <id>`
      // opens a previous session by id when we know one.
      return {
        command: "pi",
        args: resumeArgs("pi", input.resumeSessionId),
        cwd: input.projectRoot,
        env: input.env ?? {},
        secretEnvNames: input.secretEnvNames ?? [],
        credentialMode: input.credentialMode
      };
    case "mcode":
      // Zero-arg launch (host_environment policy, same as Kimi/PI): provider,
      // model, and credential selection live in the applied global
      // config.yaml, never in launch-time args/env. `--model` exists but only
      // under `mcode exec`; the interactive TUI entry accepts no model flag.
      return {
        command: "mcode",
        args: [],
        cwd: input.projectRoot,
        env: input.env ?? {},
        secretEnvNames: input.secretEnvNames ?? [],
        credentialMode: input.credentialMode
      };
    case "grok":
      // Zero-arg interactive TUI. `-p` is a one-shot headless run and
      // `grok agent stdio` is ACP; neither is a Session Server terminal.
      // Model and credential selection live in ~/.grok/config.toml.
      return {
        command: "grok",
        args: [],
        cwd: input.projectRoot,
        env: input.env ?? {},
        secretEnvNames: input.secretEnvNames ?? [],
        credentialMode: input.credentialMode
      };
  }
}

/** Per-adapter native-session resume flags; adapters without a resume
 * surface return nothing. codex uses the `resume` subcommand instead. */
function resumeArgs(adapter: AdapterId, resumeSessionId: string | undefined): string[] {
  if (!resumeSessionId) return [];
  if (adapter === "opencode" || adapter === "kimi" || adapter === "pi") {
    return ["--session", resumeSessionId];
  }
  return [];
}

export function formatAdapterModelId(
  adapter: AdapterId,
  provider: string,
  modelId: string
): string {
  if (adapter === "opencode" && !modelId.includes("/")) {
    return `${provider}/${modelId}`;
  }
  if (adapter === "mcode" && !modelId.startsWith("custom_provider:")) {
    // Custom providers are addressed with the explicit prefix; the bare
    // `<provider>/<model>` form only resolves inside the bundled registry.
    return `custom_provider:${provider}/${modelId}`;
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
    const args = ["-m", modelId, "-c", `model_provider=${JSON.stringify(model.provider)}`];
    if (model.provider !== "openai" && model.baseUrl && model.envName) {
      const prefix = `model_providers.${model.provider}`;
      args.push(
        "-c", `${prefix}.base_url=${JSON.stringify(model.baseUrl)}`,
        "-c", `${prefix}.env_key=${JSON.stringify(model.envName)}`,
        "-c", `${prefix}.wire_api=${JSON.stringify(model.wireApi ?? "responses")}`
      );
    }
    return args;
  }
  return [];
}
