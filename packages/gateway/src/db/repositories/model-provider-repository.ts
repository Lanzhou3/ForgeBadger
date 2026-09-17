import { randomUUID } from "node:crypto";

import type { Database } from "../types.js";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../crypto/secret-box.js";
import { assertPublicHttpsEndpoint } from "../../services/network-policy.js";

export type ProviderAuthType = "api_key" | "bearer_token" | "oauth" | "none";
export type ProviderApiFormat = "anthropic" | "openai" | "openai-compatible" | "google" | "bedrock" | "local";
export type ProviderAdapter = "claude" | "opencode" | "codex" | "kimi";
export type ProviderProductType = "payg_api" | "coding_plan" | "token_plan" | "subscription" | "local";

export interface ProviderProfile {
  id: string;
  userId: string;
  providerKey: string;
  name: string;
  baseUrl: string | null;
  anthropicBaseUrl: string | null;
  openaiBaseUrl: string | null;
  region: string | null;
  productType: ProviderProductType | null;
  authType: ProviderAuthType;
  apiFormat: ProviderApiFormat;
  supportedAdapters: ProviderAdapter[];
  defaultHeaders: Record<string, string>;
  opencodeNpm: string | null;
  allowPlaintextHttp: boolean;
  status: string;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface ModelProfile {
  id: string;
  userId: string;
  providerProfileId: string;
  providerKey: string;
  providerName: string;
  baseUrl: string | null;
  anthropicBaseUrl: string | null;
  openaiBaseUrl: string | null;
  name: string;
  modelId: string;
  capabilities: string[];
  contextWindow: number | null;
  status: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface ProviderCredentialSummary {
  id: string;
  userId: string;
  providerProfileId: string;
  label: string | null;
  status: string;
  generation: number;
  secretPreview: string;
  lastUsedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface CreateProviderProfileInput {
  name: string;
  providerKey: string;
  baseUrl?: string | null;
  anthropicBaseUrl?: string | null;
  openaiBaseUrl?: string | null;
  region?: string | null;
  productType?: ProviderProductType | null;
  authType: ProviderAuthType;
  apiFormat: ProviderApiFormat;
  supportedAdapters: ProviderAdapter[];
  defaultHeaders?: Record<string, string>;
  opencodeNpm?: string | null;
  allowPlaintextHttp?: boolean;
}

export interface CreateModelProfileInput {
  providerProfileId: string;
  name: string;
  modelId: string;
  capabilities?: string[];
  contextWindow?: number | null;
  isDefault?: boolean;
}

export interface UpdateModelProfileInput {
  name?: string;
  modelId?: string;
  capabilities?: string[];
  contextWindow?: number | null;
  isDefault?: boolean;
}

export interface CreateProviderCredentialInput {
  providerProfileId: string;
  label?: string | null;
  plaintextSecret: string;
}

interface ProviderProfileRow {
  id: string;
  user_id: string;
  provider_key: string;
  name: string;
  base_url: string | null;
  anthropic_base_url: string | null;
  openai_base_url: string | null;
  region: string | null;
  product_type: ProviderProductType | null;
  auth_type: ProviderAuthType;
  api_format: ProviderApiFormat;
  supported_adapters: string;
  default_headers: string;
  opencode_npm: string | null;
  allow_plaintext_http: number;
  status: string;
  created_at: number | null;
  updated_at: number | null;
}

interface ModelProfileRow {
  id: string;
  user_id: string;
  provider_profile_id: string;
  provider_key: string;
  provider_name: string;
  base_url: string | null;
  anthropic_base_url: string | null;
  openai_base_url: string | null;
  name: string;
  model_id: string;
  capabilities: string;
  context_window: number | null;
  status: string;
  is_default: number;
  sort_order: number;
  created_at: number | null;
  updated_at: number | null;
}

interface CredentialRow {
  id: string;
  user_id: string;
  provider_profile_id: string;
  label: string | null;
  secret_encrypted: string;
  status: string;
  generation: number;
  last_used_at: number | null;
  created_at: number | null;
  updated_at: number | null;
}

export class ModelProviderRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly masterKey: string
  ) {}

  createProviderProfile(input: CreateProviderProfileInput): ProviderProfile {
    assertProviderEndpointsSafe(input);
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO model_provider_profiles (
        id, user_id, provider_key, name, base_url, anthropic_base_url, openai_base_url,
        region, product_type, auth_type, api_format, supported_adapters, default_headers,
        opencode_npm, allow_plaintext_http, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      this.userId,
      normalizeProviderKey(input.providerKey),
      input.name,
      emptyToNull(input.baseUrl),
      emptyToNull(input.anthropicBaseUrl),
      emptyToNull(input.openaiBaseUrl),
      emptyToNull(input.region),
      input.productType ?? null,
      input.authType,
      input.apiFormat,
      JSON.stringify(normalizeSupportedAdapters(input.supportedAdapters)),
      JSON.stringify(input.defaultHeaders ?? {}),
      emptyToNull(input.opencodeNpm),
      input.allowPlaintextHttp ? 1 : 0,
      now,
      now
    );
    return this.getProviderProfile(id) as ProviderProfile;
  }

  ensureProviderProfile(input: CreateProviderProfileInput): ProviderProfile {
    const existing = this.findProviderProfile(input.providerKey, input.baseUrl);
    if (existing) return existing;
    return this.createProviderProfile(input);
  }

  listProviderProfiles(): ProviderProfile[] {
    const rows = this.db.prepare(`
      SELECT * FROM model_provider_profiles
      WHERE user_id = ?
      ORDER BY name COLLATE NOCASE ASC
    `).all(this.userId) as ProviderProfileRow[];
    return rows.map(toProviderProfile);
  }

  getProviderProfile(id: string): ProviderProfile | undefined {
    const row = this.db.prepare(`
      SELECT * FROM model_provider_profiles
      WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as ProviderProfileRow | undefined;
    return row ? toProviderProfile(row) : undefined;
  }

  findProviderProfile(providerKey: string, baseUrl?: string | null): ProviderProfile | undefined {
    const row = this.db.prepare(`
      SELECT * FROM model_provider_profiles
      WHERE user_id = ? AND provider_key = ? AND ifnull(base_url, '') = ifnull(?, '')
    `).get(this.userId, normalizeProviderKey(providerKey), emptyToNull(baseUrl)) as ProviderProfileRow | undefined;
    return row ? toProviderProfile(row) : undefined;
  }

  updateProviderProfile(id: string, input: Partial<CreateProviderProfileInput>): ProviderProfile | undefined {
    const existing = this.getProviderProfile(id);
    if (!existing) return undefined;
    const next = {
      name: input.name ?? existing.name,
      providerKey: input.providerKey ?? existing.providerKey,
      baseUrl: input.baseUrl === undefined ? existing.baseUrl : input.baseUrl,
      anthropicBaseUrl: input.anthropicBaseUrl === undefined ? existing.anthropicBaseUrl : input.anthropicBaseUrl,
      openaiBaseUrl: input.openaiBaseUrl === undefined ? existing.openaiBaseUrl : input.openaiBaseUrl,
      region: input.region === undefined ? existing.region : input.region,
      productType: input.productType === undefined ? existing.productType : input.productType,
      authType: input.authType ?? existing.authType,
      apiFormat: input.apiFormat ?? existing.apiFormat,
      supportedAdapters: input.supportedAdapters ?? existing.supportedAdapters,
      defaultHeaders: input.defaultHeaders ?? existing.defaultHeaders,
      opencodeNpm: input.opencodeNpm === undefined ? existing.opencodeNpm : input.opencodeNpm,
      allowPlaintextHttp: input.allowPlaintextHttp ?? existing.allowPlaintextHttp
    };
    assertProviderEndpointsSafe(next);
    this.db.prepare(`
      UPDATE model_provider_profiles
      SET provider_key = ?, name = ?, base_url = ?, anthropic_base_url = ?, openai_base_url = ?,
        region = ?, product_type = ?, auth_type = ?, api_format = ?, supported_adapters = ?,
        default_headers = ?, opencode_npm = ?, allow_plaintext_http = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      normalizeProviderKey(next.providerKey),
      next.name,
      emptyToNull(next.baseUrl),
      emptyToNull(next.anthropicBaseUrl),
      emptyToNull(next.openaiBaseUrl),
      emptyToNull(next.region),
      next.productType ?? null,
      next.authType,
      next.apiFormat,
      JSON.stringify(normalizeSupportedAdapters(next.supportedAdapters)),
      JSON.stringify(next.defaultHeaders),
      emptyToNull(next.opencodeNpm),
      next.allowPlaintextHttp ? 1 : 0,
      Date.now(),
      id,
      this.userId
    );
    return this.getProviderProfile(id);
  }

  deleteProviderProfile(id: string): boolean {
    if (!this.getProviderProfile(id)) return false;
    const result = this.db.prepare(`
      DELETE FROM model_provider_profiles WHERE id = ? AND user_id = ?
    `).run(id, this.userId);
    return result.changes > 0;
  }

  createModelProfile(input: CreateModelProfileInput & { id?: string }): ModelProfile {
    const provider = this.getProviderProfile(input.providerProfileId);
    if (!provider) throw new Error("Provider profile not found");
    if (input.isDefault) this.clearDefaultModels();
    const id = input.id ?? randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO model_profiles (
        id, user_id, provider_profile_id, name, model_id, capabilities,
        context_window, status, is_default, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)
    `).run(
      id,
      this.userId,
      input.providerProfileId,
      input.name,
      input.modelId,
      JSON.stringify(input.capabilities ?? []),
      input.contextWindow ?? null,
      input.isDefault ? 1 : 0,
      now,
      now
    );
    return this.getModelProfile(id) as ModelProfile;
  }

  listModelProfiles(providerProfileId?: string): ModelProfile[] {
    const params = providerProfileId ? [this.userId, providerProfileId] : [this.userId];
    const where = providerProfileId ? "mp.user_id = ? AND mp.provider_profile_id = ?" : "mp.user_id = ?";
    const rows = this.db.prepare(`
      SELECT mp.*, mpp.provider_key, mpp.name AS provider_name, mpp.base_url,
        mpp.anthropic_base_url, mpp.openai_base_url
      FROM model_profiles mp
      INNER JOIN model_provider_profiles mpp ON mpp.id = mp.provider_profile_id
      WHERE ${where}
      ORDER BY mp.is_default DESC, mp.sort_order ASC, mp.name COLLATE NOCASE ASC
    `).all(...params) as ModelProfileRow[];
    return rows.map(toModelProfile);
  }

  getModelProfile(id: string): ModelProfile | undefined {
    const row = this.db.prepare(`
      SELECT mp.*, mpp.provider_key, mpp.name AS provider_name, mpp.base_url,
        mpp.anthropic_base_url, mpp.openai_base_url
      FROM model_profiles mp
      INNER JOIN model_provider_profiles mpp ON mpp.id = mp.provider_profile_id
      WHERE mp.id = ? AND mp.user_id = ?
    `).get(id, this.userId) as ModelProfileRow | undefined;
    return row ? toModelProfile(row) : undefined;
  }

  updateModelProfile(id: string, input: UpdateModelProfileInput): ModelProfile | undefined {
    const existing = this.getModelProfile(id);
    if (!existing) return undefined;
    if (input.isDefault) this.clearDefaultModels();
    const now = Date.now();
    const next = {
      name: input.name ?? existing.name,
      modelId: input.modelId ?? existing.modelId,
      capabilities: input.capabilities ?? existing.capabilities,
      contextWindow: input.contextWindow === undefined ? existing.contextWindow : input.contextWindow,
      isDefault: input.isDefault ?? existing.isDefault
    };
    this.db.prepare(`
      UPDATE model_profiles
      SET name = ?, model_id = ?, capabilities = ?, context_window = ?,
        is_default = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      next.name,
      next.modelId,
      JSON.stringify(next.capabilities),
      next.contextWindow ?? null,
      next.isDefault ? 1 : 0,
      now,
      id,
      this.userId
    );
    return this.getModelProfile(id);
  }

  setDefaultModel(id: string): ModelProfile | undefined {
    const existing = this.getModelProfile(id);
    if (!existing) return undefined;
    this.clearDefaultModels();
    const now = Date.now();
    this.db.prepare(`
      UPDATE model_profiles SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(now, id, this.userId);
    return this.getModelProfile(id);
  }

  deleteModelProfile(id: string): boolean {
    const existing = this.getModelProfile(id);
    if (!existing) return false;
    const result = this.db.prepare(`
      DELETE FROM model_profiles WHERE id = ? AND user_id = ?
    `).run(id, this.userId);
    return result.changes > 0;
  }

  createCredential(input: CreateProviderCredentialInput): ProviderCredentialSummary {
    if (!this.getProviderProfile(input.providerProfileId)) {
      throw new Error("Provider profile not found");
    }
    const encrypted = encryptSecret(input.plaintextSecret, { key: this.masterKey });
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO provider_credentials (
        id, user_id, provider_profile_id, label, secret_encrypted, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, this.userId, input.providerProfileId, input.label ?? null, JSON.stringify(encrypted), now, now);
    return this.getCredential(id) as ProviderCredentialSummary;
  }

  listCredentials(providerProfileId?: string): ProviderCredentialSummary[] {
    const params = providerProfileId ? [this.userId, providerProfileId] : [this.userId];
    const where = providerProfileId ? "user_id = ? AND provider_profile_id = ?" : "user_id = ?";
    const rows = this.db.prepare(`
      SELECT * FROM provider_credentials WHERE ${where} ORDER BY created_at DESC
    `).all(...params) as CredentialRow[];
    return rows.map(toCredentialSummary);
  }

  getOldestActiveCredential(providerProfileId: string): ProviderCredentialSummary | undefined {
    const row = this.db.prepare(`
      SELECT * FROM provider_credentials
      WHERE user_id = ? AND provider_profile_id = ? AND status = 'active'
      ORDER BY created_at ASC, rowid ASC
      LIMIT 1
    `).get(this.userId, providerProfileId) as CredentialRow | undefined;
    return row ? toCredentialSummary(row) : undefined;
  }

  getCredential(id: string): ProviderCredentialSummary | undefined {
    const row = this.db.prepare(`
      SELECT * FROM provider_credentials WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as CredentialRow | undefined;
    return row ? toCredentialSummary(row) : undefined;
  }

  rotateCredential(
    id: string,
    input: { plaintextSecret: string; label?: string | null }
  ): ProviderCredentialSummary | undefined {
    const existing = this.getCredential(id);
    if (!existing) return undefined;
    const encrypted = encryptSecret(input.plaintextSecret, { key: this.masterKey });
    this.db.prepare(`
      UPDATE provider_credentials
      SET label = ?, secret_encrypted = ?, status = 'active', generation = generation + 1, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      input.label === undefined ? existing.label : input.label,
      JSON.stringify(encrypted),
      Date.now(),
      id,
      this.userId
    );
    return this.getCredential(id);
  }

  deleteCredential(id: string): "deleted" | "revoked" | "not_found" {
    if (!this.getCredential(id)) return "not_found";
    const result = this.db.prepare(`
      DELETE FROM provider_credentials WHERE id = ? AND user_id = ?
    `).run(id, this.userId);
    return result.changes > 0 ? "deleted" : "not_found";
  }

  decryptCredential(id: string): string {
    const row = this.db.prepare(`
      SELECT * FROM provider_credentials WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as CredentialRow | undefined;
    if (!row) throw new Error("Provider credential not found");
    if (row.status !== "active") throw new Error("Provider credential must be active");
    return decryptSecret(JSON.parse(row.secret_encrypted) as EncryptedSecret, { key: this.masterKey });
  }

  private clearDefaultModels(): void {
    this.db.prepare(`
      UPDATE model_profiles SET is_default = 0, updated_at = ? WHERE user_id = ?
    `).run(Date.now(), this.userId);
  }
}

function assertProviderEndpointsSafe(input: Pick<CreateProviderProfileInput, "authType" | "baseUrl" | "anthropicBaseUrl" | "openaiBaseUrl" | "allowPlaintextHttp">): void {
  if (input.authType === "none") return;
  const endpoints = [input.baseUrl, input.anthropicBaseUrl, input.openaiBaseUrl].filter((value): value is string => Boolean(value));
  if (endpoints.length === 0) throw new Error("Credential-bearing providers require an endpoint");
  for (const endpoint of endpoints) assertPublicHttpsEndpoint(endpoint, { allowPlaintextHttp: input.allowPlaintextHttp });
}

function toProviderProfile(row: ProviderProfileRow): ProviderProfile {
  return {
    id: row.id,
    userId: row.user_id,
    providerKey: row.provider_key,
    name: row.name,
    baseUrl: row.base_url,
    anthropicBaseUrl: row.anthropic_base_url,
    openaiBaseUrl: row.openai_base_url,
    region: row.region,
    productType: row.product_type,
    authType: row.auth_type,
    apiFormat: row.api_format,
    supportedAdapters: normalizeSupportedAdapters(parseJsonArray(row.supported_adapters).filter(isProviderAdapter)),
    defaultHeaders: parseJsonObject(row.default_headers),
    opencodeNpm: row.opencode_npm,
    allowPlaintextHttp: row.allow_plaintext_http === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toModelProfile(row: ModelProfileRow): ModelProfile {
  return {
    id: row.id,
    userId: row.user_id,
    providerProfileId: row.provider_profile_id,
    providerKey: row.provider_key,
    providerName: row.provider_name,
    baseUrl: row.base_url,
    anthropicBaseUrl: row.anthropic_base_url,
    openaiBaseUrl: row.openai_base_url,
    name: row.name,
    modelId: row.model_id,
    capabilities: parseJsonArray(row.capabilities),
    contextWindow: row.context_window,
    status: row.status,
    isDefault: Boolean(row.is_default),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toCredentialSummary(row: CredentialRow): ProviderCredentialSummary {
  return {
    id: row.id,
    userId: row.user_id,
    providerProfileId: row.provider_profile_id,
    label: row.label,
    status: row.status,
    generation: row.generation,
    secretPreview: "********",
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeProviderKey(provider: string): string {
  return provider.trim().toLowerCase();
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

function isProviderAdapter(value: string): value is ProviderAdapter {
  return value === "claude" || value === "opencode" || value === "codex" || value === "kimi";
}

function normalizeSupportedAdapters(adapters: ProviderAdapter[]): ProviderAdapter[] {
  const normalized = adapters.filter(isProviderAdapter);
  return normalized.length > 0 ? [...new Set(normalized)].sort() : ["claude"];
}
