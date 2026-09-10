import { describe, expect, it } from "vitest";

import {
  apiFormatLabel,
  appliedStatusForAdapter,
  authTypeLabel,
  balanceEntryUsedPercent,
  isProviderActiveOnAdapter,
  mergeCapabilities,
  parseCapabilities,
  splitCapabilities,
  type Translate,
} from "./shared";
import type { AdapterAppliedStatus } from "@/lib/api";

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
    expect(apiFormatLabel("openai-compatible", identityT)).toBe("models.apiFormatOpenaiCompatible");
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
