// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as api from "@/lib/copilot-machine-roots-api";
import { CopilotMachineRootsPanel } from "./CopilotMachineRootsPanel";
vi.mock("@/lib/copilot-machine-roots-api", async original => ({ ...await original<typeof import("@/lib/copilot-machine-roots-api")>(), listCopilotMachineRoots: vi.fn(), registerCopilotMachineRoot: vi.fn(), deleteCopilotMachineRoot: vi.fn() }));
const root: api.MachineRoot = { id: "r1", label: "Docs", path: "D:\\notes" };
let client: QueryClient;
function mount() { render(<LanguageProvider><QueryClientProvider client={client}><CopilotMachineRootsPanel /></QueryClientProvider></LanguageProvider>); }
beforeEach(() => { cleanup(); vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); vi.mocked(api.listCopilotMachineRoots).mockResolvedValue({ roots: [root] }); });
it("lists the owner's registered roots", async () => { mount(); expect(await screen.findByText("Docs")).toBeTruthy(); expect(screen.getByText("D:\\notes")).toBeTruthy(); });
it("registers a trimmed label+path and the action never caches the raw path in a query key", async () => {
  vi.mocked(api.registerCopilotMachineRoot).mockResolvedValue({ root }); mount();
  fireEvent.click(screen.getByRole("button", { name: "添加检索根" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "  My docs  " } });
  fireEvent.change(screen.getByLabelText("本地目录（绝对路径）"), { target: { value: "D:\\notes\\sub" } });
  fireEvent.click(screen.getByRole("button", { name: "注册" }));
  await waitFor(() => expect(api.registerCopilotMachineRoot).toHaveBeenCalledWith({ label: "My docs", path: "D:\\notes\\sub" }));
});
it("removes a root only after the explicit confirm dialog", async () => {
  vi.mocked(api.deleteCopilotMachineRoot).mockResolvedValue({ unregistered: true }); mount();
  await screen.findByText("Docs");
  fireEvent.click(screen.getByRole("button", { name: "移除" }));
  const dialog = await screen.findByRole("dialog");
  expect(api.deleteCopilotMachineRoot).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "移除" }));
  await waitFor(() => expect(api.deleteCopilotMachineRoot).toHaveBeenCalledWith("r1"));
});
it("surfaces a load failure with a retry affordance", async () => {
  vi.mocked(api.listCopilotMachineRoots).mockRejectedValue(new Error("offline")); mount();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
});
