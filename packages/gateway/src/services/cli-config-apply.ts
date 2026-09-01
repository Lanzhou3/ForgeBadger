import { chmodSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { decryptSecret, encryptSecret, type EncryptedSecret } from "../crypto/secret-box.js";
import type { Database } from "../db/types.js";
import {
  ModelProviderRepository,
  type ModelProfile,
  type ProviderCredentialSummary,
  type ProviderProfile
} from "../db/repositories/model-provider-repository.js";
import type { AdapterId } from "./adapter-discovery.js";
import {
  atomicWriteConfig,
  fsyncFile,
  readObservedConfig,
  restoreObservedConfig,
  safeUnlink
} from "./cli-config-fs.js";
import { cliConfigTargetPath, globalConfigRoot } from "./cli-config-target.js";
import {
  assertResolvedPublicHttpsEndpoint,
  type OutboundHostResolver
} from "./network-policy.js";

const backupMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const inProcessLocks = new Map<string, Promise<void>>();

export class CliConfigApplyError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
  }
}

export interface CliConfigApplyInput {
  db: Database;
  userId: string;
  masterKey: string;
  adapter: AdapterId;
  providerProfileId: string;
  modelProfileId?: string | undefined;
  credentialId?: string | undefined;
  resolveHost?: OutboundHostResolver | undefined;
}

export interface CliConfigApplyFilePreview {
  targetPath: string;
  fileType: "json" | "toml";
  operation: "create" | "update" | "none";
  /** Observed content with credential values masked; null when the file does not exist. */
  current: string | null;
  /** Proposed content with credential values masked. */
  proposed: string;
  changedFields: string[];
}

export interface CliConfigApplyPreview {
  adapter: AdapterId;
  providerProfileId: string;
  modelProfileId: string;
  credentialId: string;
  files: CliConfigApplyFilePreview[];
  warnings: string[];
}

export interface CliConfigApplyResult {
  adapter: AdapterId;
  backupId: string;
  changed: boolean;
  files: Array<{ targetPath: string; operation: "create" | "update" | "none" }>;
}

export interface CliConfigRollbackResult {
  adapter: AdapterId;
  backupId: string;
  restoredFiles: string[];
}

interface ApplyContext {
  adapter: AdapterId;
  provider: ProviderProfile;
  model: ModelProfile;
  credential: ProviderCredentialSummary;
  providerKey: string;
  baseUrl: string | null;
}

interface ApplyTarget {
  targetPath: string;
  fileType: "json" | "toml";
  role: "config" | "auth";
}

/** Dry-run: resolves the selection, SSRF-checks the endpoint, and diffs without touching disk. */
export async function previewCliConfigApply(input: CliConfigApplyInput): Promise<CliConfigApplyPreview> {
  const context = await resolveApplyContext(input);
  const warnings: string[] = [];
  const files = planApplyDocuments(context, null).map((plan) => {
    const observed = readObservedConfig(plan.target.targetPath);
    const current = observed.existed
      ? maskSecrets(plan.target, serializeDocument(plan.target.fileType, parseDocument(plan.target.fileType, observed.content, plan.target.targetPath)))
      : null;
    const proposed = maskSecrets(plan.target, plan.serialized);
    return {
      targetPath: plan.target.targetPath,
      fileType: plan.target.fileType,
      operation: (!observed.existed ? "create" : observed.content === plan.serialized ? "none" : "update") as "create" | "update" | "none",
      current,
      proposed,
      changedFields: diffDocuments(plan.target.fileType, observed.content, plan.serialized)
    };
  });
  if (files.some((file) => file.fileType === "toml" && file.operation !== "none")) {
    warnings.push("Applying this change may normalize TOML comments and formatting in the config file.");
  }
  return {
    adapter: context.adapter,
    providerProfileId: context.provider.id,
    modelProfileId: context.model.id,
    credentialId: context.credential.id,
    files,
    warnings
  };
}

/**
 * Applies the selected provider/model/credential to the adapter's global CLI
 * config with plaintext credentials (cc-switch semantics): encrypted backup
 * first, then atomic 0600 writes with read-back verification. A failure on a
 * later file (Codex auth.json) rolls back the files already written.
 */
export async function applyCliConfigToAdapter(input: CliConfigApplyInput): Promise<CliConfigApplyResult> {
  const context = await resolveApplyContext(input);
  const secret = new ModelProviderRepository(input.db, input.userId, input.masterKey)
    .decryptCredential(context.credential.id);
  const primaryTarget = cliConfigTargetPath({ adapter: context.adapter, scope: "global" });
  return withInProcessLock(primaryTarget, async () => {
    const targets = applyTargets(context.adapter);
    // Plan, write, and verify one file at a time so a failure on a later file
    // (e.g. Codex auth.json) still has in-memory observed state to roll back.
    const planned: Array<{ target: ApplyTarget; observed: { existed: boolean; content: string }; serialized: string }> = [];
    const backupFiles: Array<{ targetPath: string; existed: boolean; content: string }> = [];
    for (const target of targets) {
      const observed = readObservedConfig(target.targetPath);
      const doc = parseDocument(target.fileType, observed.content, target.targetPath);
      buildApplyDocument(context, target, doc, secret);
      planned.push({ target, observed, serialized: serializeDocument(target.fileType, doc) });
      backupFiles.push({ targetPath: target.targetPath, existed: observed.existed, content: observed.content });
    }
    const changed = planned.some(({ observed, serialized }) => !observed.existed || observed.content !== serialized);
    const backupId = writeApplyBackup(context.adapter, backupFiles, input.masterKey);
    const written: Array<{ targetPath: string; existed: boolean; content: string }> = [];
    try {
      for (const { target, observed, serialized } of planned) {
        if (observed.existed && observed.content === serialized) continue;
        atomicWriteConfig(target.targetPath, serialized);
        const reread = readObservedConfig(target.targetPath);
        if (reread.content !== serialized) {
          throw new CliConfigApplyError("CLI_CONFIG_APPLY_VERIFY_FAILED", "CLI config read-back verification failed");
        }
        written.push({ targetPath: target.targetPath, existed: observed.existed, content: observed.content });
      }
    } catch (error) {
      for (const entry of written.reverse()) {
        try {
          restoreObservedConfig(entry.targetPath, { existed: entry.existed, content: entry.content });
        } catch { /* best-effort rollback; the encrypted backup remains */ }
      }
      if (error instanceof CliConfigApplyError) throw error;
      throw new CliConfigApplyError(
        "CLI_CONFIG_APPLY_FAILED",
        error instanceof Error ? error.message : "CLI config apply failed"
      );
    }
    return {
      adapter: context.adapter,
      backupId,
      changed,
      files: planned.map(({ target, observed, serialized }) => ({
        targetPath: target.targetPath,
        operation: (!observed.existed ? "create" : observed.content === serialized ? "none" : "update") as "create" | "update" | "none"
      }))
    };
  });
}

/** Restores the named (or most recent) encrypted backup for the adapter. */
export function rollbackCliConfigApply(input: {
  masterKey: string;
  adapter: AdapterId;
  backupId?: string | undefined;
}): CliConfigRollbackResult {
  const dir = backupDir(input.adapter);
  const backupId = input.backupId ?? latestBackupId(dir);
  if (!backupId) throw new CliConfigApplyError("CLI_CONFIG_BACKUP_NOT_FOUND", "No CLI config backup is available");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json\.enc$/u.test(backupId) || backupId.includes("..")) {
    throw new CliConfigApplyError("CLI_CONFIG_BACKUP_NOT_FOUND", "Invalid CLI config backup id");
  }
  const backupPath = path.join(dir, backupId);
  let encrypted: EncryptedSecret;
  try {
    encrypted = JSON.parse(readObservedConfig(backupPath).content) as EncryptedSecret;
  } catch {
    throw new CliConfigApplyError("CLI_CONFIG_BACKUP_NOT_FOUND", "CLI config backup is unavailable");
  }
  let backup: { adapter: string; files: Array<{ targetPath: string; existed: boolean; content: string }> };
  try {
    backup = JSON.parse(decryptSecret(encrypted, { key: input.masterKey })) as typeof backup;
  } catch {
    throw new CliConfigApplyError("CLI_CONFIG_BACKUP_INVALID", "CLI config backup cannot be decrypted");
  }
  if (backup.adapter !== input.adapter || !Array.isArray(backup.files)) {
    throw new CliConfigApplyError("CLI_CONFIG_BACKUP_INVALID", "CLI config backup does not match the adapter");
  }
  const primaryTarget = cliConfigTargetPath({ adapter: input.adapter, scope: "global" });
  const allowedTargets = new Set(applyTargets(input.adapter).map((target) => target.targetPath));
  const restoredFiles: string[] = [];
  const restored: Array<{ targetPath: string; existed: boolean; content: string }> = [];
  try {
    for (const file of backup.files) {
      const targetPath = path.resolve(file.targetPath);
      if (!allowedTargets.has(targetPath) && targetPath !== primaryTarget) {
        throw new CliConfigApplyError("CLI_CONFIG_BACKUP_INVALID", "CLI config backup targets an unexpected path");
      }
      const before = readObservedConfig(targetPath);
      restoreObservedConfig(targetPath, { existed: file.existed, content: file.content });
      restored.push({ targetPath, existed: before.existed, content: before.content });
      restoredFiles.push(targetPath);
    }
  } catch (error) {
    for (const entry of restored.reverse()) {
      try {
        restoreObservedConfig(entry.targetPath, { existed: entry.existed, content: entry.content });
      } catch { /* best-effort */ }
    }
    if (error instanceof CliConfigApplyError) throw error;
    throw new CliConfigApplyError(
      "CLI_CONFIG_ROLLBACK_FAILED",
      error instanceof Error ? error.message : "CLI config rollback failed"
    );
  }
  return { adapter: input.adapter, backupId, restoredFiles };
}

/** Removes encrypted CLI config backups older than the retention window. */
export function cleanupExpiredCliConfigBackups(now = Date.now()): number {
  const root = path.join(stateDir(), "backups", "cli-config");
  let removed = 0;
  let adapterDirs: string[];
  try {
    adapterDirs = readdirSync(root);
  } catch {
    return 0;
  }
  for (const adapterDir of adapterDirs) {
    const dir = path.join(root, adapterDir);
    let entries: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      entries = readdirSync(dir);
    } catch { continue; }
    for (const name of entries) {
      const file = path.join(dir, name);
      try {
        if (now - statSync(file).mtimeMs <= backupMaxAgeMs) continue;
        safeUnlink(file);
        removed += 1;
      } catch { /* a concurrent cleanup won */ }
    }
  }
  return removed;
}

async function resolveApplyContext(input: CliConfigApplyInput): Promise<ApplyContext> {
  const repository = new ModelProviderRepository(input.db, input.userId, input.masterKey);
  const provider = repository.getProviderProfile(input.providerProfileId);
  if (!provider || provider.status !== "active") {
    throw new CliConfigApplyError("CLI_CONFIG_APPLY_PROVIDER_NOT_FOUND", "Provider profile not found");
  }
  if (!provider.supportedAdapters.includes(input.adapter)) {
    throw new CliConfigApplyError("CLI_CONFIG_APPLY_ADAPTER_UNSUPPORTED", "Provider does not support the selected adapter");
  }
  const models = repository.listModelProfiles(provider.id)
    .filter((model) => model.status === "active");
  const model = input.modelProfileId
    ? models.find((entry) => entry.id === input.modelProfileId)
    : models.find((entry) => entry.isDefault) ?? models[0];
  if (!model) {
    throw new CliConfigApplyError("CLI_CONFIG_APPLY_MODEL_NOT_FOUND", "Model profile not found for the provider");
  }
  const credential = input.credentialId
    ? repository.listCredentials(provider.id)
      .find((entry) => entry.status === "active" && entry.id === input.credentialId)
    : repository.getOldestActiveCredential(provider.id);
  if (!credential) {
    throw new CliConfigApplyError("CLI_CONFIG_APPLY_CREDENTIAL_NOT_FOUND", "An active provider credential is required");
  }
  const baseUrl = endpointForAdapter(provider, input.adapter);
  try {
    await assertResolvedPublicHttpsEndpoint(baseUrl, input.resolveHost);
  } catch (error) {
    throw new CliConfigApplyError(
      "CLI_CONFIG_APPLY_ENDPOINT_UNSAFE",
      error instanceof Error ? error.message : "Provider endpoint is not a public HTTPS endpoint"
    );
  }
  return {
    adapter: input.adapter,
    provider,
    model,
    credential,
    providerKey: normalizeProviderKey(provider.providerKey),
    baseUrl
  };
}

interface ApplyDocumentPlan {
  target: ApplyTarget;
  serialized: string;
}

function planApplyDocuments(context: ApplyContext, plaintextSecret: string | null): ApplyDocumentPlan[] {
  const targets = applyTargets(context.adapter);
  return targets.map((target) => {
    const observed = readObservedConfig(target.targetPath);
    const doc = parseDocument(target.fileType, observed.content, target.targetPath);
    buildApplyDocument(context, target, doc, plaintextSecret);
    return { target, serialized: serializeDocument(target.fileType, doc) };
  });
}

function applyTargets(adapter: AdapterId): ApplyTarget[] {
  const main = cliConfigTargetPath({ adapter, scope: "global" });
  if (adapter === "codex") {
    return [
      { targetPath: main, fileType: "toml", role: "config" },
      { targetPath: path.join(globalConfigRoot("codex"), "auth.json"), fileType: "json", role: "auth" }
    ];
  }
  return [{
    targetPath: main,
    fileType: adapter === "claude" || adapter === "opencode" ? "json" : "toml",
    role: "config"
  }];
}

function buildApplyDocument(
  context: ApplyContext,
  target: ApplyTarget,
  doc: Record<string, unknown>,
  plaintextSecret: string | null
): void {
  const secret = plaintextSecret ?? "__FORGEBADGER_APPLY_PREVIEW__";
  if (context.adapter === "claude") {
    const env = record(doc.env);
    if (context.baseUrl) env.ANTHROPIC_BASE_URL = context.baseUrl;
    else delete env.ANTHROPIC_BASE_URL;
    env.ANTHROPIC_AUTH_TOKEN = secret;
    env.ANTHROPIC_MODEL = context.model.modelId;
    env.ANTHROPIC_SMALL_FAST_MODEL = context.model.modelId;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = context.model.modelId;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = context.model.modelId;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = context.model.modelId;
    const timeout = claudeTimeout(context.provider.providerKey);
    if (timeout) env.API_TIMEOUT_MS = timeout;
    else delete env.API_TIMEOUT_MS;
    doc.env = env;
    return;
  }
  if (context.adapter === "codex") {
    if (target.role === "auth") {
      doc.OPENAI_API_KEY = secret;
      return;
    }
    if (!context.baseUrl) {
      throw new CliConfigApplyError("CLI_CONFIG_APPLY_ENDPOINT_UNSAFE", "Codex providers require a base URL");
    }
    doc.model = context.model.modelId;
    doc.model_provider = context.providerKey;
    const providers = record(doc.model_providers);
    providers[context.providerKey] = {
      name: context.provider.name,
      base_url: context.baseUrl,
      wire_api: "responses"
    };
    doc.model_providers = providers;
    return;
  }
  if (context.adapter === "opencode") {
    const providers = record(doc.provider);
    const options: Record<string, unknown> = { apiKey: secret };
    if (context.baseUrl) options.baseURL = context.baseUrl;
    providers[context.providerKey] = {
      npm: context.provider.opencodeNpm ?? openCodePackage(context.provider.apiFormat),
      options
    };
    doc.provider = providers;
    doc.model = `${context.providerKey}/${context.model.modelId}`;
    return;
  }
  const providers = record(doc.providers);
  const definition: Record<string, unknown> = {
    type: context.provider.apiFormat === "anthropic" ? "anthropic" : "openai",
    api_key: secret
  };
  if (context.baseUrl) definition.base_url = context.baseUrl;
  providers[context.providerKey] = definition;
  const alias = `${context.providerKey}/${context.model.modelId}`;
  const models = record(doc.models);
  models[alias] = { provider: context.providerKey, model: context.model.modelId };
  doc.providers = providers;
  doc.models = models;
  doc.default_model = alias;
}

function parseDocument(fileType: "json" | "toml", content: string, targetPath: string): Record<string, unknown> {
  if (!content.trim()) return {};
  try {
    const value = fileType === "json" ? JSON.parse(content) as unknown : parseToml(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid root");
    return value as Record<string, unknown>;
  } catch {
    throw new CliConfigApplyError("CLI_CONFIG_INVALID", `Existing CLI config is not valid ${fileType.toUpperCase()}: ${targetPath}`);
  }
}

function serializeDocument(fileType: "json" | "toml", doc: Record<string, unknown>): string {
  return fileType === "json"
    ? `${JSON.stringify(doc, null, 2)}\n`
    : `${stringifyToml(doc as never).trimEnd()}\n`;
}

/** Masks credential values so previews never surface plaintext secrets. */
function maskSecrets(target: ApplyTarget, content: string): string {
  const doc = parseDocument(target.fileType, content, target.targetPath);
  if (target.role === "auth") {
    maskValue(doc, "OPENAI_API_KEY");
    return serializeDocument(target.fileType, doc);
  }
  maskSecretsDeep(doc);
  return serializeDocument(target.fileType, doc);
}

function maskSecretsDeep(value: Record<string, unknown>): void {
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
    if ((normalized === "apikey" || normalized === "authtoken" || normalized.endsWith("apikey")
      || normalized.endsWith("authtoken"))
      && typeof child === "string" && child.length > 0) {
      value[key] = "[redacted]";
      continue;
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      maskSecretsDeep(child as Record<string, unknown>);
    }
  }
}

function maskValue(doc: Record<string, unknown>, key: string): void {
  if (typeof doc[key] === "string" && (doc[key] as string).length > 0) doc[key] = "[redacted]";
}

function diffDocuments(fileType: "json" | "toml", currentContent: string, proposedContent: string): string[] {
  const current = flattenDocument(parseDocument(fileType, currentContent, ""));
  const proposed = flattenDocument(parseDocument(fileType, proposedContent, ""));
  const changed = new Set<string>();
  for (const key of Object.keys(proposed)) {
    if (!(key in current) || current[key] !== proposed[key]) changed.add(key);
  }
  for (const key of Object.keys(current)) {
    if (!(key in proposed)) changed.add(key);
  }
  return [...changed].sort();
}

function flattenDocument(doc: Record<string, unknown>, prefix = ""): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(doc)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(flat, flattenDocument(value as Record<string, unknown>, pathKey));
    } else {
      flat[pathKey] = JSON.stringify(value) ?? "undefined";
    }
  }
  return flat;
}

function writeApplyBackup(
  adapter: AdapterId,
  files: Array<{ targetPath: string; existed: boolean; content: string }>,
  masterKey: string
): string {
  const dir = backupDir(adapter);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const backupId = `${new Date().toISOString().replace(/[:.]/gu, "-")}.json.enc`;
  const payload = JSON.stringify({ adapter, createdAt: new Date().toISOString(), files });
  const encrypted = encryptSecret(payload, { key: masterKey });
  const backupPath = path.join(dir, backupId);
  writeFileSync(backupPath, JSON.stringify(encrypted), { mode: 0o600, flag: "w" });
  chmodSync(backupPath, 0o600);
  fsyncFile(backupPath);
  return backupId;
}

function backupDir(adapter: AdapterId): string {
  return path.join(stateDir(), "backups", "cli-config", adapter);
}

function latestBackupId(dir: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith(".json.enc"));
  } catch {
    return undefined;
  }
  return entries.sort().at(-1);
}

function stateDir(): string {
  if (process.env.NODE_TEST_CONTEXT) return path.join(tmpdir(), `forgebadger-test-${process.pid}`);
  return path.resolve(process.env.FORGEBADGER_STATE_DIR ?? path.join(homedir(), ".forgebadger"));
}

async function withInProcessLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = inProcessLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const chain = previous.then(() => current);
  inProcessLocks.set(key, chain);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (inProcessLocks.get(key) === chain) inProcessLocks.delete(key);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "provider";
}

function endpointForAdapter(provider: ProviderProfile, adapter: AdapterId): string | null {
  if (adapter === "claude") return provider.anthropicBaseUrl ?? provider.baseUrl;
  if (adapter === "opencode" && provider.apiFormat === "anthropic") {
    return provider.anthropicBaseUrl ?? provider.baseUrl;
  }
  return provider.openaiBaseUrl ?? provider.baseUrl;
}

function openCodePackage(apiFormat: ProviderProfile["apiFormat"]): string {
  if (apiFormat === "openai") return "@ai-sdk/openai";
  if (apiFormat === "anthropic") return "@ai-sdk/anthropic";
  if (apiFormat === "google") return "@ai-sdk/google";
  if (apiFormat === "bedrock") return "@ai-sdk/amazon-bedrock";
  return "@ai-sdk/openai-compatible";
}

function claudeTimeout(providerKey: string): string | undefined {
  const normalized = normalizeProviderKey(providerKey);
  if (normalized === "anthropic") return undefined;
  return normalized === "zai" ? "3000000" : "600000";
}
