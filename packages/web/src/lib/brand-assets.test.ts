import { describe, expect, it } from "vitest";

import { brandAssets } from "./brand-assets";

describe("brandAssets", () => {
  it("exposes stable public asset paths for ForgeBadger brand surfaces", () => {
    expect(brandAssets.logoSvg).toBe("/brand/forgebadger-logo.svg");
    expect(brandAssets.logoPng).toBe("/brand/forgebadger-logo.png");
    expect(brandAssets.banner).toBe("/brand/forgebadger-banner.png");
    expect(brandAssets.background).toBe("/brand/forgebadger-bg.png");
    expect(brandAssets.favicon).toBe("/favicon.ico");
  });
});
