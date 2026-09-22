import { describe, expect, it } from "vitest";

import { buildEdgeFadeMask } from "./SessionBoard";

describe("buildEdgeFadeMask", () => {
  it("returns no mask when neither edge is scrollable", () => {
    expect(buildEdgeFadeMask(false, false)).toBeUndefined();
  });

  it("fades only the left edge when scrolled away from the start", () => {
    const mask = buildEdgeFadeMask(true, false);
    expect(mask).toContain("transparent, black 32px");
    expect(mask).not.toContain("calc(100% - 32px)");
  });

  it("fades only the right edge when more content exists on the right", () => {
    const mask = buildEdgeFadeMask(false, true);
    expect(mask).toContain("black calc(100% - 32px), transparent");
    expect(mask).not.toContain("transparent, black 32px");
  });

  it("fades both edges when scrolled into the middle", () => {
    const mask = buildEdgeFadeMask(true, true);
    expect(mask).toContain("transparent, black 32px");
    expect(mask).toContain("black calc(100% - 32px), transparent");
  });
});
