import { describe, expect, it } from "vitest";

import { syncUsageRateValues } from "./usage-rates";

describe("syncUsageRateValues", () => {
  it("keeps the current object reference when model rates have not changed", () => {
    const current = { "model-1": "3.5" };

    const next = syncUsageRateValues(
      current,
      [{ id: "model-1" }],
      new Map([["model-1", 3.5]])
    );

    expect(next).toBe(current);
  });

  it("creates rate values for models without mutating the current object", () => {
    const current = { "model-1": "1" };

    const next = syncUsageRateValues(
      current,
      [{ id: "model-1" }, { id: "model-2" }],
      new Map([
        ["model-1", 2],
        ["model-2", 0]
      ])
    );

    expect(next).toEqual({ "model-1": "2", "model-2": "0" });
    expect(current).toEqual({ "model-1": "1" });
  });
});
