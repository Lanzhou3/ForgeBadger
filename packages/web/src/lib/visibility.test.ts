import { describe, expect, it } from "vitest";

import {
  filterByVisibility,
  normalizeVisibility,
  visibilityDescriptionKey,
  visibilityLabelKey,
  visibilityOptions,
} from "./visibility";

describe("visibility helpers", () => {
  it("normalizes unknown visibility values to private", () => {
    expect(normalizeVisibility("shared")).toBe("shared");
    expect(normalizeVisibility("admin")).toBe("admin");
    expect(normalizeVisibility("unknown")).toBe("private");
    expect(normalizeVisibility(null)).toBe("private");
  });

  it("provides stable label keys and options", () => {
    expect(visibilityOptions).toEqual(["private", "shared", "admin"]);
    expect(visibilityLabelKey("private")).toBe("visibility.private");
    expect(visibilityLabelKey("shared")).toBe("visibility.shared");
    expect(visibilityLabelKey("admin")).toBe("visibility.admin");
    expect(visibilityDescriptionKey("shared")).toBe("visibility.sharedDescription");
  });

  it("filters records by visibility", () => {
    const records = [
      { id: "one", visibility: "private" },
      { id: "two", visibility: "shared" },
      { id: "three", visibility: "admin" },
      { id: "four" },
    ];

    expect(filterByVisibility(records, "all").map((record) => record.id)).toEqual(["one", "two", "three", "four"]);
    expect(filterByVisibility(records, "shared").map((record) => record.id)).toEqual(["two"]);
    expect(filterByVisibility(records, "private").map((record) => record.id)).toEqual(["one", "four"]);
  });
});
