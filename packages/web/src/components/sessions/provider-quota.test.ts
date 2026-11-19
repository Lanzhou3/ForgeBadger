import { describe, expect, it } from "vitest";

import {
  cliQuotaRemainingPercent,
  formatQuotaAmount,
  quotaBarToneClass,
  quotaRemainingPercent,
  quotaTextToneClass,
  quotaUsagePercent,
  remainingBarToneClass,
  remainingTextToneClass,
} from "./provider-quota";

describe("quotaUsagePercent", () => {
  it("returns the used share of a bounded quota window", () => {
    expect(quotaUsagePercent({ remaining: 25, limit: 100, unit: "requests" })).toBe(75);
    expect(quotaUsagePercent({ remaining: 100, limit: 100, unit: "requests" })).toBe(0);
    expect(quotaUsagePercent({ remaining: 0, limit: 100, unit: "requests" })).toBe(100);
  });

  it("inverts percent-denominated remaining quotas", () => {
    expect(quotaUsagePercent({ remaining: 82.4, unit: "%" })).toBe(18);
    expect(quotaUsagePercent({ remaining: 100, unit: "%" })).toBe(0);
    expect(quotaUsagePercent({ remaining: 0, unit: "%" })).toBe(100);
  });

  it("clamps out-of-range values", () => {
    expect(quotaUsagePercent({ remaining: -5, limit: 100, unit: "requests" })).toBe(100);
    expect(quotaUsagePercent({ remaining: 150, limit: 100, unit: "requests" })).toBe(0);
    expect(quotaUsagePercent({ remaining: 120, unit: "%" })).toBe(0);
  });

  it("returns null for unbounded currency balances", () => {
    expect(quotaUsagePercent({ remaining: 42.5, unit: "CNY" })).toBeNull();
    expect(quotaUsagePercent({ remaining: 42.5, limit: 0, unit: "CNY" })).toBeNull();
  });
});

describe("quotaBarToneClass", () => {
  it("escalates the tone as usage grows", () => {
    expect(quotaBarToneClass(49)).toBe("bg-gradient-to-r from-emerald-600 to-emerald-400");
    expect(quotaBarToneClass(50)).toBe("bg-gradient-to-r from-amber-600 to-amber-400");
    expect(quotaBarToneClass(80)).toBe("bg-gradient-to-r from-red-600 to-red-400");
  });
});

describe("quotaTextToneClass", () => {
  it("matches the bar tone thresholds", () => {
    expect(quotaTextToneClass(49)).toBe("text-emerald-400");
    expect(quotaTextToneClass(50)).toBe("text-amber-400");
    expect(quotaTextToneClass(80)).toBe("text-red-400");
  });
});

describe("formatQuotaAmount", () => {
  it("keeps integers plain and trims fraction zeros", () => {
    expect(formatQuotaAmount(42)).toBe("42");
    expect(formatQuotaAmount(42.5)).toBe("42.5");
    expect(formatQuotaAmount(42.5 + 0.25)).toBe("42.75");
    expect(formatQuotaAmount(0.1 + 0.2)).toBe("0.3");
  });
});

describe("remaining quota helpers", () => {
  it("computes clamped remaining percentage for provider balances and CLI windows", () => {
    expect(quotaRemainingPercent({ remaining: 800, limit: 1000, unit: "count" })).toBe(80);
    expect(quotaRemainingPercent({ remaining: 82.4, unit: "%" })).toBe(82);
    expect(quotaRemainingPercent({ remaining: 42.5, unit: "CNY" })).toBeNull();

    expect(cliQuotaRemainingPercent({ usedPercent: 30 })).toBe(70);
    expect(cliQuotaRemainingPercent({ remaining: 800, limit: 1000 })).toBe(80);
    expect(cliQuotaRemainingPercent({ remaining: 12 })).toBeNull();
  });

  it("maps remaining thresholds to warning and critical semantic tones", () => {
    expect(remainingTextToneClass(70)).toBe("text-success");
    expect(remainingTextToneClass(50)).toBe("text-warning");
    expect(remainingTextToneClass(20)).toBe("text-destructive");
    expect(remainingBarToneClass(70)).toBe("bg-success");
    expect(remainingBarToneClass(35)).toBe("bg-warning");
    expect(remainingBarToneClass(15)).toBe("bg-destructive");
  });
});
