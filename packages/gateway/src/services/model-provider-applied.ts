import type { Database } from "../db/types.js";
import {
  CliConfigAppliedProviderRepository,
  type CliConfigAppliedProvider
} from "../db/repositories/cli-config-applied-provider-repository.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";
import type { AdapterId } from "./adapter-discovery.js";
import { readCliConfig, type CliConfigSnapshot } from "./cli-config.js";
import { normalizeProviderKey } from "./cli-config-apply.js";

export interface AppliedProviderSummary {
  providerProfileId: string;
  providerName: string | null;
  providerStatus: string | null;
  modelProfileId: string | null;
  modelId: string | null;
  modelName: string | null;
  appliedAt: string;
}

export interface AppliedAdapterStatus {
  adapter: AdapterId;
  applied: AppliedProviderSummary | null;
  /** CLI config snapshot defaultModel; admin-only, null when unavailable. */
  configDefaultModel: string | null;
  stale: boolean;
}

export interface AppliedProvidersOverviewOptions {
  isAdmin: boolean;
  /** Test seam; defaults to the real CLI config snapshot reader. */
  readSnapshot?: ((adapter: AdapterId) => Promise<CliConfigSnapshot>) | undefined;
}

const ADAPTER_IDS: AdapterId[] = ["claude", "opencode", "codex", "kimi", "pi", "grok"];

export async function buildAppliedProvidersOverview(
  db: Database,
  userId: string,
  masterKey: string,
  options: AppliedProvidersOverviewOptions
): Promise<AppliedAdapterStatus[]> {
  const appliedRepo = new CliConfigAppliedProviderRepository(db, userId);
  const providerRepo = new ModelProviderRepository(db, userId, masterKey);
  const readSnapshot = options.readSnapshot ?? readCliConfig;
  return await Promise.all(
    ADAPTER_IDS.map(async (adapter) => {
      const pointer = appliedRepo.get(adapter);
      const resolved = pointer ? resolvePointer(pointer, providerRepo) : null;
      const snapshot = options.isAdmin ? await readConfigSnapshot(readSnapshot, adapter) : null;
      const configDefaultModel = snapshot?.defaultModel.trim() || null;
      return {
        adapter,
        applied: resolved?.summary ?? null,
        configDefaultModel,
        stale: isStale(adapter, resolved, snapshot)
      };
    })
  );
}

function resolvePointer(
  pointer: CliConfigAppliedProvider,
  providerRepo: ModelProviderRepository
): { summary: AppliedProviderSummary; dangling: boolean; providerKey: string | null } {
  const provider = providerRepo.getProviderProfile(pointer.providerProfileId);
  const model = pointer.modelProfileId
    ? providerRepo.getModelProfile(pointer.modelProfileId)
    : undefined;
  return {
    summary: {
      providerProfileId: pointer.providerProfileId,
      providerName: provider?.name ?? null,
      providerStatus: provider?.status ?? null,
      modelProfileId: pointer.modelProfileId,
      modelId: model?.modelId ?? null,
      modelName: model?.name ?? null,
      appliedAt: new Date(pointer.appliedAt).toISOString()
    },
    dangling: !provider || (pointer.modelProfileId !== null && !model),
    providerKey: provider ? normalizeProviderKey(provider.providerKey) : null
  };
}

async function readConfigSnapshot(
  readSnapshot: (adapter: AdapterId) => Promise<CliConfigSnapshot>,
  adapter: AdapterId
): Promise<CliConfigSnapshot | null> {
  try {
    return await readSnapshot(adapter);
  } catch {
    return null;
  }
}

function isStale(
  adapter: AdapterId,
  resolved: { summary: AppliedProviderSummary; dangling: boolean; providerKey: string | null } | null,
  snapshot: CliConfigSnapshot | null
): boolean {
  if (!resolved) return false;
  if (resolved.dangling) return true;
  // A missing/unparseable snapshot cannot prove drift; stay conservative.
  if (!snapshot) return false;
  if (adapter === "kimi") {
    // Kimi login and /model legitimately change default_model while keeping the
    // applied third-party provider available. Drift means that provider, its
    // credential, or the exact applied alias disappeared — not another default.
    if (!resolved.providerKey || !resolved.summary.modelId) return true;
    const provider = snapshot.providers.find((entry) => entry.id === resolved.providerKey);
    const alias = `${resolved.providerKey}/${resolved.summary.modelId}`;
    const model = snapshot.models.find((entry) =>
      entry.alias === alias && entry.provider === resolved.providerKey && entry.modelId === resolved.summary.modelId
    );
    return !provider?.hasApiKey || !model;
  }
  if (!snapshot.defaultModel.trim()) return false;
  return configModelId(adapter, snapshot) !== resolved.summary.modelId;
}

function configModelId(adapter: AdapterId, snapshot: CliConfigSnapshot): string | null {
  const configDefaultModel = snapshot.defaultModel.trim();
  if (adapter === "grok") {
    // [models].default selects a catalog entry, not a wire model ID.
    // A readable config with no matching entry proves the selection drifted.
    return snapshot.models.find((model) => model.alias === configDefaultModel)?.modelId ?? null;
  }
  return configDefaultModel;
}
