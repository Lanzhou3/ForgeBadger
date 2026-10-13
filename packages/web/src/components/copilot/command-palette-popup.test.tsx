// @vitest-environment jsdom
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as api from "@/lib/copilot-api";
import { CommandPalettePopup, useCommandPalette } from "./command-palette-popup";

vi.mock("@/lib/copilot-api", async (original) => ({
  ...await original<typeof import("@/lib/copilot-api")>(),
  listCopilotCommands: vi.fn(),
}));

let client: QueryClient;
let applied: string[];

const COMMANDS: api.CopilotCommandInfo[] = [
  { name: "help", usage: "/help", description: "Show help", category: "info" },
  { name: "goal", usage: "/goal <描述>", description: "Create a goal", category: "goal" },
  { name: "goals", usage: "/goals", description: "List goals", category: "goal" },
  { name: "diff", usage: "/diff", description: "Show diff", category: "goal" },
  { name: "model", usage: "/model", description: "Show model", category: "model" },
  { name: "status", usage: "/status", description: "Show status", category: "session" },
];

/** Minimal real wiring: a controlled textarea plus the popup above it. */
function Harness() {
  const [input, setInput] = useState("");
  const palette = useCommandPalette(input, (text) => {
    applied.push(text);
    setInput(text);
  });
  return (
    <div className="relative">
      <CommandPalettePopup view={palette.view} onHoverItem={palette.hoverItem} onPickItem={palette.pickItem} />
      <textarea
        aria-label="composer"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          palette.handleTextareaKeyDown(event);
        }}
      />
    </div>
  );
}

function type(text: string) {
  const composer = screen.getByLabelText("composer");
  fireEvent.change(composer, { target: { value: text } });
}

function pressKey(key: string) {
  fireEvent.keyDown(screen.getByLabelText("composer"), { key });
}

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  applied = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.listCopilotCommands).mockResolvedValue({ commands: COMMANDS });
});

afterEach(() => {
  client.clear();
});

function mount() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

it("opens the palette on '/' and lists all commands grouped by category", async () => {
  mount();
  type("/");
  const palette = await screen.findByTestId("command-palette");
  expect(palette.textContent).toContain("goal");
  expect(palette.textContent).toContain("goals");
  expect(palette.textContent).toContain("help");
  expect(palette.textContent).toContain("status");
  expect(palette.textContent).toContain("创建长期目标");
  // Category headers in fixed order: Goal before Session/Model/Info.
  const goalHeader = (await screen.findAllByText("Goal")).find((el) => el.tagName === "P")!;
  const modelHeader = (await screen.findAllByText("模型")).find((el) => el.tagName === "P")!;
  expect(goalHeader.compareDocumentPosition(modelHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("fuzzy-filters '/gl' down to goal/goals and ranks exact/prefix hits first", async () => {
  mount();
  type("/gl");
  const palette = await screen.findByTestId("command-palette");
  expect(palette.textContent).toContain("goal");
  expect(palette.textContent).toContain("goals");
  expect(palette.textContent).not.toContain("help");

  type("/goal");
  const names = Array.from(palette.querySelectorAll("button")).map((button) => button.textContent);
  expect(names[0]).toContain("/goal");
  expect(names[1]).toContain("/goals");
});

it("moves the highlight with arrows and applies '/goals ' on Enter", async () => {
  mount();
  type("/g");
  await screen.findByTestId("command-palette");
  pressKey("ArrowDown");
  const active = screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true")!;
  expect(active.textContent).toContain("/goals");
  pressKey("Enter");
  expect(applied).toEqual(["/goals "]);
  // Palette collapses into the usage-hint phase for the applied command.
  expect((await screen.findByTestId("command-usage-hint")).textContent).toContain("/goals");
});

it("applies the highlighted command on Tab as well", async () => {
  mount();
  type("/go");
  await screen.findByTestId("command-palette");
  pressKey("Tab");
  expect(applied).toEqual(["/goal "]);
});

it("closes on Escape and reopens when the input changes again", async () => {
  mount();
  type("/g");
  await screen.findByTestId("command-palette");
  pressKey("Escape");
  expect(screen.queryByTestId("command-palette")).toBeNull();
  type("/go");
  expect(await screen.findByTestId("command-palette")).toBeTruthy();
});

it("hides the palette after a space and shows a one-line usage hint instead", async () => {
  mount();
  type("/goal ");
  expect(screen.queryByTestId("command-palette")).toBeNull();
  const hint = await screen.findByTestId("command-usage-hint");
  expect(hint.textContent).toContain("/goal <描述>");
  expect(hint.textContent).toContain("创建长期目标");
});

it("shows the no-match empty state for unknown commands", async () => {
  mount();
  type("/xyz");
  const palette = await screen.findByTestId("command-palette");
  expect(palette.textContent).toContain("无匹配命令");
  expect(palette.querySelectorAll("button").length).toBe(0);
});

it("falls back to the server description when no localized copy exists", async () => {
  vi.mocked(api.listCopilotCommands).mockResolvedValue({
    commands: [{ name: "brandnew", usage: "/brandnew", description: "Server-provided English text", category: "info" }],
  });
  mount();
  type("/b");
  const palette = await screen.findByTestId("command-palette");
  expect(palette.textContent).toContain("Server-provided English text");
});
