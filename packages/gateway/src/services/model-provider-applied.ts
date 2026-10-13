import type { Database } from "../db/types.js";
import {
  CliConfigAppliedProviderRepository,
  type CliConfigAppliedProvider
} from "../db/repositories/cli-config-applied-provider-repository.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";
import type { AdapterId } from "./adapter-discovery.js";
import { readCliConfig, type CliConfigSnapshot } from "./cli-config.js";

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
): { summary: AppliedProviderSummary; dangling: boolean } {
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
    dangling: !provider || (pointer.modelProfileId !== null && !model)
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
  resolved: { summary: AppliedProviderSummary; dangling: boolean } | null,
  snapshot: CliConfigSnapshot | null
): boolean {
  if (!resolved) return false;
  if (resolved.dangling) return true;
  // A missing/unparseable snapshot cannot prove drift; stay conservative.
  if (!snapshot?.defaultModel.trim()) return false;
  return configModelId(adapter, snapshot) !== resolved.summary.modelId;
}

function configModelId(adapter: AdapterId, snapshot: CliConfigSnapshot): string | null {
  const configDefaultModel = snapshot.defaultModel.trim();
  if (adapter === "grok") {
    // [models].default selects a catalog entry, not a wire model ID.
    // A readable config with no matching entry proves the selection drifted.
    return snapshot.models.find((model) => model.alias === configDefaultModel)?.modelId ?? null;
  }
  if (adapter !== "kimi") return configDefaultModel;
  const slash = configDefaultModel.lastIndexOf("/");
  return slash === -1 ? configDefaultModel : configDefaultModel.slice(slash + 1);
}
