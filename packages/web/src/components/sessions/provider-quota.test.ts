import { describe, expect, it } from "vitest";

import {
  formatQuotaAmount,
  quotaBarToneClass,
  quotaUsagePercent,
} from "./provider-quota";

describe("quotaUsagePercent", () => {
  it("returns the used share of a bounded quota window", () => {
    expect(quotaUsagePercent({ remaining: 25, limit: 100 })).toBe(75);
    expect(quotaUsagePercent({ remaining: 100, limit: 100 })).toBe(0);
    expect(quotaUsagePercent({ remaining: 0, limit: 100 })).toBe(100);
  });

  it("clamps out-of-range values", () => {
    expect(quotaUsagePercent({ remaining: -5, limit: 100 })).toBe(100);
    expect(quotaUsagePercent({ remaining: 150, limit: 100 })).toBe(0);
  });

  it("returns null for unbounded balances", () => {
    expect(quotaUsagePercent({ remaining: 42.5 })).toBeNull();
    expect(quotaUsagePercent({ remaining: 42.5, limit: 0 })).toBeNull();
  });
});

describe("quotaBarToneClass", () => {
  it("escalates the tone as usage grows", () => {
    expect(quotaBarToneClass(50)).toBe("bg-emerald-500");
    expect(quotaBarToneClass(70)).toBe("bg-amber-500");
    expect(quotaBarToneClass(90)).toBe("bg-red-500");
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
