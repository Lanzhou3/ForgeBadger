import { beforeEach, describe, expect, it, vi } from "vitest";

import * as apiModule from "./api";
import {
  createAgent,
  createApiKey,
  checkModelHealth,
  checkModelEndpointHealth,
  checkModelProviderReadiness,
  cloneTemplate,
  approveCopilotPendingAction,
  cancelCopilotRun,
  createProjectWithConfig,
  createCopilotConversation,
  createCopilotConversationMessage,
  createCopilotRun,
  createTemplateFromProject,
  createSkill,
  createModel,
  createTemplate,
  createSession,
  deleteProviderCredential,
  deleteCopilotConversation,
  deleteCopilotMemoryItem,
  deleteCopilotMessage,
  deleteModelProvider,
  deleteProviderModel,
  chooseDefaultRuntimeAdapter,
  isAdapterLaunchable,
  deleteModel,
  deleteAgent,
  deleteSkill,
  deleteTemplate,
  defaultConfigConflictDecisions,
  discoverAdapters,
  exportDiagnostics,
  exportTemplate,
  getCopilotCapabilities,
  getCopilotMemoryItem,
  getCopilotRun,
  listCopilotConversationMessages,
  listCopilotConversations,
  listCopilotMemoryEntries,
  listCopilotMemoryNotes,
  getDashboardSummary,
  getDependencies,
  getFeishuIntegrationConfig,
  getFeishuIntegrationStatus,
  listFeishuUserMappings,
  replaceFeishuUserMappings,
  updateFeishuIntegrationConfig,
  getConfigCompliance,
  getGlobalAiConfig,
  getProjectAgentSequence,
  getProjectAiConfig,
  getProjectWorkspaceFile,
  getProjectWorkspaceTree,
  createDefaultAgentPack,
  createGateASession,
  listAdminUsers,
  listAgentTemplates,
  installSkill,
  importTemplate,
  importProjectWithConfig,
  installCatalogTemplate,
  installCatalogSkill,
  installCatalogPlugin,
  getUsageSummary,
  listActivities,
  listAuditLogs,
  listCatalogItems,
  listCatalogSources,
  listCopilotRuns,
  listNotifications,
  listSessions,
  listSnapshots,
  listUsageRates,
  listSkillTemplates,
  listSkillSources,
  syncLocalSkills,
  syncProviderModels,
  searchCopilotMemory,
  rotateProviderCredential,
  setDefaultProviderModel,
  updateProviderModel,
  listPlugins,
  refreshCatalog,
  restoreTemplateVersion,
  restoreSnapshot,
  setUsageRate,
  listTemplateVersions,
  listApiKeys,
  listModelGroups,
  listModelPresets,
  listProjectSkills,
  applyConfigSync,
  previewConfig,
  previewConfigSync,
  previewSkillSource,
  previewTemplateFromProject,
  rotateApiKey,
  rejectCopilotPendingAction,
  markAllNotificationsRead,
  markNotificationRead,
  clearServerNotifications,
  initializeCodexAppServer,
  getCodexAppServerCapabilities,
  listCodexAppServers,
  setDefaultModel,
  startCodexAppServer,
  startCodexAppServerThread,
  startCodexAppServerTurn,
  setProjectSkill,
  stopCodexAppServer,
  togglePlugin,
  updateAgent,
  updateAdminUser,
  updateCopilotConversation,
  updateProjectAgentSequence,
  updateProjectAiConfigFile,
  updateSkill,
  updateTemplate,
  updateTemplateFile,
  updateModel,
  writeConfig,
  type ProjectManagerEvidenceRef,
  type ProjectManagerLedgerEvent,
  type AdapterDiscovery,
} from "./api";

type ProjectManagerApiClient = {
  getProjectManagerGoal: (projectId: string) => Promise<unknown>;
  updateProjectManagerGoal: (projectId: string, input: unknown) => Promise<unknown>;
  listProjectManagerWorkItems: (projectId: string, params?: unknown) => Promise<unknown>;
  createProjectManagerWorkItem: (projectId: string, input: unknown) => Promise<unknown>;
  getProjectManagerWorkItem: (projectId: string, workItemId: string) => Promise<unknown>;
  updateProjectManagerWorkItem: (projectId: string, workItemId: string, input: unknown) => Promise<unknown>;
  updateProjectManagerWorkItemStatus: (projectId: string, workItemId: string, input: unknown) => Promise<unknown>;
  batchUpdateProjectManagerWorkItemStatuses: (projectId: string, input: unknown) => Promise<unknown>;
  attachProjectManagerWorkItemEvidence: (projectId: string, workItemId: string, input: unknown) => Promise<unknown>;
  deleteProjectManagerWorkItem: (projectId: string, workItemId: string, input: unknown) => Promise<unknown>;
  listProjectManagerTaskPackets: (projectId: string, params?: unknown) => Promise<unknown>;
  getProjectManagerTaskPacket: (projectId: string, workItemId: string) => Promise<unknown>;
  listProjectManagerStarterPacks: (projectId: string) => Promise<unknown>;
  createProjectManagerStarterPackTaskPacket: (projectId: string, packId: string) => Promise<unknown>;
  linkProjectManagerTaskPacketSession: (
    projectId: string,
    workItemId: string,
    input: { sessionId: string }
  ) => Promise<unknown>;
  startProjectManagerTaskPacket: (projectId: string, workItemId: string) => Promise<unknown>;
  listProjectManagerLedger: (projectId: string, params?: unknown) => Promise<unknown>;
};

const projectManagerApi = apiModule as unknown as ProjectManagerApiClient;

function mockEnvelope(data: unknown = {}) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ code: 0, data, message: "" }),
  } as Response);
}

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({})));
  });

  it("creates models with provider model id and endpoint", async () => {
    await createModel({
      name: "Claude Sonnet",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      endpoint: "https://api.anthropic.com",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/models",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Claude Sonnet",
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
          endpoint: "https://api.anthropic.com",
        }),
      })
    );
  });

  it("reports aborted gateway requests as a clear timeout error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("signal is aborted without reason", "AbortError"))));

    await expect(apiModule.login("user@example.com", "password")).rejects.toMatchObject({
      message: "Gateway request timed out. Check that the Gateway service is running."
    });
  });

  it("deletes model provider profiles through REST", async () => {
    await deleteModelProvider("provider-1");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/model-providers/provider-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("syncs provider models through REST", async () => {
    await syncProviderModels("provider-1", { credentialId: "credential-1" });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/model-providers/provider-1/models/sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ credentialId: "credential-1" }),
      })
    );
  });

  it("checks model provider readiness through REST", async () => {
    await checkModelProviderReadiness("provider-1", {
      adapter: "claude",
      modelProfileId: "model-1",
      credentialId: "credential-1",
      includeRemoteCheck: true,
      timeoutMs: 5000,
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/model-providers/provider-1/readiness",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          adapter: "claude",
          modelProfileId: "model-1",
          credentialId: "credential-1",
          includeRemoteCheck: true,
          timeoutMs: 5000,
        }),
      })
    );
  });

  it("manages provider model profiles through REST", async () => {
    await updateProviderModel("provider-1", "model-1", {
      name: "Updated",
      capabilities: ["chat", "reasoning"],
    });
    await setDefaultProviderModel("provider-1", "model-1");
    await deleteProviderModel("provider-1", "model-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/model-providers/provider-1/models/model-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Updated", capabilities: ["chat", "reasoning"] }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/model-providers/provider-1/models/model-1/set-default",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/model-providers/provider-1/models/model-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("manages provider credentials through REST", async () => {
    await rotateProviderCredential("provider-1", "credential-1", {
      label: "new",
      plaintextSecret: "sk-new",
    });
    await deleteProviderCredential("provider-1", "credential-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/model-providers/provider-1/credentials/credential-1/rotate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ label: "new", plaintextSecret: "sk-new" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/model-providers/provider-1/credentials/credential-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("discovers AI CLI adapters", async () => {
    await discoverAdapters();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/adapters/discovery",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("exports local diagnostics through REST", async () => {
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({
      report: {
        generatedAt: "2026-05-11T00:00:00.000Z",
        app: { name: "OpenForge", version: "0.0.0" },
        runtime: { node: "v22.0.0", platform: "linux", arch: "x64" },
        counts: { projects: 1 },
        dashboardHealth: {},
        adapters: [{ id: "claude", command: "claude", runtimeModes: ["terminal"] }],
        copilot: {
          capabilities: {
            enabled: true,
            toolExecutionEnabled: true,
            approvalRequiredForWrites: true,
            memoryEnabled: true,
            memoryWritesRequireApproval: true,
          },
        },
        environment: { OPENFORGE_PORT: "48731" },
      },
    })));

    const result = await exportDiagnostics();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/diagnostics/export",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.report.app.name).toBe("OpenForge");
    expect(result.report.copilot.capabilities.memoryWritesRequireApproval).toBe(true);
    expect(result.report.environment.OPENFORGE_PORT).toBe("48731");
  });

  it("calls Copilot REST helpers", async () => {
    await getCopilotCapabilities();
    await createCopilotRun({ prompt: "Summarize Gateway health" });
    await listCopilotRuns();
    await getCopilotRun("run-1");
    await cancelCopilotRun("run-1");
    await approveCopilotPendingAction("run-1", "action-1");
    await rejectCopilotPendingAction("run-1", "action-1");
    await listCopilotConversations();
    await createCopilotConversation({ title: "Terminal help", source: "session", sourceRefId: "session-1" });
    await updateCopilotConversation("conversation-1", { title: "Updated help" });
    await listCopilotConversationMessages("conversation-1");
    await createCopilotConversationMessage("conversation-1", {
      prompt: "解释这个错误",
      source: "session",
      sourceRefId: "session-1",
    });
    await deleteCopilotMessage("message-1");
    await deleteCopilotConversation("conversation-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/copilot/capabilities",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/copilot/runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: "Summarize Gateway health" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/copilot/runs",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/copilot/runs/run-1",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:48731/api/v1/copilot/runs/run-1/cancel",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:48731/api/v1/copilot/runs/run-1/pending-actions/action-1/approve",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      7,
      "http://127.0.0.1:48731/api/v1/copilot/runs/run-1/pending-actions/action-1/reject",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      8,
      "http://127.0.0.1:48731/api/v1/copilot/conversations",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      9,
      "http://127.0.0.1:48731/api/v1/copilot/conversations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Terminal help", source: "session", sourceRefId: "session-1" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      10,
      "http://127.0.0.1:48731/api/v1/copilot/conversations/conversation-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Updated help" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      11,
      "http://127.0.0.1:48731/api/v1/copilot/conversations/conversation-1/messages",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      12,
      "http://127.0.0.1:48731/api/v1/copilot/conversations/conversation-1/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: "解释这个错误", source: "session", sourceRefId: "session-1" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      13,
      "http://127.0.0.1:48731/api/v1/copilot/messages/message-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      14,
      "http://127.0.0.1:48731/api/v1/copilot/conversations/conversation-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("calls Copilot memory management REST helpers", async () => {
    await listCopilotMemoryEntries({ scope: "project", projectId: "project-1", limit: 20 });
    await listCopilotMemoryNotes({ projectId: "project-1", sessionId: "session-1", limit: 10 });
    await searchCopilotMemory({ query: "provider catalog", includeNotes: true, limit: 5 });
    await getCopilotMemoryItem("entry", "memory-1");
    await deleteCopilotMemoryItem("note", "memory-2");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/copilot/memory/entries?scope=project&projectId=project-1&limit=20",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/copilot/memory/notes?projectId=project-1&sessionId=session-1&limit=10",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/copilot/memory/search?query=provider+catalog&includeNotes=true&limit=5",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/copilot/memory/entry/memory-1",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:48731/api/v1/copilot/memory/note/memory-2",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("preserves Gateway error details for Copilot requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({
            code: 1,
            message: "Configure an OpenAI or Anthropic model provider first.",
            details: { code: "copilot_provider_not_configured" },
          }),
        } as Response)
      )
    );

    await expect(createCopilotRun({ prompt: "Summarize Gateway health" })).rejects.toMatchObject({
      message: "Configure an OpenAI or Anthropic model provider first.",
      status: 400,
      details: { code: "copilot_provider_not_configured" },
    });
  });

  it("lets Copilot run creation outlive the Gateway model timeout", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await createCopilotRun({ prompt: "Summarize Gateway health" });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 65_000);
  });

  it("creates Gate A sessions with the current login token", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => (key === "openforge.token" ? "jwt-token" : null)),
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      await mockEnvelope({
        session: {
          id: "gate-a-session",
          attachToken: "attach-token",
          tmuxName: "of-gate-a",
          status: "running",
        },
      })
    );

    const session = await createGateASession("/path/to/project");

    expect(session.id).toBe("gate-a-session");
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/gate-a/sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer jwt-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ cwd: "/path/to/project" }),
      })
    );
  });

  it("manages server-backed notifications", async () => {
    await listNotifications();
    await markNotificationRead("notification-1");
    await markAllNotificationsRead();
    await clearServerNotifications();

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/notifications",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/notifications/notification-1/read",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/notifications/read-all",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/notifications",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("manages admin users through REST", async () => {
    await listAdminUsers();
    await updateAdminUser("user-1", { role: "admin", status: "disabled" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/admin/users",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/admin/users/user-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "admin", status: "disabled" }),
      })
    );
  });

  it("lists filtered activity events", async () => {
    await listActivities({
      sessionId: "session-1",
      agentId: "agent-1",
      types: ["codex_app_server_started", "codex_app_server_notification"],
      limit: 20,
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/activities?sessionId=session-1&agentId=agent-1&type=codex_app_server_started%2Ccodex_app_server_notification&limit=20",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("lists session snapshots with filters", async () => {
    await listSnapshots({ projectId: "project-1" });
    await restoreSnapshot("snapshot-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/snapshots?projectId=project-1",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/snapshots/snapshot-1/restore",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("manages project AI config files", async () => {
    await getProjectAiConfig("project-1");
    await getGlobalAiConfig("project-1");
    await updateProjectAiConfigFile("project-1", "AGENTS.md", "# Updated\n");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects/project-1/ai-config",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/projects/project-1/ai-config/global",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/projects/project-1/ai-config/files",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ relativePath: "AGENTS.md", content: "# Updated\n" }),
      })
    );
  });

  it("manages usage analytics rates", async () => {
    await getUsageSummary();
    await listUsageRates();
    await setUsageRate("model-1", 1.25);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/usage/summary",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/usage/rates",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/usage/rates/model-1",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("lists and refreshes remote catalog metadata", async () => {
    await listCatalogSources();
    await listCatalogItems();
    await refreshCatalog({
      type: "template",
      sourceId: "clawhub",
      label: "ClawHub",
      url: "https://example.test/catalog.json"
    });
    await installCatalogTemplate("catalog-item-1");
    await installCatalogSkill("catalog-skill-1");
    await installCatalogPlugin("catalog-plugin-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/catalog/sources",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/catalog/items",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/catalog/refresh",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/catalog/items/catalog-item-1/install",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:48731/api/v1/catalog/items/catalog-skill-1/install",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:48731/api/v1/catalog/items/catalog-plugin-1/install",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("updates, defaults, and deletes models", async () => {
    await updateModel("model-1", { name: "Claude Opus" });
    await setDefaultModel("model-1");
    await listModelPresets();
    await listModelGroups();
    await checkModelEndpointHealth("model-1", 5000);
    await deleteModel("model-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/models/model-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "Claude Opus" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/models/model-1/set-default",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/models/presets",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/models/groups",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:48731/api/v1/models/model-1/check-endpoint",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ timeoutMs: 5000 }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:48731/api/v1/models/model-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("creates, lists, and rotates API keys without response plaintext expectations", async () => {
    await listApiKeys();
    await createApiKey({
      provider: "anthropic",
      name: "Claude Key",
      plaintextKey: "test-api-key-secret",
    });
    await rotateApiKey("key-1", "test-api-key-new");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/api-keys",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/api-keys",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          provider: "anthropic",
          name: "Claude Key",
          plaintextKey: "test-api-key-secret",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/api-keys/key-1/rotate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ plaintextKey: "test-api-key-new" }),
      })
    );
  });

  it("creates sessions with explicit runtime adapter, model, and stored credential selection", async () => {
    await createSession({
      projectId: "project-1",
      credentialMode: "stored_encrypted_key",
      aiTool: "opencode",
      modelId: "model-1",
      apiKeyId: "key-1",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          credentialMode: "stored_encrypted_key",
          aiTool: "opencode",
          modelId: "model-1",
          apiKeyId: "key-1",
        }),
      })
    );
  });

  it("calls Codex app-server lifecycle and guarded RPC endpoints", async () => {
    await getCodexAppServerCapabilities();
    await listCodexAppServers();
    await startCodexAppServer({
      projectId: "project-1",
      runtimeMode: "app-server-stdio",
      credentialMode: "host_environment",
    });
    await initializeCodexAppServer("app-1");
    await startCodexAppServerThread("app-1", {
      cwd: "/tmp/project",
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    await startCodexAppServerTurn("app-1", {
      threadId: "thr_123",
      text: "Summarize the repo",
    });
    await stopCodexAppServer("app-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/codex/app-server/capabilities",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/codex/app-server",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/codex/app-server",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          runtimeMode: "app-server-stdio",
          credentialMode: "host_environment",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/codex/app-server/app-1/initialize",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:48731/api/v1/codex/app-server/app-1/thread",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          cwd: "/tmp/project",
          approvalPolicy: "never",
          sandbox: "read-only",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:48731/api/v1/codex/app-server/app-1/turn",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          threadId: "thr_123",
          text: "Summarize the repo",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      7,
      "http://127.0.0.1:48731/api/v1/codex/app-server/app-1/stop",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("chooses only launchable runtime adapters from discovery", () => {
    const adapters: AdapterDiscovery[] = [
      {
        id: "claude",
        label: "Claude Code",
        command: "claude",
        supportLevel: "supported",
        launchEnabled: false,
        configDir: ".claude",
        runtimeModes: ["terminal"],
        available: true,
        status: "available",
      },
      {
        id: "opencode",
        label: "OpenCode",
        command: "opencode",
        supportLevel: "prototype",
        launchEnabled: true,
        configDir: ".opencode",
        runtimeModes: ["terminal"],
        available: false,
        status: "missing",
      },
      {
        id: "codex",
        label: "Codex CLI",
        command: "codex",
        supportLevel: "prototype",
        launchEnabled: true,
        configDir: ".codex",
        runtimeModes: ["terminal"],
        available: true,
        status: "available",
      },
    ];

    expect(isAdapterLaunchable(adapters[0]!)).toBe(false);
    expect(isAdapterLaunchable(adapters[1]!)).toBe(false);
    expect(isAdapterLaunchable(adapters[2]!)).toBe(true);
    expect(chooseDefaultRuntimeAdapter(adapters)).toBe("codex");
    expect(chooseDefaultRuntimeAdapter(adapters, "codex")).toBe("codex");
    expect(chooseDefaultRuntimeAdapter(adapters, "claude")).toBe("codex");
  });

  it("manages agents through REST", async () => {
    await listAgentTemplates();
    await createAgent({
      name: "Code Reviewer",
      projectId: "project-1",
      modelId: "model-1",
      tools: "Read,Edit",
      customPrompt: "Review diffs only.",
    });
    await updateAgent("agent-1", { status: "disabled" });
    await deleteAgent("agent-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/agents/templates",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/agents",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Code Reviewer",
          projectId: "project-1",
          modelId: "model-1",
          tools: "Read,Edit",
          customPrompt: "Review diffs only.",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/agents/agent-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ status: "disabled" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/agents/agent-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("manages project Agent orchestration sequence through REST", async () => {
    await getProjectAgentSequence("project-1");
    await updateProjectAgentSequence("project-1", ["agent-2", "agent-1"]);
    await createDefaultAgentPack("project-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects/project-1/agent-sequence",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/projects/project-1/agent-sequence",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ agentIds: ["agent-2", "agent-1"] }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/projects/project-1/agents/default-pack",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("reads workspace context routes through REST", async () => {
    await getProjectWorkspaceTree("project/1", {
      path: "src",
      depth: 2,
      limit: 20,
    });
    await getProjectWorkspaceFile("project/1", "src/index.ts");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/workspace/tree?path=src&depth=2&limit=20",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/workspace/file?path=src%2Findex.ts",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("manages project-manager ledger routes through REST", async () => {
    await projectManagerApi.getProjectManagerGoal("project/1");
    await projectManagerApi.updateProjectManagerGoal("project/1", {
      summary: "Ship Project Manager UI",
      constraints: ["No Gateway changes"],
      acceptanceCriteria: ["Typed client passes tests"],
      status: "active",
    });
    await projectManagerApi.listProjectManagerWorkItems("project/1", {
      status: "blocked",
      limit: 50,
    });
    await projectManagerApi.createProjectManagerWorkItem("project/1", {
      title: "Expose tab",
      description: "Add a project detail surface",
      status: "todo",
      priority: 10,
      acceptanceCriteria: ["Tab is visible"],
      evidenceRefs: [{ kind: "test", label: "API test", ref: "api.test.ts", path: "packages/web/src/lib/api.test.ts" }],
      feishuRefs: [{ kind: "message", label: "Approval", ref: "om_123", feishuMessageId: "om_msg_123" }],
    });
    await projectManagerApi.getProjectManagerWorkItem("project/1", "work/item-1");
    await projectManagerApi.updateProjectManagerWorkItem("project/1", "work/item-1", {
      title: "Expose board tab",
      description: null,
      priority: 20,
      acceptanceCriteria: ["Board tab is visible"],
    });
    await projectManagerApi.updateProjectManagerWorkItemStatus("project/1", "work/item-1", {
      status: "ready_for_review",
      evidenceRefs: [{ kind: "test", ref: "vitest" }],
      manualCompletionReason: "Reviewed locally",
    });
    await projectManagerApi.batchUpdateProjectManagerWorkItemStatuses("project/1", {
      updates: [
        { workItemId: "work/item-1", status: "in_progress" },
        { workItemId: "work/item-2", status: "blocked" },
      ],
    });
    await projectManagerApi.attachProjectManagerWorkItemEvidence("project/1", "work/item-1", {
      evidenceRefs: [{
        kind: "report",
        label: "Phase 11 evidence",
        ref: "PMEV-01",
        path: "docs/reports/phase-11-evidence.md",
      }],
    });
    await projectManagerApi.deleteProjectManagerWorkItem("project/1", "work/item-3", {
      confirm: true,
    });
    await projectManagerApi.listProjectManagerLedger("project/1", {
      eventType: "work_item_status_changed",
      limit: 10,
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/goal",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/goal",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          summary: "Ship Project Manager UI",
          constraints: ["No Gateway changes"],
          acceptanceCriteria: ["Typed client passes tests"],
          status: "active",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items?status=blocked&limit=50",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "Expose tab",
          description: "Add a project detail surface",
          status: "todo",
          priority: 10,
          acceptanceCriteria: ["Tab is visible"],
          evidenceRefs: [{ kind: "test", label: "API test", ref: "api.test.ts", path: "packages/web/src/lib/api.test.ts" }],
          feishuRefs: [{ kind: "message", label: "Approval", ref: "om_123", feishuMessageId: "om_msg_123" }],
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/work%2Fitem-1",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/work%2Fitem-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          title: "Expose board tab",
          description: null,
          priority: 20,
          acceptanceCriteria: ["Board tab is visible"],
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      7,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/work%2Fitem-1/status",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          status: "ready_for_review",
          evidenceRefs: [{ kind: "test", ref: "vitest" }],
          manualCompletionReason: "Reviewed locally",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      8,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/batch/status",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          updates: [
            { workItemId: "work/item-1", status: "in_progress" },
            { workItemId: "work/item-2", status: "blocked" },
          ],
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      9,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/work%2Fitem-1/evidence",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          evidenceRefs: [{
            kind: "report",
            label: "Phase 11 evidence",
            ref: "PMEV-01",
            path: "docs/reports/phase-11-evidence.md",
          }],
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      10,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/work%2Fitem-3",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirm: true }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      11,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/ledger?eventType=work_item_status_changed&limit=10",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("supports Project Manager Copilot trace DTO fields", () => {
    const evidenceRef: ProjectManagerEvidenceRef = {
      kind: "test",
      label: "Focused Web lib tests",
      status: "verified",
      ref: "vitest",
      sessionId: "session-123",
      copilotRunId: "run-123",
      pendingActionId: "action-123",
    };
    const ledgerEvent: ProjectManagerLedgerEvent = {
      id: "ledger-123",
      projectId: "project-123",
      workItemId: "work-item-123",
      eventType: "evidence_attached",
      status: "ready_for_review",
      evidenceRefCount: 1,
      feishuRefCount: 0,
      trace: {
        copilotRunId: "run-123",
        pendingActionId: "action-123",
        actionType: "attach_evidence",
        targetType: "work_item",
        targetId: "work-item-123",
        evidenceRefCount: 1,
        approvalStatus: "approved",
        executionStatus: "succeeded",
      },
      createdAt: 1779464282,
    };

    expect(evidenceRef.pendingActionId).toBe("action-123");
    expect(ledgerEvent.trace).toEqual({
      copilotRunId: "run-123",
      pendingActionId: "action-123",
      actionType: "attach_evidence",
      targetType: "work_item",
      targetId: "work-item-123",
      evidenceRefCount: 1,
      approvalStatus: "approved",
      executionStatus: "succeeded",
    });
    expect(Object.keys(ledgerEvent.trace ?? {}).sort()).toEqual([
      "actionType",
      "approvalStatus",
      "copilotRunId",
      "evidenceRefCount",
      "executionStatus",
      "pendingActionId",
      "targetId",
      "targetType",
    ]);
  });

  it("loads and links project-manager task packets through REST", async () => {
    await projectManagerApi.listProjectManagerTaskPackets("project/1", { limit: 20 });
    await projectManagerApi.getProjectManagerTaskPacket("project/1", "work/item-1");
    await projectManagerApi.linkProjectManagerTaskPacketSession("project/1", "work/item-1", {
      sessionId: "session/1",
    });
    await projectManagerApi.startProjectManagerTaskPacket("project/1", "work/item-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/task-packets?limit=20",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/work%2Fitem-1/task-packet",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/work%2Fitem-1/task-packet/session-link",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sessionId: "session/1" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/work%2Fitem-1/task-packet/start",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("loads Project Manager starter packs and creates pack-backed task packets", async () => {
    await projectManagerApi.listProjectManagerStarterPacks("project/1");
    await projectManagerApi.createProjectManagerStarterPackTaskPacket("project/1", "code-review");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/starter-packs",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/starter-packs/code-review/task-packet",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("preserves Gateway error details for project-manager API calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({
            code: 1,
            message: "Project not found",
            details: { code: "project_not_found" },
          }),
        } as Response)
      )
    );

    await expect(projectManagerApi.getProjectManagerGoal("missing-project")).rejects.toMatchObject({
      message: "Project not found",
      status: 404,
      details: { code: "project_not_found" },
    });
  });

  it("manages skills and project skill enablement through REST", async () => {
    await listSkillSources();
    await listSkillTemplates();
    await syncLocalSkills();
    await createSkill({
      name: "safe-review",
      content: "# Safe Review",
      visibility: "shared",
    });
    await installSkill({
      sourceId: "github",
      name: "review-workflow",
    });
    await previewSkillSource({
      sourceId: "github",
      url: "https://raw.githubusercontent.com/acme/review/main/SKILL.md",
    });
    await updateSkill("skill-1", { description: "Updated", visibility: "admin" });
    await listProjectSkills("project-1");
    await setProjectSkill("project-1", "skill-1", true);
    await deleteSkill("skill-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/skills/sources",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/skills/templates",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/skills/local-sync",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:48731/api/v1/skills",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "safe-review",
          content: "# Safe Review",
          visibility: "shared",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:48731/api/v1/skills/install",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sourceId: "github",
          name: "review-workflow",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:48731/api/v1/skills/install/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sourceId: "github",
          url: "https://raw.githubusercontent.com/acme/review/main/SKILL.md",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      7,
      "http://127.0.0.1:48731/api/v1/skills/skill-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ description: "Updated", visibility: "admin" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      8,
      "http://127.0.0.1:48731/api/v1/projects/project-1/skills",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      9,
      "http://127.0.0.1:48731/api/v1/projects/project-1/skills/skill-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      10,
      "http://127.0.0.1:48731/api/v1/skills/skill-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("manages Claude Code plugins through REST", async () => {
    await listPlugins();
    await togglePlugin("claude-safe-edits", true);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/plugins",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/plugins/claude-safe-edits/toggle",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      })
    );
  });

  it("lists audit logs through REST", async () => {
    await listAuditLogs({ resourceType: "plugin", resourceId: "claude-safe-edits", limit: 20 });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/audit-logs?resourceType=plugin&resourceId=claude-safe-edits&limit=20",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("previews and applies project template sync", async () => {
    await previewConfigSync("project-1");
    await applyConfigSync("project-1", { ".claude/CLAUDE.md": "overwrite" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects/project-1/config/sync/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ credentialMode: "host_environment" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/projects/project-1/config/sync/apply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          credentialMode: "host_environment",
          decisions: { ".claude/CLAUDE.md": "overwrite" },
        }),
      })
    );
  });

  it("fetches project config compliance report", async () => {
    await getConfigCompliance("project-1", {
      templateId: "template-1",
      credentialMode: "stored_encrypted_key",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects/project-1/config/compliance?templateId=template-1&credentialMode=stored_encrypted_key",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("manages custom templates and project config application", async () => {
    await createTemplate({
      name: "Custom",
      visibility: "shared",
      files: [{ filePath: ".claude/CLAUDE.md", content: "# {{projectName}}" }],
    });
    await cloneTemplate("builtin-claude-code", "Cloned");
    await updateTemplate("template-1", { description: "Updated", visibility: "admin" });
    await updateTemplateFile("template-1", ".claude/CLAUDE.md", "updated");
    await exportTemplate("template-1");
    await importTemplate({
      name: "Imported",
      version: "1.0.0",
      files: [{ filePath: ".claude/CLAUDE.md", content: "imported", fileType: "markdown" }],
      exportedAt: "2026-04-30T00:00:00.000Z",
    });
    await listTemplateVersions("template-1");
    await restoreTemplateVersion("template-1", 7);
    await previewConfig("project-1", "template-1");
    await writeConfig("project-1", "template-1", { ".claude/CLAUDE.md": "overwrite" });
    await deleteTemplate("template-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/templates",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Custom",
          visibility: "shared",
          files: [{ filePath: ".claude/CLAUDE.md", content: "# {{projectName}}" }],
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/templates/builtin-claude-code/clone",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Cloned" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48731/api/v1/templates/template-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ description: "Updated", visibility: "admin" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      8,
      "http://127.0.0.1:48731/api/v1/templates/template-1/versions/7/restore",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      9,
      "http://127.0.0.1:48731/api/v1/projects/project-1/config/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          templateId: "template-1",
          credentialMode: "host_environment",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      10,
      "http://127.0.0.1:48731/api/v1/projects/project-1/config/write",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          templateId: "template-1",
          credentialMode: "host_environment",
          decisions: { ".claude/CLAUDE.md": "overwrite" },
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:48731/api/v1/templates/template-1/export",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:48731/api/v1/templates/import",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      7,
      "http://127.0.0.1:48731/api/v1/templates/template-1/versions",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("creates templates from existing project config through REST", async () => {
    await previewTemplateFromProject("project-1");
    await createTemplateFromProject({
      projectId: "project-1",
      name: "Extracted",
      description: "From project config",
      version: "1.0.0",
      filePaths: [".claude/CLAUDE.md"],
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/templates/from-project/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectId: "project-1" }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/templates/from-project",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          name: "Extracted",
          description: "From project config",
          version: "1.0.0",
          filePaths: [".claude/CLAUDE.md"],
        }),
      })
    );
  });

  it("imports a project, previews config, and applies only missing files", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 0,
          data: {
            project: {
              id: "project-1",
              name: "Existing",
              path: "/tmp/existing",
            },
          },
          message: "",
        }),
    } as Response);

    vi.mocked(fetch).mockImplementationOnce(() => mockEnvelope({
      plan: { dryRun: true, files: [{ relativePath: ".claude/CLAUDE.md", sha256: "abc" }] },
      conflicts: [],
      summary: {
        templateId: "builtin-claude-code",
        totalFiles: 1,
        missingFiles: [".claude/CLAUDE.md"],
        identicalFiles: [],
        modifiedFiles: [],
        unsafeFiles: [],
        requiresDecision: [],
      },
    }));
    vi.mocked(fetch).mockImplementationOnce(() => mockEnvelope({
      result: {
        writtenFiles: [".claude/CLAUDE.md"],
        skippedFiles: [],
        backupPath: "/tmp/backup",
        conflicts: [],
        rollbackAvailable: false,
      },
      summary: {
        templateId: "builtin-claude-code",
        totalFiles: 1,
        missingFiles: [".claude/CLAUDE.md"],
        identicalFiles: [],
        modifiedFiles: [],
        unsafeFiles: [],
        requiresDecision: [],
      },
    }));

    const result = await importProjectWithConfig({
      path: "/tmp/existing",
      name: "Existing",
    });

    expect(result.project.id).toBe("project-1");
    expect(result.configStatus).toBe("applied");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          path: "/tmp/existing",
          name: "Existing",
        }),
      })
    );
  });

  it("returns needs_review after project creation when config is modified or unsafe", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            data: {
              project: {
                id: "project-3",
                name: "Runtime Agnostic Project",
                path: "/tmp/runtime-agnostic",
              },
            },
            message: "",
          }),
      } as Response);

    vi.mocked(fetch).mockImplementationOnce(() => mockEnvelope({
      plan: { dryRun: true, files: [{ relativePath: "AGENTS.md", sha256: "abc" }] },
      conflicts: [{ relativePath: "AGENTS.md", conflictType: "modified", allowedActions: ["skip", "overwrite"] }],
      summary: {
        templateId: "builtin-codex",
        totalFiles: 1,
        missingFiles: [],
        identicalFiles: [],
        modifiedFiles: ["AGENTS.md"],
        unsafeFiles: [],
        requiresDecision: ["AGENTS.md"],
      },
    }));

    const result = await createProjectWithConfig({
      path: "/tmp/runtime-agnostic",
      name: "Runtime Agnostic Project",
      aiTool: "codex",
    });

    expect(result.configStatus).toBe("needs_review");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          path: "/tmp/runtime-agnostic",
          name: "Runtime Agnostic Project",
          aiTool: "codex",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/projects/project-3/config/sync/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ credentialMode: "host_environment", templateId: "builtin-codex" }),
      })
    );
  });

  it("builds safe default config decisions from conflict reports", () => {
    const decisions = defaultConfigConflictDecisions([
      {
        relativePath: ".claude/CLAUDE.md",
        conflictType: "exists",
        allowedActions: ["skip"],
      },
      {
        relativePath: ".claude/settings.json",
        conflictType: "modified",
        allowedActions: ["skip", "overwrite"],
      },
      {
        relativePath: "../escape",
        conflictType: "unsafe_path",
        allowedActions: [],
      },
    ]);

    expect(decisions).toEqual({
      ".claude/CLAUDE.md": "skip",
      ".claude/settings.json": "skip",
    });
  });

  it("loads dashboard summary from the Gateway", async () => {
    await getDashboardSummary();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/dashboard/summary",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("loads dependency checks through the shared authenticated API client", async () => {
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({ dependencies: [] })));

    await getDependencies();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/gate-a/dependencies",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("loads Feishu integration status through the shared authenticated API client", async () => {
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({
      status: {
        available: true,
        version: "lark-cli 1.2.3",
        authState: "authenticated",
        identityMode: "user",
        enabled: false,
      },
    })));

    const status = await getFeishuIntegrationStatus();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/integrations/feishu/status",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    expect(status.available).toBe(true);
    expect(status.authState).toBe("authenticated");
    expect(status.identityMode).toBe("user");
    expect(status.enabled).toBe(false);
  });

  it("loads and updates Feishu integration config through REST", async () => {
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({
      config: {
        enabled: true,
        emergencyDisabled: false,
        identityMode: "bot",
        allowedChatIds: ["chat-1"],
        commandPrefix: "/of",
      },
    })));

    const config = await getFeishuIntegrationConfig();
    await updateFeishuIntegrationConfig({
      enabled: true,
      identityMode: "bot",
      allowedChatIds: ["chat-1"],
      commandPrefix: "/of",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/integrations/feishu/config",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/integrations/feishu/config",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          enabled: true,
          identityMode: "bot",
          allowedChatIds: ["chat-1"],
          commandPrefix: "/of",
        }),
      })
    );
    expect(config.commandPrefix).toBe("/of");
    expect(config.allowedChatIds).toEqual(["chat-1"]);
  });

  it("loads and replaces Feishu user mappings through REST", async () => {
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({
      mappings: [
        {
          id: "mapping-1",
          feishuUserId: "ou_1",
          openforgeUserId: "user-1",
          displayName: "Owner",
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z",
        },
      ],
    })));

    const mappings = await listFeishuUserMappings();
    await replaceFeishuUserMappings([
      { feishuUserId: "ou_1", openforgeUserId: "user-1", displayName: "Owner" },
    ]);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/integrations/feishu/user-mappings",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48731/api/v1/integrations/feishu/user-mappings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          mappings: [
            { feishuUserId: "ou_1", openforgeUserId: "user-1", displayName: "Owner" },
          ],
        }),
      })
    );
    expect(mappings.map((mapping) => mapping.feishuUserId)).toEqual(["ou_1"]);
  });

  it("lists sessions with an optional project filter", async () => {
    await listSessions({ projectId: "project-1" });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/sessions?projectId=project-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("sanitizes raw HTTP error bodies from Gateway requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: () => Promise.resolve("stack trace: /tmp/openforge/private.ts"),
        } as Response)
      )
    );

    await expect(getDashboardSummary()).rejects.toThrow("Gateway request failed with HTTP 500");
    await expect(getDashboardSummary()).rejects.not.toThrow("/tmp/openforge");
  });

  it("checks model health through REST", async () => {
    await checkModelHealth("model-1");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/models/model-1/check",
      expect.objectContaining({ method: "POST" })
    );
  });
});
