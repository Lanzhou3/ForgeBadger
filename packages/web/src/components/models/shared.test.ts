import { describe, expect, it } from "vitest";

import {
  apiFormatLabel,
  appliedStatusForAdapter,
  authTypeLabel,
  balanceEntryUsedPercent,
  COMMON_MODEL_CAPABILITIES,
  customProviderHasEndpoint,
  customProviderHasPlaintextHttp,
  customProviderHasPrivateNetworkUrl,
  customProviderPrimaryBaseUrl,
  emptyCustomProvider,
  hydrateCustomProviderForm,
  isProviderActiveOnAdapter,
  mergeCapabilities,
  parseCapabilities,
  splitCapabilities,
  THINKING_EFFORT_LEVELS,
  type Translate,
} from "./shared";
import type { AdapterAppliedStatus, ProviderProfile } from "@/lib/api";

const identityT: Translate = (key: string) => key;

describe("balanceEntryUsedPercent", () => {
  it("inverts percent-denominated remaining quotas", () => {
    expect(balanceEntryUsedPercent({ remaining: 82.4, unit: "%" })).toBeCloseTo(17.6);
  });

  it("derives used percentage from remaining/limit for bounded quota windows", () => {
    expect(balanceEntryUsedPercent({ remaining: 950, limit: 1000, unit: "requests" })).toBeCloseTo(5);
  });

  it("returns undefined for unbounded currency balances", () => {
    expect(balanceEntryUsedPercent({ remaining: 12.5, unit: "CNY" })).toBeUndefined();
  });

  it("clamps out-of-range values", () => {
    expect(balanceEntryUsedPercent({ remaining: 120, unit: "%" })).toBe(0);
    expect(balanceEntryUsedPercent({ remaining: -5, limit: 100, unit: "requests" })).toBe(100);
  });

  it("returns undefined when the limit is zero", () => {
    expect(balanceEntryUsedPercent({ remaining: 10, limit: 0, unit: "requests" })).toBeUndefined();
  });
});

describe("apiFormatLabel", () => {
  it("maps known formats to i18n keys instead of raw enums", () => {
    expect(apiFormatLabel("openai-compatible", identityT)).toBe("models.apiFormatOpenaiChat");
    expect(apiFormatLabel("anthropic", identityT)).toBe("models.apiFormatAnthropic");
  });

  it("falls back to the raw value for unknown formats", () => {
    expect(apiFormatLabel("future-format" as never, identityT)).toBe("future-format");
  });
});

describe("authTypeLabel", () => {
  it("maps known auth types to i18n keys instead of raw enums", () => {
    expect(authTypeLabel("api_key", identityT)).toBe("models.authTypeApiKey");
    expect(authTypeLabel("none", identityT)).toBe("models.authTypeNone");
  });

  it("falls back to the raw value for unknown auth types", () => {
    expect(authTypeLabel("mtls" as never, identityT)).toBe("mtls");
  });
});

describe("capability helpers", () => {
  it("parses comma-separated input with trimming and de-duplication", () => {
    expect(parseCapabilities("vision, tools ,vision,")).toEqual(["vision", "tools"]);
    expect(parseCapabilities("")).toEqual([]);
  });

  it("merges checked and custom capabilities without duplicates", () => {
    expect(mergeCapabilities(["chat", "code"], "vision, chat")).toEqual(["chat", "code", "vision"]);
  });

  it("splits stored capabilities into common and custom buckets", () => {
    expect(splitCapabilities(["chat", "vision", "long-context"])).toEqual({
      checked: ["chat", "vision"],
      custom: "long-context",
    });
  });
});

describe("model form constants", () => {
  it("exposes the Kimi Code thinking effort levels in order", () => {
    expect([...THINKING_EFFORT_LEVELS]).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("keeps video among the common capability tags", () => {
    expect(COMMON_MODEL_CAPABILITIES).toContain("video");
  });
});

describe("custom provider form: bare baseUrl providers", () => {
  function providerFixture(partial: Partial<ProviderProfile>): ProviderProfile {
    return {
      id: "provider-1",
      providerKey: "custom",
      name: "Custom Provider",
      baseUrl: null,
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude"],
      status: "active",
      ...partial,
    };
  }

  it("falls back to a bare baseUrl on the openai side for openai-family formats", () => {
    const form = hydrateCustomProviderForm(
      providerFixture({ baseUrl: "https://relay.example.com/v1", apiFormat: "openai-compatible" })
    );
    expect(form.openaiBaseUrl).toBe("https://relay.example.com/v1");
    expect(form.anthropicBaseUrl).toBe("");
    expect(form.baseUrl).toBe("https://relay.example.com/v1");
    expect(customProviderHasEndpoint(form)).toBe(true);
  });

  it("falls back to a bare baseUrl on the anthropic side for the anthropic format", () => {
    const form = hydrateCustomProviderForm(
      providerFixture({ baseUrl: "https://relay.example.com/anthropic", apiFormat: "anthropic" })
    );
    expect(form.anthropicBaseUrl).toBe("https://relay.example.com/anthropic");
    expect(form.openaiBaseUrl).toBe("");
    expect(customProviderHasEndpoint(form)).toBe(true);
  });

  it("does not overwrite format-specific endpoints that are already set", () => {
    const form = hydrateCustomProviderForm(
      providerFixture({
        baseUrl: "https://relay.example.com/v1",
        openaiBaseUrl: "https://relay.example.com/openai",
      })
    );
    expect(form.openaiBaseUrl).toBe("https://relay.example.com/openai");
    expect(form.baseUrl).toBe("https://relay.example.com/v1");
  });

  it("treats a bare baseUrl as a valid endpoint and preserves it as the primary on save", () => {
    const form = hydrateCustomProviderForm(
      providerFixture({ baseUrl: "https://relay.example.com/v1" })
    );
    // Untouched dialog: save submits the existing baseUrl instead of clearing it.
    expect(customProviderHasEndpoint(form)).toBe(true);
    expect(customProviderPrimaryBaseUrl(form)).toBe("https://relay.example.com/v1");
    // An edit to the hydrated field becomes the new primary endpoint.
    expect(customProviderPrimaryBaseUrl({ ...form, openaiBaseUrl: " https://new.example.com/v1 " })).toBe(
      "https://new.example.com/v1"
    );
  });

  it("flags plaintext http and private-network hosts on a bare baseUrl", () => {
    const httpForm = hydrateCustomProviderForm(providerFixture({ baseUrl: "http://relay.example.com/v1" }));
    expect(customProviderHasPlaintextHttp(httpForm)).toBe(true);
    const privateForm = hydrateCustomProviderForm(providerFixture({ baseUrl: "http://192.168.1.10:8080/v1" }));
    expect(customProviderHasPrivateNetworkUrl(privateForm)).toBe(true);
  });

  it("still requires at least one endpoint for a provider without any baseUrl", () => {
    expect(customProviderHasEndpoint(emptyCustomProvider)).toBe(false);
    expect(customProviderHasEndpoint(hydrateCustomProviderForm(providerFixture({})))).toBe(false);
  });
});

function statusFixture(partial: Partial<AdapterAppliedStatus>): AdapterAppliedStatus {
  return {
    adapter: "claude",
    applied: null,
    configDefaultModel: null,
    stale: false,
    ...partial,
  };
}

describe("applied status helpers", () => {
  const statuses = [
    statusFixture({ adapter: "claude" }),
    statusFixture({
      adapter: "kimi",
      applied: {
        providerProfileId: "provider-1",
        providerName: "Provider 01",
        providerStatus: "active",
        modelProfileId: "model-1",
        modelId: "model-x",
        modelName: "Model X",
        appliedAt: "2026-09-01T00:00:00.000Z",
      },
    }),
  ];

  it("finds the status entry for an adapter", () => {
    expect(appliedStatusForAdapter(statuses, "kimi")?.applied?.providerProfileId).toBe("provider-1");
    expect(appliedStatusForAdapter(statuses, "codex")).toBeNull();
    expect(appliedStatusForAdapter(undefined, "claude")).toBeNull();
  });

  it("detects whether a provider is the active one on an adapter", () => {
    const kimi = appliedStatusForAdapter(statuses, "kimi");
    const claude = appliedStatusForAdapter(statuses, "claude");
    expect(isProviderActiveOnAdapter(kimi, "provider-1")).toBe(true);
    expect(isProviderActiveOnAdapter(kimi, "provider-2")).toBe(false);
    expect(isProviderActiveOnAdapter(claude, "provider-1")).toBe(false);
    expect(isProviderActiveOnAdapter(null, "provider-1")).toBe(false);
  });
});
