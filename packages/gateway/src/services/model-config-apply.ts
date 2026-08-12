import { homedir } from "node:os";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { safeResolve, validateProjectRoot } from "../lib/safe-resolve.js";

export type ModelConfigApplyAdapter = "claude" | "opencode" | "codex" | "kimi";
export type ModelConfigApplyScope = "project" | "user-global";

export interface ConfigApplyProvider {
  id: string;
  providerKey: string;
  baseUrl: string | null;
  anthropicBaseUrl?: string | null;
  openaiBaseUrl?: string | null;
  authType: string;
  apiFormat: string;
  opencodeNpm?: string | null;
}

export interface ConfigApplyModel {
  id: string;
  modelId: string;
}

export interface ConfigApplyCredential {
  id: string;
  envName: string;
}

export interface ModelConfigApplyInput {
  projectRoot: string;
  adapter: ModelConfigApplyAdapter;
  scope?: ModelConfigApplyScope | undefined;
  provider: ConfigApplyProvider;
  model: ConfigApplyModel;
  credential?: ConfigApplyCredential | undefined;
}

export interface PlannedConfigFile {
  relativePath: string;
  content: string;
}

export interface ModelConfigApplyPreview {
  adapter: ModelConfigApplyAdapter;
  scope: ModelConfigApplyScope;
  env: Record<string, string>;
  secretEnvNames: string[];
  files: PlannedConfigFile[];
  changedFiles: Array<{ relativePath: string; operation: "create" | "update" }>;
}

export interface ModelConfigApplyResult extends ModelConfigApplyPreview {
  backupPath: string;
}

export async function previewModelProviderConfig(input: ModelConfigApplyInput): Promise<ModelConfigApplyPreview> {
  const adapter = input.adapter as string;
  if (adapter === "codex") {
    throw new Error("Codex provider apply is disabled; Codex uses subscription SDK identity");
  }
  if (adapter !== "claude" && adapter !== "opencode" && adapter !== "kimi") {
    throw new Error("Unsupported provider apply adapter");
  }
  const scope = resolveScope(input.scope);
  const root = resolveApplyRoot({ adapter: input.adapter, scope, projectRoot: input.projectRoot });
  const safeInput = { ...input, projectRoot: root, scope };

  const plan = await buildPlanForAdapter(input.adapter, safeInput);
  const changedFiles = await Promise.all(plan.files.map(async (file) => ({
    relativePath: file.relativePath,
    operation: await fileExists(root, file.relativePath, scope) ? "update" as const : "create" as const
  })));

  return { ...plan, scope, changedFiles };
}

async function buildPlanForAdapter(
  adapter: ModelConfigApplyAdapter,
  input: ModelConfigApplyInput
): Promise<Omit<ModelConfigApplyPreview, "scope" | "changedFiles">> {
  if (adapter === "claude") return buildClaudePlan(input);
  if (adapter === "opencode") return buildOpenCodePlan(input);
  return buildKimiPlan(input);
}

function resolveScope(scope: ModelConfigApplyScope | undefined): ModelConfigApplyScope {
  return scope === "user-global" ? "user-global" : "project";
}

function resolveApplyRoot(input: {
  adapter: ModelConfigApplyAdapter;
  scope: ModelConfigApplyScope;
  projectRoot: string;
}): string {
  if (input.scope !== "user-global") {
    return validateProjectRoot(input.projectRoot);
  }
  return globalConfigRoot(input.adapter);
}

export function globalConfigRoot(adapter: ModelConfigApplyAdapter): string {
  if (adapter === "claude") {
    return process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude");
  }
  if (adapter === "kimi") {
    return process.env.KIMI_CODE_HOME?.trim() || path.join(homedir(), ".kimi-code");
  }
  if (adapter === "codex") {
    return process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
  }
  return process.env.OPENCODE_CONFIG_DIR?.trim()
    || path.join(process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config"), "opencode");
}

function claudeTargetPath(scope: ModelConfigApplyScope): string {
  return scope === "user-global" ? "settings.json" : ".claude/settings.local.json";
}

function opencodeTargetPath(): string {
  return "opencode.json";
}

function kimiTargetPath(scope: ModelConfigApplyScope): string {
  return scope === "user-global" ? "config.toml" : ".kimi-code/config.toml";
}

async function buildKimiPlan(input: ModelConfigApplyInput): Promise<Omit<ModelConfigApplyPreview, "scope" | "changedFiles">> {
  const relativePath = kimiTargetPath(input.scope ?? "project");
  const config = await readObjectFile(input.projectRoot, relativePath, "toml", input.scope ?? "project");
  const providerKey = normalizeKey(input.provider.providerKey);
  const envName = input.credential?.envName ?? `${providerKey.replace(/[^a-z0-9]+/g, "_").toUpperCase()}_API_KEY`;
  const baseUrl = input.provider.openaiBaseUrl ?? input.provider.baseUrl ?? "";
  const existingProviders = isRecord(config.providers) ? config.providers : {};
  const existingModels = isRecord(config.models) ? config.models : {};
  const alias = `${providerKey}/${input.model.modelId}`;

  const next = {
    ...config,
    providers: {
      ...existingProviders,
      [providerKey]: {
        type: input.provider.apiFormat === "anthropic" ? "anthropic" : "openai",
        base_url: baseUrl,
        ...(input.provider.authType === "none" ? {} : { api_key: `{env:${envName}}` })
      }
    },
    models: {
      ...existingModels,
      [alias]: { provider: providerKey, model: input.model.modelId }
    },
    default_model: alias
  };

  return {
    adapter: "kimi",
    env: input.provider.authType === "none" ? {} : { [envName]: "{stored-provider-credential}" },
    secretEnvNames: input.provider.authType === "none" ? [] : [envName],
    files: [{ relativePath, content: `${stringifyToml(next as never)}\n` }]
  };
}

async function buildClaudePlan(input: ModelConfigApplyInput): Promise<Omit<ModelConfigApplyPreview, "scope" | "changedFiles">> {
  const relativePath = claudeTargetPath(input.scope ?? "project");
  const settings = await readObjectFile(input.projectRoot, relativePath, "json", input.scope ?? "project");
  const existingEnv = isRecord(settings.env) ? settings.env : {};
  const envName = input.credential?.envName ?? "ANTHROPIC_AUTH_TOKEN";
  const timeoutMs = timeoutForClaudeProvider(input.provider.providerKey);
  const env = {
    ...existingEnv,
    ...(endpointForAdapter(input.provider, "claude") ? { ANTHROPIC_BASE_URL: endpointForAdapter(input.provider, "claude") as string } : {}),
    ...(input.provider.authType === "none" ? {} : { ANTHROPIC_AUTH_TOKEN: `{env:${envName}}` }),
    ANTHROPIC_MODEL: input.model.modelId,
    ANTHROPIC_SMALL_FAST_MODEL: input.model.modelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: input.model.modelId,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: input.model.modelId,
    ANTHROPIC_DEFAULT_OPUS_MODEL: input.model.modelId,
    ...(timeoutMs ? { API_TIMEOUT_MS: timeoutMs } : {})
  };
  const merged = { ...settings, env };

  return {
    adapter: "claude",
    env: input.provider.authType === "none" ? {} : { [envName]: "{stored-provider-credential}" },
    secretEnvNames: input.provider.authType === "none" ? [] : [envName],
    files: [{ relativePath, content: `${JSON.stringify(merged, null, 2)}\n` }]
  };
}

export async function applyModelProviderConfig(input: ModelConfigApplyInput): Promise<ModelConfigApplyResult> {
  const preview = await previewModelProviderConfig(input);
  const scope = preview.scope;
  const root = resolveApplyRoot({ adapter: preview.adapter, scope, projectRoot: input.projectRoot });
  const backupPath = scope === "user-global"
    ? path.join(homedir(), ".openforge", "backups", "model-provider-apply", new Date().toISOString().replace(/[:.]/g, "-"))
    : path.join(root, ".openforge", "backups", "model-provider-apply", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(backupPath, { recursive: true });

  const written: Array<{ absolutePath: string; backupFile?: string | undefined }> = [];
  try {
    for (const file of preview.files) {
      const absolutePath = resolveTargetPath(root, file.relativePath, scope);
      const backupFile = await backupExistingFile(root, backupPath, file.relativePath, scope);
      await atomicWrite(absolutePath, file.content);
      written.push({ absolutePath, backupFile });
    }
  } catch (error) {
    await rollbackWrites(written);
    throw error;
  }

  return { ...preview, backupPath };
}

async function buildOpenCodePlan(input: ModelConfigApplyInput): Promise<Omit<ModelConfigApplyPreview, "scope" | "changedFiles">> {
  const relativePath = opencodeTargetPath();
  const config = await readObjectFile(input.projectRoot, relativePath, "json", input.scope ?? "project");
  const providerKey = normalizeKey(input.provider.providerKey);
  const envName = input.credential?.envName ?? defaultProviderEnvName(providerKey);
  const providerConfig = {
    npm: input.provider.opencodeNpm ?? opencodePackageFor(input.provider.apiFormat),
    options: {
      ...(endpointForAdapter(input.provider, "opencode") ? { baseURL: endpointForAdapter(input.provider, "opencode") as string } : {}),
      ...(input.provider.authType === "none" ? {} : { apiKey: `{env:${envName}}` })
    }
  };
  const merged = {
    ...config,
    provider: {
      ...(isRecord(config.provider) ? config.provider : {}),
      [providerKey]: providerConfig
    },
    model: formatOpenCodeModel(providerKey, input.model.modelId)
  };

  return {
    adapter: "opencode",
    env: input.provider.authType === "none" ? {} : { [envName]: "{stored-provider-credential}" },
    secretEnvNames: input.provider.authType === "none" ? [] : [envName],
    files: [{ relativePath, content: `${JSON.stringify(merged, null, 2)}\n` }]
  };
}

function resolveTargetPath(root: string, relativePath: string, scope: ModelConfigApplyScope): string {
  if (scope === "user-global") {
    assertSafeGlobalConfigPath(relativePath);
    return path.join(root, relativePath);
  }
  return safeResolve(root, relativePath);
}

function assertSafeGlobalConfigPath(relativePath: string): void {
  if (relativePath.includes("/") || relativePath.includes("\\") || relativePath.includes("..")) {
    throw new Error("Unsupported global config file path");
  }
}

async function readObjectFile(
  projectRoot: string,
  relativePath: string,
  fileType: "json" | "toml",
  scope: ModelConfigApplyScope
): Promise<Record<string, unknown>> {
  try {
    const absolutePath = resolveTargetPath(projectRoot, relativePath, scope);
    const content = await readFile(absolutePath, "utf8");
    const parsed = fileType === "json"
      ? JSON.parse(content) as unknown
      : parseToml(content) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    if (scope !== "user-global" && errorIsMissingOrDenied(error)) return {};
    return {};
  }
}

async function fileExists(projectRoot: string, relativePath: string, scope: ModelConfigApplyScope): Promise<boolean> {
  try {
    await readFile(resolveTargetPath(projectRoot, relativePath, scope), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function backupExistingFile(
  projectRoot: string,
  backupPath: string,
  relativePath: string,
  scope: ModelConfigApplyScope
): Promise<string | undefined> {
  try {
    const existing = await readFile(resolveTargetPath(projectRoot, relativePath, scope), "utf8");
    const backupFile = path.join(backupPath, relativePath);
    await mkdir(path.dirname(backupFile), { recursive: true });
    await writeFile(backupFile, existing, "utf8");
    return backupFile;
  } catch {
    return undefined;
  }
}

function errorIsMissingOrDenied(error: unknown): boolean {
  return !error || typeof error !== "object" || !("code" in error) || (error as { code?: unknown }).code === "ENOENT";
}

async function atomicWrite(absolutePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, absolutePath);
}

async function rollbackWrites(writes: Array<{ absolutePath: string; backupFile?: string | undefined }>): Promise<void> {
  for (const write of writes.reverse()) {
    if (!write.backupFile) continue;
    const backupContent = await readFile(write.backupFile, "utf8");
    await atomicWrite(write.absolutePath, backupContent);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "provider";
}

function defaultProviderEnvName(providerKey: string): string {
  return `${providerKey.replace(/[^a-z0-9]+/g, "_").toUpperCase()}_API_KEY`;
}

function formatOpenCodeModel(providerKey: string, modelId: string): string {
  return modelId.includes("/") ? modelId : `${providerKey}/${modelId}`;
}

function opencodePackageFor(apiFormat: string): string {
  if (apiFormat === "openai") return "@ai-sdk/openai";
  if (apiFormat === "anthropic") return "@ai-sdk/anthropic";
  if (apiFormat === "google") return "@ai-sdk/google";
  if (apiFormat === "bedrock") return "@ai-sdk/amazon-bedrock";
  return "@ai-sdk/openai-compatible";
}

function endpointForAdapter(provider: ConfigApplyProvider, adapter: "claude" | "opencode"): string | null {
  if (adapter === "claude") return provider.anthropicBaseUrl ?? provider.baseUrl;
  if (provider.apiFormat === "anthropic") return provider.anthropicBaseUrl ?? provider.baseUrl;
  return provider.openaiBaseUrl ?? provider.baseUrl;
}

function timeoutForClaudeProvider(providerKey: string): string | undefined {
  const normalized = normalizeKey(providerKey);
  if (normalized === "anthropic") return undefined;
  if (normalized === "zai") return "3000000";
  return "600000";
}
