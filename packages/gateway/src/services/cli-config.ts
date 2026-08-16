import { homedir } from "node:os";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import type { AdapterId } from "./adapter-discovery.js";
import {
  findCliConfigField,
  listCliConfigFields,
  validateCliConfigFieldValue
} from "./cli-config-fields.js";

export interface CliConfigFileEntry {
  relativePath: string;
  fileType: string;
  exists: boolean;
  content: string;
  redacted: boolean;
  sizeBytes: number;
}

export interface CliProviderEntry {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  hasApiKey: boolean;
  envKey?: string | undefined;
  isActive: boolean;
}

export interface CliModelEntry {
  alias: string;
  provider: string;
  modelId: string;
}

export interface CliConfigSnapshot {
  adapter: AdapterId;
  configRoot: string;
  configFile: string;
  files: CliConfigFileEntry[];
  providers: CliProviderEntry[];
  models: CliModelEntry[];
  defaultModel: string;
}

export interface CliProviderInput {
  name?: string | undefined;
  protocol?: string | undefined;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  envKey?: string | undefined;
}

const maxConfigFileBytes = 128 * 1024;
const maxConfigWriteBytes = 128 * 1024;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const aliasPattern = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/u;

interface CliConfigMeta {
  mainFile: string;
  editableFiles: string[];
  fileType: "json" | "toml";
  configRoot: () => string;
}

const cliConfigMeta: Record<AdapterId, CliConfigMeta> = {
  claude: {
    mainFile: "settings.json",
    editableFiles: ["settings.json"],
    fileType: "json",
    configRoot: () => process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude")
  },
  opencode: {
    mainFile: "opencode.json",
    editableFiles: ["opencode.json", "opencode.jsonc", "AGENTS.md"],
    fileType: "json",
    configRoot: () =>
      process.env.OPENCODE_CONFIG_DIR?.trim() ||
      path.join(process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config"), "opencode")
  },
  codex: {
    mainFile: "config.toml",
    editableFiles: ["config.toml", "AGENTS.md"],
    fileType: "toml",
    configRoot: () => process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex")
  },
  kimi: {
    mainFile: "config.toml",
    editableFiles: ["config.toml", "mcp.json", "AGENTS.md"],
    fileType: "toml",
    configRoot: () => process.env.KIMI_CODE_HOME?.trim() || path.join(homedir(), ".kimi-code")
  }
};

export function listCliConfigAdapters(): Array<{ adapter: AdapterId; configFile: string; configRoot: string }> {
  return (Object.keys(cliConfigMeta) as AdapterId[]).map((adapter) => ({
    adapter,
    configFile: cliConfigMeta[adapter].mainFile,
    configRoot: cliConfigMeta[adapter].configRoot()
  }));
}

export async function readCliConfig(adapter: AdapterId): Promise<CliConfigSnapshot> {
  const meta = cliConfigMeta[adapter];
  const root = meta.configRoot();
  const files = await Promise.all(
    meta.editableFiles.map((relativePath) => readConfigFile(root, relativePath, { reveal: false }))
  );
  const parsed = await parseMainConfig(adapter);

  return {
    adapter,
    configRoot: root,
    configFile: meta.mainFile,
    files,
    providers: parsed.providers,
    models: parsed.models,
    defaultModel: parsed.defaultModel
  };
}

export async function readCliConfigFile(
  adapter: AdapterId,
  relativePath: string,
  reveal: boolean
): Promise<CliConfigFileEntry> {
  assertEditableFile(adapter, relativePath);
  return readConfigFile(cliConfigMeta[adapter].configRoot(), relativePath, { reveal });
}

export async function writeCliConfigFile(
  adapter: AdapterId,
  relativePath: string,
  content: string
): Promise<CliConfigSnapshot> {
  assertEditableFile(adapter, relativePath);
  assertWriteSize(content);
  const root = cliConfigMeta[adapter].configRoot();
  await writeConfigFile(root, relativePath, content);
  return readCliConfig(adapter);
}

export async function upsertCliProvider(
  adapter: AdapterId,
  providerId: string,
  input: CliProviderInput
): Promise<CliConfigSnapshot> {
  assertValidId(providerId, "provider id");
  switch (adapter) {
    case "claude":
      return mutateClaudeConfig((doc) => {
        if (providerId !== "anthropic") {
          throw new Error("Claude Code settings support a single Anthropic endpoint");
        }
        const env = ensureRecord(doc, "env");
        if (input.baseUrl !== undefined) env.ANTHROPIC_BASE_URL = input.baseUrl;
        if (input.apiKey) env.ANTHROPIC_AUTH_TOKEN = input.apiKey;
      });
    case "opencode":
      return mutateOpenCodeConfig((doc) => {
        const providers = ensureRecord(doc, "provider");
        const existing = asRecord(providers[providerId]);
        const existingOptions = asRecord(existing?.options);
        const options: Record<string, unknown> = { ...existingOptions };
        if (input.baseUrl !== undefined) options.baseURL = input.baseUrl;
        if (input.apiKey) options.apiKey = input.apiKey;
        providers[providerId] = {
          ...existing,
          npm: input.protocol ?? existing?.npm ?? "@ai-sdk/openai-compatible",
          name: input.name ?? existing?.name ?? providerId,
          options
        };
      });
    case "codex":
      return mutateCodexConfig((doc) => {
        const providers = ensureRecord(doc, "model_providers");
        const existing = asRecord(providers[providerId]);
        providers[providerId] = {
          ...existing,
          name: input.name ?? existing?.name ?? providerId,
          base_url: input.baseUrl ?? existing?.base_url ?? "",
          env_key: input.envKey ?? existing?.env_key ?? "",
          wire_api: input.protocol ?? existing?.wire_api ?? "chat"
        };
      });
    case "kimi":
      return mutateKimiConfig((doc) => {
        const providers = ensureRecord(doc, "providers");
        const existing = asRecord(providers[providerId]);
        const next: Record<string, unknown> = {
          ...existing,
          type: input.protocol ?? existing?.type ?? "kimi"
        };
        if (input.baseUrl !== undefined) next.base_url = input.baseUrl;
        if (input.apiKey) next.api_key = input.apiKey;
        providers[providerId] = next;
      });
  }
}

export async function removeCliProvider(adapter: AdapterId, providerId: string): Promise<CliConfigSnapshot> {
  assertValidId(providerId, "provider id");
  switch (adapter) {
    case "claude":
      return mutateClaudeConfig((doc) => {
        const env = asRecord(doc.env);
        if (!env) return;
        delete env.ANTHROPIC_BASE_URL;
        delete env.ANTHROPIC_AUTH_TOKEN;
      });
    case "opencode":
      return mutateOpenCodeConfig((doc) => {
        const providers = asRecord(doc.provider);
        if (!providers) return;
        delete providers[providerId];
        if (typeof doc.model === "string" && doc.model.startsWith(`${providerId}/`)) {
          delete doc.model;
        }
      });
    case "codex":
      return mutateCodexConfig((doc) => {
        const providers = asRecord(doc.model_providers);
        if (!providers) return;
        delete providers[providerId];
        if (doc.model_provider === providerId) {
          delete doc.model_provider;
        }
      });
    case "kimi":
      return mutateKimiConfig((doc) => {
        const providers = asRecord(doc.providers);
        if (!providers) return;
        delete providers[providerId];
        const models = asRecord(doc.models);
        const removedAliases: string[] = [];
        if (models) {
          for (const [alias, entry] of Object.entries(models)) {
            if (asRecord(entry)?.provider === providerId) {
              delete models[alias];
              removedAliases.push(alias);
            }
          }
        }
        if (typeof doc.default_model === "string" && removedAliases.includes(doc.default_model)) {
          delete doc.default_model;
        }
      });
  }
}

export async function upsertCliModel(
  adapter: AdapterId,
  alias: string,
  input: { provider: string; modelId: string }
): Promise<CliConfigSnapshot> {
  assertValidAlias(alias);
  if (adapter !== "kimi") {
    throw new Error(`Model entries are only supported for the Kimi Code config; use default-model for ${adapter}`);
  }
  assertValidId(input.provider, "provider id");
  if (!input.modelId.trim()) {
    throw new Error("modelId is required");
  }
  return mutateKimiConfig((doc) => {
    const models = ensureRecord(doc, "models");
    const existing = asRecord(models[alias]);
    models[alias] = { ...existing, provider: input.provider, model: input.modelId };
  });
}

export async function removeCliModel(adapter: AdapterId, alias: string): Promise<CliConfigSnapshot> {
  assertValidAlias(alias);
  if (adapter !== "kimi") {
    throw new Error(`Model entries are only supported for the Kimi Code config; use default-model for ${adapter}`);
  }
  return mutateKimiConfig((doc) => {
    const models = asRecord(doc.models);
    if (!models) return;
    delete models[alias];
    if (doc.default_model === alias) {
      delete doc.default_model;
    }
  });
}

export async function setCliDefaultModel(
  adapter: AdapterId,
  model: string,
  providerId?: string
): Promise<CliConfigSnapshot> {
  if (!model.trim()) {
    throw new Error("model is required");
  }
  switch (adapter) {
    case "claude":
      return mutateClaudeConfig((doc) => {
        ensureRecord(doc, "env").ANTHROPIC_MODEL = model;
      });
    case "opencode":
      return mutateOpenCodeConfig((doc) => {
        doc.model = model;
      });
    case "codex":
      return mutateCodexConfig((doc) => {
        doc.model = model;
        if (providerId) {
          assertValidId(providerId, "provider id");
          doc.model_provider = providerId;
        }
      });
    case "kimi":
      return mutateKimiConfig((doc) => {
        doc.default_model = model;
      });
  }
}

export async function readCliConfigFieldValues(adapter: AdapterId): Promise<Record<string, unknown>> {
  const meta = cliConfigMeta[adapter];
  const content = await readFileIfExists(meta.configRoot(), meta.mainFile);
  const doc = content !== undefined && content.trim() ? parseConfigDoc(meta.fileType, content) : {};
  const values: Record<string, unknown> = {};
  for (const field of listCliConfigFields(adapter)) {
    const raw = getFieldAtPath(doc, field.path);
    if (field.type === "secret") {
      values[field.key] = typeof raw === "string" && raw.length > 0;
      continue;
    }
    if (raw !== undefined) values[field.key] = raw;
  }
  return values;
}

export async function applyCliConfigFieldPatch(
  adapter: AdapterId,
  updates: Record<string, unknown>
): Promise<CliConfigSnapshot> {
  const entries = validateFieldUpdates(adapter, updates);
  // An empty patch must not rewrite (and reformat) the file: TOML round-trips
  // drop comments, so a no-op write would still destroy hand-written content.
  if (entries.length === 0) return readCliConfig(adapter);
  return mutateMainConfig(adapter, (doc) => {
    for (const [key, value] of entries) {
      const field = findCliConfigField(adapter, key);
      if (!field) continue;
      if (value === null) deleteFieldAtPath(doc, field.path);
      else setFieldAtPath(doc, field.path, value);
    }
  });
}

function validateFieldUpdates(adapter: AdapterId, updates: Record<string, unknown>): Array<[string, unknown]> {
  const entries = Object.entries(updates);
  for (const [key, value] of entries) {
    const field = findCliConfigField(adapter, key);
    if (!field) {
      const legal = listCliConfigFields(adapter).map((item) => item.key).join(", ");
      throw new Error(`Unknown ${adapter} config field: ${key}. Supported fields: ${legal}`);
    }
    const error = validateCliConfigFieldValue(field, value);
    if (error) throw new Error(error);
  }
  return entries;
}

function fieldPathSegments(fieldPath: string): string[] {
  return fieldPath.split(".");
}

function getFieldAtPath(doc: ConfigDoc, fieldPath: string): unknown {
  const segments = fieldPathSegments(fieldPath);
  const leaf = segments[segments.length - 1];
  if (leaf === undefined) return undefined;
  let current: Record<string, unknown> | undefined = doc;
  for (const segment of segments.slice(0, -1)) {
    if (!current) break;
    current = asRecord(current[segment]);
  }
  return current?.[leaf];
}

function setFieldAtPath(doc: ConfigDoc, fieldPath: string, value: unknown): void {
  const segments = fieldPathSegments(fieldPath);
  const leaf = segments[segments.length - 1];
  if (leaf === undefined) return;
  let current = doc;
  for (const segment of segments.slice(0, -1)) {
    current = ensureRecord(current, segment);
  }
  current[leaf] = value;
}

function deleteFieldAtPath(doc: ConfigDoc, fieldPath: string): void {
  const segments = fieldPathSegments(fieldPath);
  const leaf = segments[segments.length - 1];
  if (leaf === undefined) return;
  let current: Record<string, unknown> | undefined = doc;
  for (const segment of segments.slice(0, -1)) {
    if (!current) break;
    current = asRecord(current[segment]);
  }
  delete current?.[leaf];
}

type ConfigDoc = Record<string, unknown>;

async function parseMainConfig(adapter: AdapterId): Promise<{
  providers: CliProviderEntry[];
  models: CliModelEntry[];
  defaultModel: string;
}> {
  const meta = cliConfigMeta[adapter];
  const root = meta.configRoot();
  const content = await readFileIfExists(root, meta.mainFile);
  if (content === undefined || !content.trim()) {
    return { providers: [], models: [], defaultModel: "" };
  }
  const doc = parseConfigDoc(meta.fileType, content);
  if (adapter === "claude") return describeClaude(doc);
  if (adapter === "opencode") return describeOpenCode(doc);
  if (adapter === "codex") return describeCodex(doc);
  return describeKimi(doc);
}

function describeClaude(doc: ConfigDoc) {
  const env = asRecord(doc.env) ?? {};
  const baseUrl = stringValue(env.ANTHROPIC_BASE_URL);
  const hasApiKey = Boolean(stringValue(env.ANTHROPIC_AUTH_TOKEN));
  const defaultModel = stringValue(env.ANTHROPIC_MODEL);
  const providers: CliProviderEntry[] = baseUrl || hasApiKey
    ? [{ id: "anthropic", name: "Anthropic", protocol: "anthropic", baseUrl, hasApiKey, isActive: true }]
    : [];
  return { providers, models: [], defaultModel };
}

function describeOpenCode(doc: ConfigDoc) {
  const activeModel = stringValue(doc.model);
  const providers = Object.entries(asRecord(doc.provider) ?? {}).map(([id, value]) => {
    const entry = asRecord(value) ?? {};
    const options = asRecord(entry.options) ?? {};
    return {
      id,
      name: stringValue(entry.name) || id,
      protocol: stringValue(entry.npm),
      baseUrl: stringValue(options.baseURL),
      hasApiKey: Boolean(stringValue(options.apiKey)),
      isActive: activeModel.startsWith(`${id}/`)
    };
  });
  const models: CliModelEntry[] = [];
  for (const [id, value] of Object.entries(asRecord(doc.provider) ?? {})) {
    for (const modelId of Object.keys(asRecord(asRecord(value)?.models) ?? {})) {
      models.push({ alias: `${id}/${modelId}`, provider: id, modelId });
    }
  }
  return { providers, models, defaultModel: activeModel };
}

function describeCodex(doc: ConfigDoc) {
  const activeProvider = stringValue(doc.model_provider);
  const providers = Object.entries(asRecord(doc.model_providers) ?? {}).map(([id, value]) => {
    const entry = asRecord(value) ?? {};
    return {
      id,
      name: stringValue(entry.name) || id,
      protocol: stringValue(entry.wire_api),
      baseUrl: stringValue(entry.base_url),
      hasApiKey: false,
      envKey: stringValue(entry.env_key),
      isActive: id === activeProvider
    };
  });
  return { providers, models: [], defaultModel: stringValue(doc.model) };
}

function describeKimi(doc: ConfigDoc) {
  const defaultModel = stringValue(doc.default_model);
  const models = Object.entries(asRecord(doc.models) ?? {}).map(([alias, value]) => {
    const entry = asRecord(value) ?? {};
    return { alias, provider: stringValue(entry.provider), modelId: stringValue(entry.model) };
  });
  const activeProvider = models.find((model) => model.alias === defaultModel)?.provider ?? "";
  const providers = Object.entries(asRecord(doc.providers) ?? {}).map(([id, value]) => {
    const entry = asRecord(value) ?? {};
    return {
      id,
      name: id,
      protocol: stringValue(entry.type),
      baseUrl: stringValue(entry.base_url),
      hasApiKey: Boolean(stringValue(entry.api_key)),
      isActive: id === activeProvider
    };
  });
  return { providers, models, defaultModel };
}

async function mutateClaudeConfig(mutate: (doc: ConfigDoc) => void): Promise<CliConfigSnapshot> {
  return mutateMainConfig("claude", mutate);
}

async function mutateOpenCodeConfig(mutate: (doc: ConfigDoc) => void): Promise<CliConfigSnapshot> {
  return mutateMainConfig("opencode", mutate);
}

async function mutateCodexConfig(mutate: (doc: ConfigDoc) => void): Promise<CliConfigSnapshot> {
  return mutateMainConfig("codex", mutate);
}

async function mutateKimiConfig(mutate: (doc: ConfigDoc) => void): Promise<CliConfigSnapshot> {
  return mutateMainConfig("kimi", mutate);
}

async function mutateMainConfig(adapter: AdapterId, mutate: (doc: ConfigDoc) => void): Promise<CliConfigSnapshot> {
  const meta = cliConfigMeta[adapter];
  const root = meta.configRoot();
  const content = await readFileIfExists(root, meta.mainFile);
  const doc = content !== undefined && content.trim() ? parseConfigDoc(meta.fileType, content) : {};
  mutate(doc);
  const serialized = meta.fileType === "json"
    ? `${JSON.stringify(doc, null, 2)}\n`
    : stringifyToml(doc);
  await writeConfigFile(root, meta.mainFile, serialized);
  return readCliConfig(adapter);
}

function parseConfigDoc(fileType: "json" | "toml", content: string): ConfigDoc {
  try {
    const parsed = fileType === "json" ? JSON.parse(content) : parseToml(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Config root must be an object");
    }
    return parsed as ConfigDoc;
  } catch (error) {
    const label = fileType === "json" ? "JSON" : "TOML";
    throw new Error(`Global config file is not valid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readConfigFile(
  root: string,
  relativePath: string,
  options: { reveal: boolean }
): Promise<CliConfigFileEntry> {
  const base = {
    relativePath,
    fileType: fileTypeFor(relativePath),
    redacted: false
  };
  const absolutePath = path.join(root, relativePath);
  const fileStat = await statFile(absolutePath);
  if (!fileStat) {
    return { ...base, exists: false, content: "", sizeBytes: 0 };
  }
  if (fileStat.size > maxConfigFileBytes) {
    return { ...base, exists: true, content: "", sizeBytes: fileStat.size };
  }
  const content = await readFile(absolutePath, "utf8");
  return {
    ...base,
    exists: true,
    content: options.reveal ? content : redactSensitiveContent(content),
    redacted: !options.reveal,
    sizeBytes: fileStat.size
  };
}

async function readFileIfExists(root: string, relativePath: string): Promise<string | undefined> {
  const absolutePath = path.join(root, relativePath);
  if (!(await statFile(absolutePath))) return undefined;
  return readFile(absolutePath, "utf8");
}

async function writeConfigFile(root: string, relativePath: string, content: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, relativePath), content, { encoding: "utf8", mode: 0o600 });
}

async function statFile(absolutePath: string): Promise<{ size: number } | undefined> {
  try {
    const fileStat = await stat(absolutePath);
    return fileStat.isFile() ? { size: fileStat.size } : undefined;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function assertEditableFile(adapter: AdapterId, relativePath: string): void {
  if (relativePath.includes("/") || relativePath.includes("\\") || relativePath.includes("..")) {
    throw new Error("Unsupported config file path");
  }
  if (!cliConfigMeta[adapter].editableFiles.includes(relativePath)) {
    throw new Error(`Unsupported ${adapter} config file: ${relativePath}`);
  }
}

function assertWriteSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > maxConfigWriteBytes) {
    throw new Error(`Config file exceeds maximum size: ${maxConfigWriteBytes} bytes`);
  }
}

function assertValidId(value: string, label: string): void {
  if (!idPattern.test(value)) {
    throw new Error(`Invalid ${label}: use letters, digits, dash, or underscore`);
  }
}

function assertValidAlias(value: string): void {
  if (!aliasPattern.test(value)) {
    throw new Error("Invalid model alias: use letters, digits, dash, underscore, dot, or slash");
  }
}

function ensureRecord(doc: ConfigDoc, key: string): Record<string, unknown> {
  const existing = asRecord(doc[key]);
  if (existing) return existing;
  const created: Record<string, unknown> = {};
  doc[key] = created;
  return created;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fileTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md") return "markdown";
  if (extension === ".json" || extension === ".jsonc") return "json";
  if (extension === ".toml") return "toml";
  return "text";
}

function redactSensitiveContent(content: string): string {
  return content
    .replace(/("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*")[^"]*(")/giu, "$1[REDACTED]$2")
    .replace(/^(\s*(?:api[_-]?key|token|secret|password|authorization)\s*=\s*).+$/gimu, "$1\"[REDACTED]\"")
    .replace(/((?:sk|pk|rk)-[A-Za-z0-9_-]{8,})/gu, "[REDACTED]");
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
