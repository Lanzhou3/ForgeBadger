import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { safeResolve, validateProjectRoot } from "../lib/safe-resolve.js";

export type ModelConfigApplyAdapter = "claude" | "opencode" | "codex";

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
  if (adapter !== "claude" && adapter !== "opencode") throw new Error("Unsupported provider apply adapter");
  const projectRoot = validateProjectRoot(input.projectRoot);
  const safeInput = { ...input, projectRoot };

  const plan = adapter === "claude" ? await buildClaudePlan(safeInput) : await buildOpenCodePlan(safeInput);
  const changedFiles = await Promise.all(plan.files.map(async (file) => ({
    relativePath: file.relativePath,
    operation: await fileExists(projectRoot, file.relativePath) ? "update" as const : "create" as const
  })));

  return { ...plan, changedFiles };
}

async function buildClaudePlan(input: ModelConfigApplyInput): Promise<Omit<ModelConfigApplyPreview, "changedFiles">> {
  const settings = await readJsonObject(input.projectRoot, ".claude/settings.local.json");
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
    files: [{ relativePath: ".claude/settings.local.json", content: `${JSON.stringify(merged, null, 2)}\n` }]
  };
}

export async function applyModelProviderConfig(input: ModelConfigApplyInput): Promise<ModelConfigApplyResult> {
  const preview = await previewModelProviderConfig(input);
  const projectRoot = validateProjectRoot(input.projectRoot);
  const backupPath = path.join(
    projectRoot,
    ".openforge",
    "backups",
    "model-provider-apply",
    new Date().toISOString().replace(/[:.]/g, "-")
  );
  await mkdir(backupPath, { recursive: true });

  const written: Array<{ absolutePath: string; backupFile?: string | undefined }> = [];
  try {
    for (const file of preview.files) {
      const absolutePath = safeResolve(projectRoot, file.relativePath);
      const backupFile = await backupExistingFile(projectRoot, backupPath, file.relativePath);
      await atomicWrite(absolutePath, file.content);
      written.push({ absolutePath, backupFile });
    }
  } catch (error) {
    await rollbackWrites(written);
    throw error;
  }

  return { ...preview, backupPath };
}

async function buildOpenCodePlan(input: ModelConfigApplyInput): Promise<Omit<ModelConfigApplyPreview, "changedFiles">> {
  const config = await readJsonObject(input.projectRoot, "opencode.json");
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
    files: [{ relativePath: "opencode.json", content: `${JSON.stringify(merged, null, 2)}\n` }]
  };
}

async function readJsonObject(projectRoot: string, relativePath: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(safeResolve(projectRoot, relativePath), "utf8");
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    return {};
  }
}

async function fileExists(projectRoot: string, relativePath: string): Promise<boolean> {
  try {
    await readFile(safeResolve(projectRoot, relativePath), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function backupExistingFile(projectRoot: string, backupPath: string, relativePath: string): Promise<string | undefined> {
  try {
    const existing = await readFile(safeResolve(projectRoot, relativePath), "utf8");
    const backupFile = path.join(backupPath, relativePath);
    await mkdir(path.dirname(backupFile), { recursive: true });
    await writeFile(backupFile, existing, "utf8");
    return backupFile;
  } catch {
    return undefined;
  }
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
