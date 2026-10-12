// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { runtimeAdapterIds, type ProviderSupportedAdapter, type RuntimeAdapterId } from "@/lib/api";
import { getCliBrand, type CliBrandId } from "@/lib/cli-brand";

/**
 * Regression guard for adapter-list drift.
 *
 * The web surface historically spelled the adapter list out at every picker,
 * and that already drifted: `ExtractTemplateDialog` shipped without `pi`, and
 * `GitTemplateImportResult` omitted it. The symptom is silent — a picker simply
 * does not offer an adapter the gateway fully supports. These assertions fail
 * the moment someone adds a gateway adapter without extending the web unions.
 */
describe("runtimeAdapterIds", () => {
  it("covers every adapter the gateway ships", () => {
    expect([...runtimeAdapterIds]).toEqual(["claude", "opencode", "codex", "kimi", "pi", "mcode"]);
  });

  it("is assignable to the unions that model adapter ids", () => {
    const asRuntime: RuntimeAdapterId[] = [...runtimeAdapterIds];
    const asProvider: ProviderSupportedAdapter[] = [...runtimeAdapterIds];
    const asBrand: CliBrandId[] = [...runtimeAdapterIds];

    expect(asRuntime).toHaveLength(6);
    expect(asProvider).toHaveLength(6);
    expect(asBrand).toHaveLength(6);
  });

  it("resolves a brand for every adapter", () => {
    for (const id of runtimeAdapterIds) {
      expect(getCliBrand(id).id).toBe(id);
    }
  });

  it("resolves MiniMax Code by its adapter id", () => {
    const brand = getCliBrand("mcode");
    expect(brand.label).toBe("MiniMax Code");
    // Accent is the product's own brand blue (#68C0FF, from the CLI's
    // built-in TUI "minimax" theme), not a placeholder.
    expect(brand.color).toBe("#68c0ff");
  });

  it("still falls back for an unknown adapter instead of throwing", () => {
    expect(getCliBrand("not-a-cli").id).toBe("unknown");
    expect(getCliBrand(undefined).id).toBe("unknown");
  });
});
