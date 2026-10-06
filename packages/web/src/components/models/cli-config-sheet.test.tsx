// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import { CliConfigSheet } from "./cli-config-sheet";

const {
  getCliConfigMock,
  getCliConfigFileMock,
  getCliConfigFieldsMock,
  getCliConfigFieldValuesMock,
  writeCliConfigFileMock,
} = vi.hoisted(() => ({
  getCliConfigMock: vi.fn(),
  getCliConfigFileMock: vi.fn(),
  getCliConfigFieldsMock: vi.fn(),
  getCliConfigFieldValuesMock: vi.fn(),
  writeCliConfigFileMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getCliConfig: getCliConfigMock,
    getCliConfigFile: getCliConfigFileMock,
    getCliConfigFields: getCliConfigFieldsMock,
    getCliConfigFieldValues: getCliConfigFieldValuesMock,
    writeCliConfigFile: writeCliConfigFileMock,
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", role: "admin" }, logout: vi.fn() }),
}));

vi.mock("@/components/projects/workspace/highlight", () => ({
  highlightWorkspaceCode: vi.fn(async (_content: string, _fileName: string) => []),
  tokenFontStyle: () => ({ italic: false, bold: false, underline: false }),
}));

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  return {
    onOpenChange,
    ...render(
      <LanguageProvider>
        <QueryClientProvider client={client}>
          <CliConfigSheet open adapter="claude" onOpenChange={onOpenChange} />
        </QueryClientProvider>
      </LanguageProvider>
    ),
  };
}

describe("CliConfigSheet raw editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCliConfigFieldsMock.mockResolvedValue({ fields: [] });
    getCliConfigFieldValuesMock.mockResolvedValue({ values: {} });
    getCliConfigMock.mockResolvedValue({
      adapter: "claude",
      configRoot: "/home/u/.claude",
      configFile: "/home/u/.claude/settings.json",
      defaultModel: "",
      providers: [],
      models: [],
      files: [
        { relativePath: "settings.json", fileType: "json", exists: true, sizeBytes: 2048 },
      ],
    });
    getCliConfigFileMock.mockResolvedValue({ content: '{"original": true}' });
    writeCliConfigFileMock.mockResolvedValue({ ok: true });
  });

  afterEach(cleanup);

  it("disables save until the draft differs from the loaded file", async () => {
    renderSheet();
    const editButton = await screen.findByRole("button", { name: /编辑/ });
    await waitFor(() => expect((editButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(editButton);

    const editor = await screen.findByLabelText("全局配置编辑");
    expect((editor as HTMLTextAreaElement).value).toBe('{"original": true}');
    const saveButton = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    fireEvent.change(editor, { target: { value: '{"original": false}' } });
    await waitFor(() => expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("confirms before closing with unsaved edits", async () => {
    const { onOpenChange } = renderSheet();
    const editButton = await screen.findByRole("button", { name: /编辑/ });
    await waitFor(() => expect((editButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(editButton);
    const editor = await screen.findByLabelText("全局配置编辑");
    fireEvent.change(editor, { target: { value: "modified" } });

    // Escape on the sheet requests close; dirty draft must trigger a confirm.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    await screen.findByText("放弃未保存的修改？");
    expect(writeCliConfigFileMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
