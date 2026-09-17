// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as api from "@/lib/copilot-extensions-api";
import { CopilotSkillsPanel } from "./CopilotSkillsPanel";
vi.mock("@/lib/copilot-extensions-api", async original => ({ ...await original<typeof import("@/lib/copilot-extensions-api")>(), listCopilotSkills: vi.fn(), getCopilotSkill: vi.fn(), importCopilotSkill: vi.fn(), updateCopilotSkill: vi.fn(), setCopilotSkillEnabled: vi.fn(), listSkillRevisions: vi.fn(), getSkillRevision: vi.fn(), rollbackCopilotSkill: vi.fn() }));
const files = [{ path: "SKILL.md", content: "---\nname: review\n---\nReview" }, { path: "references/check.md", content: "Reference" }];
const skill: api.CopilotSkillDetail = { id: "s1", name: "Review", description: "Project review", kind: "imported", version: "1.0.0", currentVersion: "1.0.0", revisionId: "r1", source: { kind: "upload", label: "review" }, isEnabled: false, available: false, unavailableReason: "disabled", compatible: true, incompatibilityReasons: [], requiredTools: ["list_projects"], reviewRequired: false, editable: true, updatedAt: "2026-09-18", files, content: "Review" };
let client: QueryClient;
function mount() { render(<LanguageProvider><QueryClientProvider client={client}><CopilotSkillsPanel /></QueryClientProvider></LanguageProvider>); }
beforeEach(() => { cleanup(); vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); vi.mocked(api.listCopilotSkills).mockResolvedValue({ skills: [skill] }); vi.mocked(api.getCopilotSkill).mockResolvedValue({ skill }); });
it("imports pasted SKILL.md as a separate disabled package", async () => {
  vi.mocked(api.importCopilotSkill).mockResolvedValue({ skill }); mount(); fireEvent.click(screen.getByRole("button", { name: "导入 Skill" }));
  fireEvent.change(screen.getByLabelText("SKILL.md 正文"), { target: { value: files[0]!.content } }); fireEvent.click(screen.getByRole("button", { name: "导入并保留为停用" }));
  await waitFor(() => expect(api.importCopilotSkill).toHaveBeenCalledWith({ source: { kind: "paste" }, files: [files[0]] }));
});
it("imports public raw URLs without pretending supporting files were included", async () => {
  vi.mocked(api.importCopilotSkill).mockResolvedValue({ skill }); mount(); fireEvent.click(screen.getByRole("button", { name: "导入 Skill" })); fireEvent.change(screen.getByLabelText("导入方式"), { target: { value: "url" } });
  expect(screen.getByText(/公开 HTTPS raw URL 导入单个/)).toBeTruthy(); fireEvent.change(screen.getByLabelText("公开 raw URL"), { target: { value: "https://example.com/SKILL.md" } }); fireEvent.click(screen.getByRole("button", { name: "导入并保留为停用" }));
  await waitFor(() => expect(api.importCopilotSkill).toHaveBeenCalledWith({ source: { kind: "url", url: "https://example.com/SKILL.md" } }));
});
it("edits one file while preserving full package and expected revision", async () => {
  vi.mocked(api.updateCopilotSkill).mockResolvedValue({ skill }); mount(); fireEvent.click(await screen.findByRole("button", { name: "详情与版本" }));
  const editor = await screen.findByRole("textbox", { name: "SKILL.md" }); fireEvent.change(editor, { target: { value: "Updated review" } }); fireEvent.click(screen.getByRole("button", { name: "保存完整文件包" }));
  await waitFor(() => expect(api.updateCopilotSkill).toHaveBeenCalledWith("s1", { expectedRevisionId: "r1", files: [{ path: "SKILL.md", content: "Updated review" }, files[1]] }));
});
it("blocks incompatible enablement and clearly shows dependencies", async () => {
  vi.mocked(api.listCopilotSkills).mockResolvedValue({ skills: [{ ...skill, compatible: false, incompatibilityReasons: ["script_execution_unsupported"] }] }); mount();
  expect(await screen.findByRole("switch", { name: "Review" })).toHaveProperty("disabled", true); expect(screen.getByText(/script_execution_unsupported/)).toBeTruthy(); expect(screen.getByText(/依赖工具: list_projects/)).toBeTruthy();
});
it("requires explicit current-version review for preserved builtin copies", async () => {
  const builtin = { ...skill, kind: "builtin-playbook" as const, currentVersion: "2.0.0", reviewRequired: true }; vi.mocked(api.listCopilotSkills).mockResolvedValue({ skills: [builtin] }); vi.mocked(api.getCopilotSkill).mockResolvedValue({ skill: builtin }); vi.mocked(api.updateCopilotSkill).mockResolvedValue({ skill: builtin }); mount();
  expect(await screen.findByRole("switch", { name: "Review" })).toHaveProperty("disabled", true); fireEvent.click(screen.getByRole("button", { name: "详情与版本" })); await screen.findByRole("textbox", { name: "SKILL.md" }); fireEvent.click(screen.getByRole("button", { name: "保存完整文件包" }));
  await waitFor(() => expect(api.updateCopilotSkill).toHaveBeenCalledWith("s1", { expectedRevisionId: "r1", files, reviewedVersion: "2.0.0" }));
});
it("previews immutable historical files before revision-bound rollback", async () => {
  const revision = { id: "r0", version: "0.9.0", source: { kind: "upload" as const }, createdAt: "2026-09-17", packageDigest: "digest", fileCount: 2, action: "import" as const };
  vi.mocked(api.listSkillRevisions).mockResolvedValue({ revisions: [revision] }); vi.mocked(api.getSkillRevision).mockResolvedValue({ revision: { ...revision, files } }); vi.mocked(api.rollbackCopilotSkill).mockResolvedValue({ skill }); mount(); fireEvent.click(await screen.findByRole("button", { name: "详情与版本" }));
  fireEvent.click(await screen.findByRole("button", { name: "版本记录" })); fireEvent.click(await screen.findByRole("button", { name: "回滚到此版本" })); fireEvent.click(await screen.findByRole("button", { name: "确认回滚" }));
  await waitFor(() => expect(api.rollbackCopilotSkill).toHaveBeenCalledWith("s1", "r0", "r1")); expect(api.getSkillRevision).toHaveBeenCalledWith("s1", "r0");
});
it("keeps failed edits available without echoing errors or losing package files", async () => {
  vi.mocked(api.updateCopilotSkill).mockRejectedValue(new Error("untrusted content")); mount(); fireEvent.click(await screen.findByRole("button", { name: "详情与版本" })); const editor = await screen.findByRole("textbox", { name: "SKILL.md" }); fireEvent.click(screen.getByRole("button", { name: "保存完整文件包" }));
  await screen.findByRole("alert"); expect(editor).toHaveProperty("value", files[0]!.content); expect(screen.queryByText("untrusted content")).toBeNull();
});

it("uploads selected complete file bundles including nested reference files", async () => {
  vi.mocked(api.importCopilotSkill).mockResolvedValue({ skill }); mount(); fireEvent.click(screen.getByRole("button", { name: "导入 Skill" }));
  fireEvent.change(screen.getByLabelText("导入方式"), { target: { value: "upload" } });
  const browserFiles = files.map(file => ({ name: file.path.split("/").at(-1), webkitRelativePath: `review/${file.path}`, size: new TextEncoder().encode(file.content).byteLength, arrayBuffer: async () => new TextEncoder().encode(file.content).buffer }));
  fireEvent.change(screen.getByLabelText("选择文件夹"), { target: { files: browserFiles } });
  await screen.findByText("已选择文件: 2"); fireEvent.click(screen.getByRole("button", { name: "导入并保留为停用" }));
  await waitFor(() => expect(api.importCopilotSkill).toHaveBeenCalledWith({ source: { kind: "upload" }, files }));
});
it("shows an empty catalog and retries a failed list request", async () => {
  vi.mocked(api.listCopilotSkills).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ skills: [] }); mount();
  await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "重试" })); expect(await screen.findByText("尚未安装 Skill。")).toBeTruthy();
});
it("toggles only the selected Skill revision and reports failure", async () => {
  vi.mocked(api.setCopilotSkillEnabled).mockRejectedValue(new Error("stale revision")); mount(); fireEvent.click(await screen.findByRole("switch", { name: "Review" }));
  await screen.findByRole("alert"); expect(api.setCopilotSkillEnabled).toHaveBeenCalledWith("s1", true, "r1"); expect(screen.getByRole("switch", { name: "Review" }).getAttribute("aria-checked")).toBe("false");
});
