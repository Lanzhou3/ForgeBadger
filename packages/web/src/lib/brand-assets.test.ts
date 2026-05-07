import { describe, expect, it } from "vitest";

import { brandAssets } from "./brand-assets";

describe("brandAssets", () => {
  it("exposes stable public asset paths for OpenForge brand surfaces", () => {
    expect(brandAssets.logoSvg).toBe("/brand/openforge-logo.svg");
    expect(brandAssets.logoPng).toBe("/brand/openforge-logo.png");
    expect(brandAssets.background).toBe("/brand/openforge-bg.png");
    expect(brandAssets.favicon).toBe("/favicon.ico");
  });
});
