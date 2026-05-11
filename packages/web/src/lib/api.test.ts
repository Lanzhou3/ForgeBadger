import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAgent,
  createApiKey,
  checkModelHealth,
  checkModelEndpointHealth,
  cloneTemplate,
  createProjectWithConfig,
  createTemplateFromProject,
  createSkill,
  createModel,
  createTemplate,
  createSession,
  deleteProviderCredential,
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
  getDashboardSummary,
  getDependencies,
  getConfigCompliance,
  getGlobalAiConfig,
  getProjectAgentSequence,
  getProjectAiConfig,
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
  listNotifications,
  listSessions,
  listSnapshots,
  listUsageRates,
  listSkillTemplates,
  listSkillSources,
  syncLocalSkills,
  syncProviderModels,
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
  updateProjectAgentSequence,
  updateProjectAiConfigFile,
  updateSkill,
  updateTemplate,
  updateTemplateFile,
  updateModel,
  writeConfig,
  type AdapterDiscovery,
} from "./api";

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
        environment: { OPENFORGE_PORT: "48731" },
      },
    })));

    const result = await exportDiagnostics();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:48731/api/v1/diagnostics/export",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.report.app.name).toBe("OpenForge");
    expect(result.report.environment.OPENFORGE_PORT).toBe("48731");
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

  it("imports project records without CLI fields or automatic config generation", async () => {
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

    const result = await importProjectWithConfig({
      path: "/tmp/existing",
      name: "Existing",
    });

    expect(result.project.id).toBe("project-1");
    expect(result.configStatus).toBe("skipped");
    expect(fetch).toHaveBeenCalledTimes(1);
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

  it("creates project records without CLI fields or automatic config generation", async () => {
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

    const result = await createProjectWithConfig({
      path: "/tmp/runtime-agnostic",
      name: "Runtime Agnostic Project",
    });

    expect(result.configStatus).toBe("skipped");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48731/api/v1/projects",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          path: "/tmp/runtime-agnostic",
          name: "Runtime Agnostic Project",
        }),
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
