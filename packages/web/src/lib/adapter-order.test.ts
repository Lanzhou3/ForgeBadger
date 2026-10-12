import { describe, expect, it } from "vitest";

import { orderAdapters } from "@/lib/adapter-order";

const discovery = [
  { id: "claude" },
  { id: "opencode" },
  { id: "codex" },
  { id: "kimi" },
] as const;

describe("orderAdapters", () => {
  it("returns the discovery order when no preference is saved", () => {
    expect(orderAdapters(discovery, []).map((entry) => entry.id)).toEqual([
      "claude",
      "opencode",
      "codex",
      "kimi",
    ]);
  });

  it("puts preferred ids first in preference order", () => {
    expect(orderAdapters(discovery, ["kimi", "codex"]).map((entry) => entry.id)).toEqual([
      "kimi",
      "codex",
      "claude",
      "opencode",
    ]);
  });

  it("keeps adapters missing from the preference in their original relative order", () => {
    expect(orderAdapters(discovery, ["opencode"]).map((entry) => entry.id)).toEqual([
      "opencode",
      "claude",
      "codex",
      "kimi",
    ]);
  });

  it("ignores preference ids that are not in the discovery list", () => {
    expect(orderAdapters(discovery, ["future-cli", "kimi"]).map((entry) => entry.id)).toEqual([
      "kimi",
      "claude",
      "opencode",
      "codex",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...discovery];
    orderAdapters(input, ["kimi"]);
    expect(input.map((entry) => entry.id)).toEqual(["claude", "opencode", "codex", "kimi"]);
  });
});
