import { describe, expect, it } from "vitest";

import { getCliBrand, runtimeAdapterLabel } from "./cli-brand";

const t = (key: string) => key;

describe("getCliBrand", () => {
  it("returns the brand for each supported CLI", () => {
    expect(getCliBrand("claude")).toMatchObject({ label: "Claude Code", color: "#d97757" });
    expect(getCliBrand("codex")).toMatchObject({ label: "Codex", color: "#e4e4e7" });
    expect(getCliBrand("kimi")).toMatchObject({ label: "Kimi Code", color: "#1783ff" });
    expect(getCliBrand("opencode")).toMatchObject({ label: "OpenCode", color: "#b7b1b1" });
  });

  it("normalizes casing and whitespace", () => {
    expect(getCliBrand(" Kimi ").id).toBe("kimi");
  });

  it("falls back for missing or unknown tools", () => {
    expect(getCliBrand(undefined).id).toBe("unknown");
    expect(getCliBrand(null).id).toBe("unknown");
    expect(getCliBrand("other-cli").id).toBe("unknown");
  });

  it("gives every supported CLI a distinct color", () => {
    const colors = ["claude", "codex", "kimi", "opencode"].map((id) => getCliBrand(id).color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("runtimeAdapterLabel", () => {
  const base = { label: "Claude Code" };

  it("returns the plain label for a launchable adapter", () => {
    expect(runtimeAdapterLabel({ ...base, available: true, launchEnabled: true }, t)).toBe(
      "Claude Code"
    );
  });

  it("suffixes unavailable adapters", () => {
    expect(runtimeAdapterLabel({ ...base, available: false, launchEnabled: true }, t)).toBe(
      "Claude Code (projects.runtimeUnavailable)"
    );
  });

  it("suffixes adapters with launch disabled before unavailability", () => {
    expect(runtimeAdapterLabel({ ...base, available: false, launchEnabled: false }, t)).toBe(
      "Claude Code (projects.runtimeUnavailable)"
    );
    expect(runtimeAdapterLabel({ ...base, available: true, launchEnabled: false }, t)).toBe(
      "Claude Code (projects.runtimeLaunchDisabled)"
    );
  });
});
