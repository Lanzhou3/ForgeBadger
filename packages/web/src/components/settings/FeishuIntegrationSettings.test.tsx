// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import { FeishuIntegrationSettings } from "./FeishuIntegrationSettings";

const api = vi.hoisted(() => ({
  createBinding: vi.fn(),
  deleteBinding: vi.fn(),
  emergencyStop: vi.fn(),
  getAccount: vi.fn(),
  getHealth: vi.fn(),
  getPolicy: vi.fn(),
  getQueues: vi.fn(),
  listBindings: vi.fn(),
  listProjects: vi.fn(),
  listMappings: vi.fn(),
  replaceMappings: vi.fn(),
  saveAccount: vi.fn(),
  updatePolicy: vi.fn(),
  updateBinding: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  createFeishuConversationBinding: api.createBinding,
  deleteFeishuConversationBinding: api.deleteBinding,
  emergencyStopFeishu: api.emergencyStop,
  getFeishuChannelAccount: api.getAccount,
  getFeishuConnectionHealth: api.getHealth,
  getFeishuIntegrationConfig: api.getPolicy,
  getFeishuQueueSummary: api.getQueues,
  listFeishuConversationBindings: api.listBindings,
  listProjects: api.listProjects,
  listFeishuUserMappings: api.listMappings,
  replaceFeishuUserMappings: api.replaceMappings,
  saveFeishuChannelAccount: api.saveAccount,
  updateFeishuIntegrationConfig: api.updatePolicy,
  updateFeishuConversationBinding: api.updateBinding,
}));

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <FeishuIntegrationSettings />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("FeishuIntegrationSettings", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.setItem("openforge-language", "zh-CN");
    api.getAccount.mockResolvedValue({
      id: "account-1",
      appId: "cli_existing",
      enabled: true,
      secretConfigured: true,
      connectionState: "connected",
      configRevision: 2,
      updatedAt: "2026-08-12T00:00:00.000Z",
    });
    api.getHealth.mockResolvedValue({
      state: "connected",
      accountId: "account-1",
      configRevision: 2,
      reconnectAttempt: 0,
      lastConnectedAt: "2026-08-12T00:00:00.000Z",
      lastErrorMessage: null,
    });
    api.getQueues.mockResolvedValue({ inbox: { pending: 2 }, outbox: { retry: 1 } });
    api.getPolicy.mockResolvedValue({ enabled: true, emergencyDisabled: false, identityMode: "bot", allowedChatIds: ["oc_allowed"], commandPrefix: "/openforge" });
    api.listBindings.mockResolvedValue([]);
    api.listProjects.mockResolvedValue({ projects: [
      { id: "project-1", name: "OpenForge", path: "/tmp/openforge", aiTool: "claude", status: "active" }
    ] });
    api.listMappings.mockResolvedValue([{ feishuUserId: "ou_allowed" }]);
    api.saveAccount.mockResolvedValue({ id: "account-1" });
    api.updatePolicy.mockResolvedValue({});
    api.replaceMappings.mockResolvedValue([]);
    api.emergencyStop.mockResolvedValue(undefined);
    api.createBinding.mockResolvedValue({ id: "binding-1", chatId: "oc_manual", threadKey: "root", scope: { type: "workspace" } });
  });

  it("shows safe account metadata and channel health without exposing the secret", async () => {
    renderSettings();

    expect(await screen.findByDisplayValue("cli_existing")).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByPlaceholderText("已配置；留空则保持不变")).toBeTruthy();
    expect(screen.queryByDisplayValue("secret-value")).toBeNull();
    expect(screen.getByDisplayValue("oc_allowed")).toBeTruthy();
    expect(screen.getByDisplayValue("ou_allowed")).toBeTruthy();
  });

  it("submits an optional replacement secret and supports emergency stop", async () => {
    renderSettings();
    await screen.findByDisplayValue("cli_existing");

    fireEvent.change(screen.getByLabelText("App Secret"), { target: { value: "replacement-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存飞书配置" }));
    await waitFor(() => expect(api.saveAccount).toHaveBeenCalledWith({
      appId: "cli_existing",
      appSecret: "replacement-secret",
      enabled: true,
    }));
    expect(api.updatePolicy).toHaveBeenCalledWith(expect.objectContaining({ allowedChatIds: ["oc_allowed"] }));
    expect(api.replaceMappings).toHaveBeenCalledWith([{ feishuUserId: "ou_allowed", openforgeUserId: "self" }]);

    fireEvent.click(screen.getByRole("button", { name: "立即停用" }));
    await waitFor(() => expect(api.emergencyStop).toHaveBeenCalledTimes(1));
  });

  it("manually adds a binding and selects projects by name instead of raw id", async () => {
    renderSettings();
    await screen.findByDisplayValue("cli_existing");

    expect(screen.getByRole("option", { name: "OpenForge" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("会话 Chat ID"), { target: { value: "oc_manual" } });
    fireEvent.click(screen.getByRole("button", { name: "添加会话绑定" }));

    await waitFor(() => expect(api.createBinding).toHaveBeenCalledWith({
      chatId: "oc_manual",
      threadKey: "root",
      scope: { type: "workspace" }
    }));
  });
});
