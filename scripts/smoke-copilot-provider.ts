import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UserRepository } from "../packages/gateway/src/db/repositories/user-repository.js";
import { ModelProviderRepository } from "../packages/gateway/src/db/repositories/model-provider-repository.js";
import { CopilotOrchestrator } from "../packages/gateway/src/services/copilot/orchestrator.js";

const gatewayRequire = createRequire(new URL("../packages/gateway/package.json", import.meta.url));
const Database = gatewayRequire("better-sqlite3");
const { drizzle } = gatewayRequire("drizzle-orm/better-sqlite3");
const { migrate } = gatewayRequire("drizzle-orm/better-sqlite3/migrator");

type SmokeProvider = "openai" | "anthropic";
type SkipReason = "missing_provider_credential" | "missing_model_id" | "unsupported_provider";

interface PublicSmokeSummary {
  provider?: SmokeProvider;
  apiFormat?: "openai" | "anthropic";
  modelId?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export type CopilotProviderSmokeConfig =
  | {
      status: "skipped";
      reason: SkipReason;
      requireLive: boolean;
      provider?: SmokeProvider;
      publicSummary: PublicSmokeSummary;
    }
  | {
      status: "ready";
      requireLive: boolean;
      provider: SmokeProvider;
      providerKey: SmokeProvider;
      apiFormat: "openai" | "anthropic";
      apiKey: string;
      modelId: string;
      baseUrl: string;
      timeoutMs: number;
      marker: string;
      prompt: string;
      publicSummary: PublicSmokeSummary;
    };

export interface CopilotProviderSmokeResult {
  ok: boolean;
  status: "passed" | "failed" | "skipped";
  reason?: SkipReason;
  provider?: SmokeProvider;
  modelId?: string;
  runStatus?: string;
  eventTypes?: string[];
  assistantMessagePreview?: string;
}

const DEFAULT_MARKER = "OPENFORGE_COPILOT_SMOKE_OK";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BASE_URLS: Record<SmokeProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com"
};

export function resolveCopilotProviderSmokeConfig(
  env: Record<string, string | undefined>
): CopilotProviderSmokeConfig {
  const requireLive = env.OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE === "1";
  const explicitProvider = normalizeProvider(env.OPENFORGE_COPILOT_PROVIDER_SMOKE_PROVIDER);
  if (env.OPENFORGE_COPILOT_PROVIDER_SMOKE_PROVIDER && !explicitProvider) {
    return skipped("unsupported_provider", requireLive, undefined);
  }
  const provider = explicitProvider ?? inferProvider(env);
  if (!provider) return skipped("missing_provider_credential", requireLive, undefined);

  const apiKey = readApiKey(env, provider);
  if (!apiKey) return skipped("missing_provider_credential", requireLive, provider);

  const modelId = readModelId(env, provider);
  if (!modelId) return skipped("missing_model_id", requireLive, provider);

  const timeoutMs = readPositiveInteger(env.OPENFORGE_COPILOT_PROVIDER_SMOKE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = env.OPENFORGE_COPILOT_PROVIDER_SMOKE_BASE_URL?.trim() || DEFAULT_BASE_URLS[provider];
  const marker = env.OPENFORGE_COPILOT_PROVIDER_SMOKE_MARKER?.trim() || DEFAULT_MARKER;
  const prompt = env.OPENFORGE_COPILOT_PROVIDER_SMOKE_PROMPT?.trim()
    || `Reply with exactly this marker and no extra prose: ${marker}`;
  const apiFormat = provider === "anthropic" ? "anthropic" : "openai";

  return {
    status: "ready",
    requireLive,
    provider,
    providerKey: provider,
    apiFormat,
    apiKey,
    modelId,
    baseUrl,
    timeoutMs,
    marker,
    prompt,
    publicSummary: {
      provider,
      apiFormat,
      modelId,
      baseUrl,
      timeoutMs
    }
  };
}

export function buildSkippedSmokeResult(
  config: Extract<CopilotProviderSmokeConfig, { status: "skipped" }>
): CopilotProviderSmokeResult {
  return {
    ok: !config.requireLive,
    status: "skipped",
    reason: config.reason,
    provider: config.provider
  };
}

export function sanitizeSmokeOutput(value: string, secrets: readonly (string | undefined)[]): string {
  return secrets.reduce((output, secret) => {
    if (!secret) return output;
    return output.split(secret).join("[redacted]");
  }, value);
}

export async function runCopilotProviderSmoke(
  config: Extract<CopilotProviderSmokeConfig, { status: "ready" }>
): Promise<CopilotProviderSmokeResult> {
  const db = createSmokeDb();
  try {
    const masterKey = randomBytes(32).toString("hex");
    const user = new UserRepository(db).create("copilot-smoke@example.com", "hash");
    const providers = new ModelProviderRepository(db, user.id, masterKey);
    const provider = providers.createProviderProfile({
      name: `${config.provider} live smoke`,
      providerKey: config.providerKey,
      baseUrl: config.baseUrl,
      authType: "api_key",
      apiFormat: config.apiFormat,
      supportedAdapters: config.provider === "anthropic" ? ["claude"] : ["opencode"]
    });
    providers.createModelProfile({
      providerProfileId: provider.id,
      name: config.modelId,
      modelId: config.modelId,
      isDefault: true
    });
    providers.createCredential({
      providerProfileId: provider.id,
      label: "Disposable smoke credential",
      plaintextSecret: config.apiKey
    });

    const result = await new CopilotOrchestrator({
      db,
      masterKey,
      modelRequestTimeoutMs: config.timeoutMs
    }).runText({
      userId: user.id,
      prompt: config.prompt,
      source: "copilot"
    });
    const eventTypes = result.events.map((event) => event.type);
    const assistantMessage = result.events.find((event) => event.type === "assistant_message")?.message ?? "";
    const passed = result.ok
      && result.run.status === "completed"
      && assistantMessage.includes(config.marker);

    return {
      ok: passed,
      status: passed ? "passed" : "failed",
      provider: config.provider,
      modelId: config.modelId,
      runStatus: result.run.status,
      eventTypes,
      assistantMessagePreview: preview(assistantMessage)
    };
  } finally {
    db.close();
  }
}

function createSmokeDb() {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(workspaceRoot(), "packages/gateway/src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function skipped(
  reason: SkipReason,
  requireLive: boolean,
  provider: SmokeProvider | undefined
): CopilotProviderSmokeConfig {
  return {
    status: "skipped",
    reason,
    requireLive,
    ...(provider ? { provider } : {}),
    publicSummary: provider ? { provider } : {}
  };
}

function inferProvider(env: Record<string, string | undefined>): SmokeProvider | undefined {
  if (readApiKey(env, "openai")) return "openai";
  if (readApiKey(env, "anthropic")) return "anthropic";
  return undefined;
}

function normalizeProvider(value: string | undefined): SmokeProvider | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "openai" || normalized === "anthropic" ? normalized : undefined;
}

function readApiKey(env: Record<string, string | undefined>, provider: SmokeProvider): string | undefined {
  const generic = env.OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY?.trim();
  if (generic) return generic;
  const providerKey = provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  return providerKey?.trim() || undefined;
}

function readModelId(env: Record<string, string | undefined>, provider: SmokeProvider): string | undefined {
  const generic = env.OPENFORGE_COPILOT_PROVIDER_SMOKE_MODEL?.trim();
  if (generic) return generic;
  const providerModel = provider === "anthropic" ? env.ANTHROPIC_MODEL : env.OPENAI_MODEL;
  return providerModel?.trim() || undefined;
}

function readPositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function preview(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function workspaceRoot(): string {
  return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}

function isMainModule(): boolean {
  const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
  return import.meta.url === entry;
}

async function main(): Promise<void> {
  const config = resolveCopilotProviderSmokeConfig(process.env);
  try {
    if (config.status === "skipped") {
      const result = buildSkippedSmokeResult(config);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    const result = await runCopilotProviderSmoke(config);
    console.log(JSON.stringify({
      ...result,
      config: config.publicSummary
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(config.status === "ready" ? sanitizeSmokeOutput(message, [config.apiKey]) : message);
    process.exitCode = 1;
  }
}

if (isMainModule()) {
  main();
}
