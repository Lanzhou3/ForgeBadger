import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { safeResolve, validateProjectRoot } from "../lib/safe-resolve.js";

export type ModelConfigApplyAdapter = "claude" | "opencode" | "codex";

export interface ConfigApplyProvider {
  id: string;
  providerKey: string;
  baseUrl: string | null;
  authType: string;
  apiFormat: string;
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
  if (input.adapter === "codex") {
    throw new Error("Codex provider apply is disabled; Codex uses subscription SDK identity");
  }
  const projectRoot = validateProjectRoot(input.projectRoot);
  const safeInput = { ...input, projectRoot };

  const plan = safeInput.adapter === "claude"
    ? await buildClaudePlan(safeInput)
    : await buildOpenCodePlan(safeInput);
  const changedFiles = await Promise.all(plan.files.map(async (file) => ({
    relativePath: file.relativePath,
    operation: await fileExists(projectRoot, file.relativePath) ? "update" as const : "create" as const
  })));

  return { ...plan, changedFiles };
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

async function buildClaudePlan(input: ModelConfigApplyInput): Promise<Omit<ModelConfigApplyPreview, "changedFiles">> {
  if (input.provider.apiFormat !== "anthropic") {
    throw new Error("Claude provider apply only supports Anthropic API format");
  }
  const env: Record<string, string> = {
    ANTHROPIC_MODEL: input.model.modelId
  };
  if (input.provider.baseUrl) env.ANTHROPIC_BASE_URL = input.provider.baseUrl;
  const secretEnvNames: string[] = [];
  if (input.credential) {
    const secretName = input.provider.authType === "bearer_token" ? "ANTHROPIC_AUTH_TOKEN" : input.credential.envName;
    env[secretName] = "{stored-provider-credential}";
    secretEnvNames.push(secretName);
  }
  const settings = await readJsonObject(input.projectRoot, ".claude/settings.local.json");
  const merged = {
    ...settings,
    env: {
      ...(isRecord(settings.env) ? settings.env : {}),
      ANTHROPIC_MODEL: input.model.modelId,
      ...(input.provider.baseUrl ? { ANTHROPIC_BASE_URL: input.provider.baseUrl } : {}),
      ...(input.credential ? { [secretEnvNames[0] as string]: `{env:${secretEnvNames[0]}}` } : {})
    }
  };

  return {
    adapter: "claude",
    env,
    secretEnvNames,
    files: [{ relativePath: ".claude/settings.local.json", content: `${JSON.stringify(merged, null, 2)}\n` }]
  };
}

async function buildOpenCodePlan(input: ModelConfigApplyInput): Promise<Omit<ModelConfigApplyPreview, "changedFiles">> {
  const config = await readJsonObject(input.projectRoot, "opencode.json");
  const providerKey = normalizeKey(input.provider.providerKey);
  const envName = input.credential?.envName ?? defaultProviderEnvName(providerKey);
  const providerConfig = {
    npm: opencodePackageFor(input.provider.apiFormat),
    options: {
      ...(input.provider.baseUrl ? { baseURL: input.provider.baseUrl } : {}),
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
