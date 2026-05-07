import { describe, expect, it } from "vitest";

import { appShellContainerClassName, appShellMainClassName } from "./app-shell-layout";

describe("app shell layout classes", () => {
  it("keeps the shell pinned to the viewport so the sidebar does not scroll with long pages", () => {
    expect(appShellContainerClassName).toContain("h-dvh");
    expect(appShellContainerClassName).toContain("overflow-hidden");
    expect(appShellContainerClassName).not.toContain("min-h-dvh");
  });

  it("makes non-terminal content scroll inside the main pane", () => {
    expect(appShellMainClassName(false)).toContain("h-full");
    expect(appShellMainClassName(false)).toContain("overflow-auto");
  });

  it("keeps terminal routes locked to their internal terminal layout", () => {
    expect(appShellMainClassName(true)).toContain("h-full");
    expect(appShellMainClassName(true)).toContain("overflow-hidden");
  });
});
