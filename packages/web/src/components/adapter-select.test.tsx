// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdapterDiscovery, RuntimeAdapterId } from "@/lib/api";

import { AdapterSelect, chooseDefaultAdapter, isAdapterSelectable } from "./adapter-select";

const { discoverAdaptersMock } = vi.hoisted(() => ({
  discoverAdaptersMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    discoverAdapters: discoverAdaptersMock,
  };
});

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({
    language: "en",
    setLanguage: vi.fn(),
    t: (key: string) => key,
  }),
}));

function makeAdapter(
  id: RuntimeAdapterId,
  overrides: Partial<AdapterDiscovery> = {}
): AdapterDiscovery {
  return {
    id,
    label: id,
    command: id,
    supportLevel: "supported",
    launchEnabled: true,
    configDir: `.${id}`,
    runtimeModes: ["terminal"],
    available: true,
    status: "available",
    ...overrides,
  };
}

const CLAUDE = makeAdapter("claude", { label: "Claude Code", version: "2.0.0" });
const OPENCODE = makeAdapter("opencode", { label: "OpenCode" });
const CODEX = makeAdapter("codex", {
  label: "Codex CLI",
  available: false,
  status: "missing",
  error: "codex not found",
});
const KIMI = makeAdapter("kimi", { label: "Kimi Code" });

function renderAdapterSelect(props: Partial<ComponentProps<typeof AdapterSelect>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdapterSelect value="" onValueChange={vi.fn()} {...props} />
    </QueryClientProvider>
  );
}

async function openAdapterSelect() {
  const trigger = await screen.findByRole("combobox");
  // The trigger is disabled until discovery resolves; wait for it first.
  await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("AdapterSelect", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // jsdom implements neither Pointer Capture nor scrollIntoView; Radix
    // Select calls both while opening/rendering its content.
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    discoverAdaptersMock.mockResolvedValue({ adapters: [CLAUDE, OPENCODE, CODEX, KIMI] });
  });

  it("lists detected CLIs with brand labels and marks missing ones as disabled", async () => {
    renderAdapterSelect({ value: "claude" });

    await openAdapterSelect();

    expect(await screen.findByRole("option", { name: "Claude Code" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "OpenCode" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Kimi Code" })).toBeTruthy();
    const missingOption = screen.getByRole("option", {
      name: "Codex CLI (projects.runtimeUnavailable)",
    });
    expect(missingOption.getAttribute("aria-disabled")).toBe("true");
  });

  it("disables adapters outside the supported subset while keeping them visible", async () => {
    renderAdapterSelect({ value: "claude", supported: ["claude"] });

    await openAdapterSelect();

    const selectedOption = await screen.findByRole("option", { name: "Claude Code" });
    expect(selectedOption.getAttribute("aria-disabled")).toBeNull();
    expect(
      screen.getByRole("option", { name: "OpenCode (models.adapterNotSupported)" }).getAttribute("aria-disabled")
    ).toBe("true");
    expect(
      screen.getByRole("option", { name: "Kimi Code (models.adapterNotSupported)" }).getAttribute("aria-disabled")
    ).toBe("true");
  });

  it("hides undetected adapters when showMissing is false", async () => {
    renderAdapterSelect({ value: "claude", showMissing: false });

    await openAdapterSelect();

    await screen.findByRole("option", { name: "Claude Code" });
    expect(screen.queryByRole("option", { name: /Codex CLI/ })).toBeNull();
  });

  it("labels a failed probe as detection failed rather than missing", async () => {
    discoverAdaptersMock.mockResolvedValue({
      adapters: [
        CLAUDE,
        makeAdapter("kimi", {
          label: "Kimi Code",
          available: false,
          status: "check_failed",
          error: "Command timed out after 10000ms"
        })
      ]
    });

    renderAdapterSelect({ value: "claude" });

    await openAdapterSelect();

    const option = screen.getByRole("option", {
      name: "Kimi Code (projects.runtimeCheckFailed)"
    });
    expect(option.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("adapter selection helpers", () => {
  it("prefers an installed and supported adapter, then falls back to the first selectable one", () => {
    const adapters = [CLAUDE, OPENCODE, CODEX, KIMI];
    expect(chooseDefaultAdapter(adapters, ["claude", "opencode"], "codex")).toBe("claude");
    expect(chooseDefaultAdapter(adapters, ["opencode"])).toBe("opencode");
    expect(chooseDefaultAdapter(adapters, ["claude"])).toBe("claude");
    expect(chooseDefaultAdapter(adapters, ["codex"])).toBeUndefined();
    expect(chooseDefaultAdapter([], ["claude"])).toBeUndefined();
  });

  it("only treats launchable adapters inside the supported subset as selectable", () => {
    expect(isAdapterSelectable(CLAUDE, ["claude"])).toBe(true);
    expect(isAdapterSelectable(CLAUDE, ["codex"])).toBe(false);
    expect(isAdapterSelectable(CODEX, ["codex"])).toBe(false);
    expect(isAdapterSelectable({ ...CLAUDE, launchEnabled: false })).toBe(false);
  });
});
