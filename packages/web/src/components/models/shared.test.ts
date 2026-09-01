import { describe, expect, it } from "vitest";

import { balanceEntryUsedPercent } from "./shared";

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
