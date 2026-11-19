// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotMemoryPanel } from "./copilot-memory-panel";
import * as copilotApi from "@/lib/copilot-api";

vi.mock("@/lib/copilot-api", async (original) => ({
  ...(await original<typeof import("@/lib/copilot-api")>()),
  listMemoryEntries: vi.fn(),
  deleteMemoryEntry: vi.fn(),
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <CopilotMemoryPanel />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("CopilotMemoryPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows search input when more than 3 entries exist and filters results with empty state", async () => {
    vi.mocked(copilotApi.listMemoryEntries).mockResolvedValue({
      entries: [
        { id: "m1", userId: "u1", scope: "global", kind: "fact", text: "Uses pnpm workspace", metadataJson: "{}", createdAt: "", updatedAt: "" },
        { id: "m2", userId: "u1", scope: "global", kind: "decision", text: "Prefer Drizzle ORM", metadataJson: "{}", createdAt: "", updatedAt: "" },
        { id: "m3", userId: "u1", scope: "global", kind: "preference", text: "Concise replies", metadataJson: "{}", createdAt: "", updatedAt: "" },
        { id: "m4", userId: "u1", scope: "global", kind: "project_note", text: "Gateway port 18332", metadataJson: "{}", createdAt: "", updatedAt: "" },
      ],
    });
    mount();
    expect(await screen.findByText("Uses pnpm workspace")).toBeTruthy();
    const search = screen.getByRole("textbox", { name: "搜索记忆…" });
    fireEvent.change(search, { target: { value: "Drizzle" } });
    expect(screen.getByText("Prefer Drizzle ORM")).toBeTruthy();
    expect(screen.queryByText("Uses pnpm workspace")).toBeNull();

    fireEvent.change(search, { target: { value: "nonexistent-term" } });
    expect(screen.getByText("没有匹配的记忆条目。")).toBeTruthy();
  });

  it("hides search input when 3 or fewer entries exist", async () => {
    vi.mocked(copilotApi.listMemoryEntries).mockResolvedValue({
      entries: [
        { id: "m1", userId: "u1", scope: "global", kind: "fact", text: "Single fact", metadataJson: "{}", createdAt: "", updatedAt: "" },
      ],
    });
    mount();
    expect(await screen.findByText("Single fact")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "搜索记忆…" })).toBeNull();
  });
});
