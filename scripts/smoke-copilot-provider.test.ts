import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSkippedSmokeResult,
  resolveCopilotProviderSmokeConfig,
  sanitizeSmokeOutput
} from "./smoke-copilot-provider.ts";

describe("copilot provider smoke config", () => {
  it("skips safely when no disposable provider credential is configured", () => {
    const config = resolveCopilotProviderSmokeConfig({});

    assert.equal(config.status, "skipped");
    assert.equal(config.reason, "missing_provider_credential");
    assert.equal(config.requireLive, false);
  });

  it("skips instead of using a live credential without an explicit model id", () => {
    const config = resolveCopilotProviderSmokeConfig({
      OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY: "sk-live-secret"
    });

    assert.equal(config.status, "skipped");
    assert.equal(config.reason, "missing_model_id");
    assert.equal(JSON.stringify(buildSkippedSmokeResult(config)).includes("sk-live-secret"), false);
  });

  it("marks missing live configuration as failed when the smoke is required", () => {
    const config = resolveCopilotProviderSmokeConfig({
      OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE: "1"
    });

    assert.equal(config.status, "skipped");
    assert.equal(config.requireLive, true);
    assert.equal(buildSkippedSmokeResult(config).ok, false);
  });

  it("resolves a ready OpenAI smoke config without exposing the credential in summaries", () => {
    const config = resolveCopilotProviderSmokeConfig({
      OPENFORGE_COPILOT_PROVIDER_SMOKE_PROVIDER: "openai",
      OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY: "sk-live-secret",
      OPENFORGE_COPILOT_PROVIDER_SMOKE_MODEL: "gpt-smoke",
      OPENFORGE_COPILOT_PROVIDER_SMOKE_BASE_URL: "https://example.test/v1",
      OPENFORGE_COPILOT_PROVIDER_SMOKE_TIMEOUT_MS: "12345"
    });

    assert.equal(config.status, "ready");
    if (config.status !== "ready") return;
    assert.equal(config.provider, "openai");
    assert.equal(config.apiFormat, "openai");
    assert.equal(config.modelId, "gpt-smoke");
    assert.equal(config.baseUrl, "https://example.test/v1");
    assert.equal(config.timeoutMs, 12345);
    assert.equal(JSON.stringify(config.publicSummary).includes("sk-live-secret"), false);
  });

  it("infers Anthropic from an Anthropic disposable credential", () => {
    const config = resolveCopilotProviderSmokeConfig({
      ANTHROPIC_API_KEY: "sk-ant-secret",
      ANTHROPIC_MODEL: "claude-smoke"
    });

    assert.equal(config.status, "ready");
    if (config.status !== "ready") return;
    assert.equal(config.provider, "anthropic");
    assert.equal(config.apiFormat, "anthropic");
    assert.equal(config.modelId, "claude-smoke");
    assert.equal(JSON.stringify(config.publicSummary).includes("sk-ant-secret"), false);
  });

  it("redacts live credentials from command output errors", () => {
    const output = sanitizeSmokeOutput(
      "provider rejected Authorization: Bearer sk-live-secret",
      ["sk-live-secret"]
    );

    assert.equal(output.includes("sk-live-secret"), false);
    assert.equal(output.includes("[redacted]"), true);
  });
});
