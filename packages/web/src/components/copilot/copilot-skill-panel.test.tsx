// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopilotPlaybooksCard } from "./copilot-skill-panel";
import { LanguageProvider } from "@/hooks/use-language";
import type { CopilotPlaybook } from "@/lib/copilot-api";

const mocks = vi.hoisted(() => ({ list: vi.fn(), toggle: vi.fn(), save: vi.fn(), listSkills: vi.fn(), toggleSkill: vi.fn() }));
vi.mock("@/lib/copilot-api", () => ({ listCopilotPlaybooks: mocks.list, setCopilotPlaybookEnabled: mocks.toggle, updateCopilotPlaybook: mocks.save }));
vi.mock("@/lib/api", () => ({ listSkills: mocks.listSkills, toggleSkill: mocks.toggleSkill }));
const playbook: CopilotPlaybook = {
  id: "playbook-1", name: "project-review", description: "Review project status", content: "Preserved custom body",
  version: "2.0.0", currentVersion: "2.0.0", isEnabled: true, requiredTools: ["list_projects"], available: true,
  unavailableReason: null, reviewRequired: false, editable: true,
};
function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<LanguageProvider><QueryClientProvider client={client}><CopilotPlaybooksCard /></QueryClientProvider></LanguageProvider>);
}
async function openCard() {
  fireEvent.click(screen.getByRole("button", { name: "管理操作手册" }));
  return screen.findByRole("switch", { name: "project-review" });
}
describe("Copilot playbook boundary", () => {
  beforeEach(() => {
    cleanup(); vi.clearAllMocks();
    mocks.list.mockResolvedValue({ playbooks: [playbook] });
    mocks.toggle.mockResolvedValue({ playbook });
    mocks.save.mockResolvedValue({ playbook });
  });
  it("toggles isolated playbooks without invoking CLI Skills APIs", async () => {
    renderCard();
    const toggle = await openCard();
    expect(screen.getByText(/依赖工具: list_projects/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith("playbook-1", false));
    expect(mocks.listSkills).not.toHaveBeenCalled();
    expect(mocks.toggleSkill).not.toHaveBeenCalled();
  });
  it("preserves custom text for explicit review and saves against the displayed version", async () => {
    mocks.list.mockResolvedValue({ playbooks: [{ ...playbook, version: "1.0.0", isEnabled: false, available: false, reviewRequired: true }] });
    renderCard();
    const toggle = await openCard();
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/自定义正文已保留/)).toBeTruthy();
    expect(screen.getByText("已停用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑 / 核对正文" }));
    const editor = screen.getByRole("textbox", { name: "操作手册正文" }) as HTMLTextAreaElement;
    expect(editor.value).toBe("Preserved custom body");
    fireEvent.change(editor, { target: { value: "Reviewed body" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并确认版本" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("playbook-1", { content: "Reviewed body", version: "2.0.0" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });
  it("reports save and toggle failures and keeps the edit available for retry", async () => {
    mocks.toggle.mockRejectedValue(new Error("offline"));
    mocks.save.mockRejectedValue(new Error("stale version"));
    renderCard(); fireEvent.click(await openCard());
    expect(await screen.findByText("操作手册开关更新失败，请重试。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑 / 核对正文" }));
    fireEvent.click(screen.getByRole("button", { name: "保存并确认版本" }));
    expect(await screen.findByText(/操作手册保存失败/)).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Preserved custom body");
  });
  it("shows dependency unavailability without claiming usable playbooks", async () => {
    mocks.list.mockResolvedValue({ playbooks: [{ ...playbook, available: false, unavailableReason: "TOOL_DISABLED:list_projects", editable: false }] });
    renderCard(); await openCard();
    expect(screen.getByText(/TOOL_DISABLED:list_projects/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑 / 核对正文" })).toBeNull();
  });
  it("shows loading and then an empty catalog", async () => {
    let finish!: (value: { playbooks: CopilotPlaybook[] }) => void;
    mocks.list.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderCard();
    expect(screen.getByText("加载中...")).toBeTruthy();
    expect(screen.queryByText("暂无操作手册")).toBeNull();
    finish({ playbooks: [] });
    expect(await screen.findByText("暂无操作手册")).toBeTruthy();
  });
  it("shows a catalog load failure with retry", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ playbooks: [] });
    renderCard();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("暂无操作手册")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("暂无操作手册")).toBeTruthy();
  });
});
