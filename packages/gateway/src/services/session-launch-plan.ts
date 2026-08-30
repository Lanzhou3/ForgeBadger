import { createAdapterLaunchPlan, type AdapterModelSelection } from "../adapters/index.js";
import type { LaunchPlan } from "../adapters/claude.js";
import { isAdapterId, type AdapterId } from "./adapter-discovery.js";
import { ApiKeyRepository } from "../db/repositories/api-key-repository.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";
import type { Database } from "../db/types.js";
import type { CredentialMode } from "../config-generation/types.js";
import {
  ensureClaudeNotificationSettings,
  ensureClaudePortfolioWorkerHookSettings
} from "./claude-notification-settings.js";
import {
  ensureCodexNotificationSettings,
  ensureKimiNotificationSettings
} from "./cli-notification-settings.js";
import { ensureForgeBadgerOpenCodePlugin } from "./opencode-notification-settings.js";
import type { WorkerLaunchMaterial } from "./portfolio/worker-signal-service.js";

export interface LaunchPlanInput {
  db: Database;
  userId: string;
  masterKey: string;
  adapter: AdapterId;
  projectRoot: string;
  sessionId: string;
  credentialMode: CredentialMode;
  apiKeyId?: string;
  modelId?: string;
  pluginDirs?: string[];
  portfolioWorker?: ClaudePortfolioWorkerLaunchConfiguration;
}

/**
 * Internal launch-only material returned by the durable dispatch coordinator.
 * It is intentionally absent from HTTP, WebSocket, and attach contracts.
 */
export type ClaudePortfolioWorkerLaunchConfiguration = WorkerLaunchMaterial;

/** Validates and freezes the only worker capability form accepted by launch code. */
export function createClaudePortfolioWorkerLaunchConfiguration(
  input: ClaudePortfolioWorkerLaunchConfiguration
): ClaudePortfolioWorkerLaunchConfiguration {
  assertClaudePortfolioWorkerLaunchConfiguration(input);
  return Object.freeze({
    binding: Object.freeze({ ...input.binding }),
    workerAckCapability: input.workerAckCapability
  });
}

/**
 * Internal prepared-dispatch path. It writes the capability-free hook config
 * before returning the process-local LaunchPlan that carries the HMAC secret.
 */
export async function prepareClaudePortfolioWorkerLaunch(
  input: Omit<LaunchPlanInput, "pluginDirs"> & {
    portfolioWorker: ClaudePortfolioWorkerLaunchConfiguration;
  }
): Promise<LaunchPlan> {
  const portfolioWorker = createClaudePortfolioWorkerLaunchConfiguration(input.portfolioWorker);
  assertClaudePortfolioWorkerLaunchForSession(portfolioWorker, input.adapter, input.sessionId);
  const pluginDirs = await prepareAdapterLaunchExtras(
    input.db,
    input.userId,
    input.adapter,
    input.projectRoot,
    input.sessionId,
    portfolioWorker
  );
  return createLaunchPlan({
    ...input,
    portfolioWorker,
    ...(pluginDirs.length > 0 ? { pluginDirs } : {})
  });
}

export function createLaunchPlan(input: LaunchPlanInput): LaunchPlan {
  const credentialBoundary = validateSelfManagedAdapterCredentialBoundary(input);
  if (!credentialBoundary.ok) throw new Error(credentialBoundary.message);

  const env: Record<string, string> = {
    FORGEBADGER_SESSION_ID: input.sessionId,
    FORGEBADGER_GATEWAY_URL: getGatewayUrl()
  };
  const secretEnvNames: string[] = [];
  let selectedModel: AdapterModelSelection | undefined;

  if (input.credentialMode === "stored_encrypted_key" && input.adapter !== "codex") {
    const credential = resolveStoredCredential(input);
    env[credential.envName] = credential.secret;
    secretEnvNames.push(credential.envName);
  }

  if (input.modelId && input.adapter !== "codex") {
    const model = new ModelProviderRepository(input.db, input.userId, input.masterKey).getModelProfile(input.modelId);
    if (!model) throw new Error("Model not found");
    selectedModel = { provider: model.providerKey, modelId: model.modelId };
    if (input.adapter === "claude") {
      env.ANTHROPIC_MODEL = model.modelId;
    } else if (input.adapter === "opencode") {
      env.OPENCODE_MODEL = model.modelId.includes("/") ? model.modelId : `${model.providerKey}/${model.modelId}`;
    }
  }

  if (input.portfolioWorker) {
    applyClaudePortfolioWorkerLaunchEnvironment(input, env, secretEnvNames);
  }

  return createAdapterLaunchPlan({
    adapter: input.adapter,
    projectRoot: input.projectRoot,
    credentialMode: input.credentialMode,
    env,
    secretEnvNames,
    model: selectedModel,
    pluginDirs: input.pluginDirs
  });
}

export async function prepareAdapterLaunchExtras(
  db: Database,
  userId: string,
  adapter: AdapterId,
  projectRoot: string,
  sessionId: string,
  portfolioWorker?: ClaudePortfolioWorkerLaunchConfiguration
): Promise<string[]> {
  if (portfolioWorker) {
    assertClaudePortfolioWorkerLaunchForSession(portfolioWorker, adapter, sessionId);
  }
  if (adapter === "opencode") {
    await ensureForgeBadgerOpenCodePlugin(projectRoot);
    return [];
  }
  if (adapter === "codex") {
    await ensureCodexNotificationSettings(projectRoot);
    return [];
  }
  if (adapter === "kimi") {
    await ensureKimiNotificationSettings(projectRoot);
    return [];
  }
  await ensureClaudeNotificationSettings(projectRoot, getGatewayUrl(), sessionId);
  if (portfolioWorker) {
    await ensureClaudePortfolioWorkerHookSettings(projectRoot, getGatewayUrl(), sessionId);
  }
  return [];
}

export function validateSelfManagedAdapterCredentialBoundary(input: {
  adapter: AdapterId;
  credentialMode: CredentialMode;
  apiKeyId?: string | undefined;
  modelId?: string | undefined;
}): { ok: true } | { ok: false; message: string } {
  if (
    (input.adapter === "codex" || input.adapter === "kimi")
    && (input.credentialMode !== "host_environment" || input.apiKeyId || input.modelId)
  ) {
    return {
      ok: false,
      message: `${input.adapter === "kimi" ? "Kimi Code" : "Codex"} sessions are subscription-managed; provider credentials and model overrides are not supported`
    };
  }
  return { ok: true };
}

export function normalizeAdapter(value: string): AdapterId | undefined {
  return isAdapterId(value) ? value : undefined;
}

function resolveStoredCredential(input: LaunchPlanInput): { envName: string; secret: string } {
  if (input.apiKeyId) {
    const apiKeyRepo = new ApiKeyRepository(input.db, input.userId, input.masterKey);
    const record = apiKeyRepo.getById(input.apiKeyId);
    if (!record) throw new Error("API key not found");
    return { envName: apiKeyEnvName(record.provider), secret: apiKeyRepo.decryptForLaunch(input.apiKeyId) };
  }

  if (input.modelId) {
    const providerRepo = new ModelProviderRepository(input.db, input.userId, input.masterKey);
    const model = providerRepo.getModelProfile(input.modelId);
    if (model) {
      const credential = providerRepo.listCredentials(model.providerProfileId)[0];
      if (!credential) throw new Error("Provider credential not found");
      return {
        envName: apiKeyEnvName(model.providerKey),
        secret: providerRepo.decryptCredential(credential.id)
      };
    }
  }
  throw new Error("API key is required for stored credentials");
}

function applyClaudePortfolioWorkerLaunchEnvironment(
  input: LaunchPlanInput,
  env: Record<string, string>,
  secretEnvNames: string[]
): void {
  const worker = input.portfolioWorker;
  if (!worker) return;
  assertClaudePortfolioWorkerLaunchForSession(worker, input.adapter, input.sessionId);
  env.FORGEBADGER_PORTFOLIO_WORKER_ACK_CAPABILITY = worker.workerAckCapability;
  secretEnvNames.push("FORGEBADGER_PORTFOLIO_WORKER_ACK_CAPABILITY");
}

function assertClaudePortfolioWorkerLaunchForSession(
  config: ClaudePortfolioWorkerLaunchConfiguration,
  adapter: AdapterId,
  sessionId: string
): void {
  assertClaudePortfolioWorkerLaunchConfiguration(config);
  if (adapter !== "claude" || config.binding.adapter !== "claude" || config.binding.sessionId !== sessionId) {
    throw new Error("PORTFOLIO_WORKER_LAUNCH_BINDING_REJECTED");
  }
}

function assertClaudePortfolioWorkerLaunchConfiguration(
  config: ClaudePortfolioWorkerLaunchConfiguration
): void {
  const { binding } = config;
  if (
    !binding.commandId || !binding.assignmentId || !binding.attemptId || !binding.sessionId
    || binding.adapter !== "claude" || !Number.isSafeInteger(binding.leaseGeneration) || binding.leaseGeneration < 1
    || !/^[a-f0-9]{64}$/iu.test(binding.packetDigest)
    || !/^[a-f0-9]{64}$/iu.test(config.workerAckCapability)
  ) {
    throw new Error("PORTFOLIO_WORKER_LAUNCH_BINDING_REJECTED");
  }
}

function apiKeyEnvName(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "anthropic") return "ANTHROPIC_API_KEY";
  if (normalized === "openai") return "OPENAI_API_KEY";
  return `${normalized.replace(/[^a-z0-9]+/g, "_").toUpperCase()}_API_KEY`;
}

function getGatewayUrl(): string {
  return (
    process.env.FORGEBADGER_GATEWAY_URL
    || process.env.NEXT_PUBLIC_GATEWAY_URL
    || `http://${process.env.FORGEBADGER_HOST || "127.0.0.1"}:${process.env.FORGEBADGER_PORT || "3000"}`
  );
}
