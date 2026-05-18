import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import {
  ConfigWriteError,
  writeConfigPlan
} from "../config-generation/index.js";
import type {
  CopilotConversation,
  CopilotMessage,
  CopilotPendingAction,
  CopilotRun,
  CopilotRunEvent
} from "../db/repositories/copilot-repository.js";
import { CopilotRepository } from "../db/repositories/copilot-repository.js";
import {
  CopilotMemoryRepository,
  type CopilotMemoryEntry,
  type CopilotMemoryItemType,
  type CopilotMemoryNote
} from "../db/repositories/copilot-memory-repository.js";
import { FeishuIntegrationRepository } from "../db/repositories/feishu-integration-repository.js";
import { ModelProviderRepository, type ModelProfile, type ProviderProfile } from "../db/repositories/model-provider-repository.js";
import { ProjectRepository, type Project } from "../db/repositories/project-repository.js";
import { AgentRepository, type Agent } from "../db/repositories/agent-repository.js";
import { PluginRepository } from "../db/repositories/plugin-repository.js";
import { ProjectSkillRepository } from "../db/repositories/project-skill-repository.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";
import { SkillRepository, type Skill } from "../db/repositories/skill-repository.js";
import { TemplateRepository, type Template, type TemplateFile } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";
import { discoverAdapters, getAdapterLaunchStatus } from "../services/adapter-discovery.js";
import { recordActivity } from "../services/activity-events.js";
import { buildLocalDiagnosticsExport } from "../services/diagnostics.js";
import { loadProviderCatalog as loadProviderCatalogFromSource, type ProviderCatalogPreset } from "../services/model-catalog.js";
import type { PluginSummary } from "../services/plugin-catalog.js";
import { approveCopilotMemoryDelete, approveCopilotMemoryWrite } from "../services/copilot/memory.js";
import { CopilotOrchestrator, CopilotRunControlRegistry, type CopilotOrchestratorOptions } from "../services/copilot/orchestrator.js";
import { selectCopilotProvider } from "../services/copilot/provider-selection.js";
import { createCopilotReadTools } from "../services/copilot/read-tools.js";
import { redactCopilotPayload, redactCopilotText, sanitizeCopilotAssistantText } from "../services/copilot/redaction.js";
import { applyModelProviderConfig } from "../services/model-config-apply.js";
import {
  executeFeishuCommand,
  type FeishuCommandOperation,
  type FeishuCommandRequest,
  type FeishuCommandResult
} from "../services/integrations/feishu-commands.js";
import {
  fetchProviderModels as fetchProviderModelsFromEndpoint,
  type FetchedProviderModel,
  type FetchProviderModelsInput
} from "../services/provider-model-fetch.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import type { OpenForgeEventBus } from "../services/event-bus.js";
import { recordSessionSnapshot } from "../services/session-snapshots.js";
import {
  createLaunchPlan,
  normalizeAdapter,
  prepareClaudeLaunchExtras,
  validateCodexTerminalCredentialBoundary
} from "./sessions.js";
import {
  buildConfigSyncSummary,
  buildProjectConfigRenderPlan,
  prepareImportedProjectRoot,
  prepareCreatedProjectRoot,
  resolveProjectTemplateId
} from "./projects.js";

const createRunSchema = z.object({
  prompt: z.string().trim().min(1).max(32 * 1024),
  providerProfileId: z.string().min(1).optional(),
  modelProfileId: z.string().min(1).optional(),
  source: z.enum(["dashboard", "project", "session", "settings", "copilot", "models"]).default("copilot"),
  sourceRefId: z.string().min(1).max(256).optional()
});

const listRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});
const memoryScopeQuerySchema = z.enum(["global", "project", "session"]);
const memoryItemTypeSchema = z.enum(["entry", "note"]);
const optionalBooleanQuery = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());
const listMemoryEntriesSchema = z.object({
  scope: memoryScopeQuerySchema.optional(),
  projectId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});
const listMemoryNotesSchema = z.object({
  projectId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});
const searchMemorySchema = z.object({
  query: z.string().trim().min(1).max(512),
  scope: memoryScopeQuerySchema.optional(),
  projectId: z.string().min(1).optional(),
  includeNotes: optionalBooleanQuery,
  limit: z.coerce.number().int().min(1).max(20).optional()
});
const memoryItemParamsSchema = z.object({
  type: memoryItemTypeSchema,
  id: z.string().min(1)
});
const conversationSourceSchema = z.enum(["dashboard", "project", "session", "settings", "copilot", "models"]);
const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  source: conversationSourceSchema.default("copilot"),
  sourceRefId: z.string().min(1).max(256).optional()
});
const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(120)
});
const listConversationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});
const createConversationMessageSchema = z.object({
  prompt: z.string().trim().min(1).max(32 * 1024),
  providerProfileId: z.string().min(1).optional(),
  modelProfileId: z.string().min(1).optional(),
  source: createRunSchema.shape.source,
  sourceRefId: z.string().min(1).max(256).optional(),
  async: z.boolean().optional()
});
const sessionCreateApprovalSchema = z.object({
  projectId: z.string().min(1),
  aiTool: z.enum(["claude", "opencode", "codex"]),
  name: z.string().min(1).optional()
}).strict();
const projectCreateApprovalSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().min(1).optional(),
  techStack: z.string().min(1).optional(),
  aiTool: z.enum(["claude", "opencode", "codex"]).optional(),
  templateId: z.string().min(1).optional()
}).strict();
const projectImportApprovalSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().min(1).optional(),
  techStack: z.string().min(1).optional(),
  aiTool: z.enum(["claude", "opencode", "codex"]).optional(),
  templateId: z.string().min(1).optional()
}).strict();
const projectDeleteApprovalSchema = z.object({
  projectId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const projectConfigSyncApprovalSchema = z.object({
  projectId: z.string().min(1),
  templateId: z.string().min(1).optional(),
  credentialMode: z.enum(["host_environment", "stored_encrypted_key"]).default("host_environment"),
  decisions: z.record(z.enum(["skip", "overwrite"])).optional()
}).strict();
const sessionInputApprovalSchema = z.object({
  sessionId: z.string().min(1),
  input: z.string().min(1).max(8_000),
  submit: z.boolean().optional()
}).strict();
const sessionStartApprovalSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const sessionStopApprovalSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const sessionDeleteApprovalSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const agentCreateApprovalSchema = z.object({
  projectId: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  tools: z.string().min(1).optional(),
  allowedDirs: z.string().min(1).optional(),
  customPrompt: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
}).strict();
const agentUpdateApprovalSchema = z.object({
  agentId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  tools: z.string().min(1).optional(),
  allowedDirs: z.string().min(1).optional(),
  customPrompt: z.string().min(1).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  reason: z.string().min(1).optional()
}).strict();
const agentDeleteApprovalSchema = z.object({
  agentId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const templateDraftFileApprovalSchema = z.object({
  filePath: z.string().min(1),
  content: z.string().max(16_000),
  fileType: z.string().min(1).optional()
}).strict();
const templateCreateApprovalSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  visibility: z.enum(["private", "shared", "admin"]).optional(),
  files: z.array(templateDraftFileApprovalSchema).max(20).optional(),
  reason: z.string().min(1).optional()
}).strict();
const templateUpdateApprovalSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  visibility: z.enum(["private", "shared", "admin"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  reason: z.string().min(1).optional()
}).strict();
const templateDeleteApprovalSchema = z.object({
  templateId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const skillToggleApprovalSchema = z.object({
  skillId: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().min(1).optional()
}).strict();
const pluginToggleApprovalSchema = z.object({
  pluginId: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().min(1).optional()
}).strict();
const projectSkillToggleApprovalSchema = z.object({
  projectId: z.string().min(1),
  skillId: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().min(1).optional()
}).strict();
const copilotModelSelectionApprovalSchema = z.object({
  providerProfileId: z.string().min(1),
  modelProfileId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const modelProviderSyncApprovalSchema = z.object({
  providerProfileId: z.string().min(1),
  credentialId: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).optional(),
  reason: z.string().min(1).optional()
}).strict();
const modelProviderApplyApprovalSchema = z.object({
  adapter: z.enum(["claude", "opencode", "openforge-copilot"]),
  providerProfileId: z.string().min(1),
  modelProfileId: z.string().min(1).optional(),
  credentialId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
}).strict();
const troubleshootingStepsApprovalSchema = z.object({
  summary: z.string().min(1).optional(),
  steps: z.array(z.string().min(1)).min(1).max(10).optional()
}).strict();

export interface CopilotRoutesOptions extends CopilotOrchestratorOptions {
  db: Database;
  masterKey: string;
  appVersion?: string;
  pendingActionApprover?: PendingActionApprover;
  sessionManager?: Pick<InMemorySessionManager, "createSession" | "sendInput" | "captureHistory" | "stopSession" | "listSessions">;
  eventBus?: OpenForgeEventBus;
  fetchProviderModels?: (input: FetchProviderModelsInput) => Promise<FetchedProviderModel[]>;
  loadProviderCatalog?: () => Promise<ProviderCatalogPreset[]>;
  executeFeishuCommand?: (request: FeishuCommandRequest) => Promise<FeishuCommandResult>;
}

type PendingActionApprover = (
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
) => Promise<Record<string, unknown>>;

export function createCopilotRoutes(options: CopilotRoutesOptions): Router {
  const router = Router();
  const activeRunUsers = new Set<string>();
  const runControls = options.runControls ?? new CopilotRunControlRegistry();
  router.use(authenticate);

  router.get("/capabilities", (req, res) => {
    const tools = createCopilotReadTools();
    res.json({
      code: 0,
      data: {
        supportedProviderFormats: ["openai", "openai-compatible", "anthropic"],
        providerConfigured: selectCopilotProvider({
          db: options.db,
          userId: userIdFor(req),
          masterKey: options.masterKey,
          allowOpenAiCompatible: true
        }).ok,
        toolExecutionEnabled: true,
        readTools: tools.filter((tool) => tool.risk === "read").map((tool) => tool.name),
        prepareTools: tools.filter((tool) => tool.risk === "prepare").map((tool) => tool.name),
        approvalRequiredForWrites: true,
        pendingActionApprovalEnabled: true
      },
      message: ""
    });
  });

  router.get("/memory/entries", (req, res) => {
    const parseResult = listMemoryEntriesSchema.safeParse(req.query);
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot memory query");
    const entries = memoryRepoFor(options.db, req).listEntries({
      ...(parseResult.data.scope ? { scope: parseResult.data.scope } : {}),
      ...(parseResult.data.projectId ? { projectId: parseResult.data.projectId } : {}),
      ...(parseResult.data.limit !== undefined ? { limit: parseResult.data.limit } : {})
    });
    res.json({ code: 0, data: { entries }, message: "" });
  });

  router.get("/memory/notes", (req, res) => {
    const parseResult = listMemoryNotesSchema.safeParse(req.query);
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot memory query");
    const notes = memoryRepoFor(options.db, req).listNotes({
      ...(parseResult.data.projectId ? { projectId: parseResult.data.projectId } : {}),
      ...(parseResult.data.sessionId ? { sessionId: parseResult.data.sessionId } : {}),
      ...(parseResult.data.limit !== undefined ? { limit: parseResult.data.limit } : {})
    });
    res.json({ code: 0, data: { notes }, message: "" });
  });

  router.get("/memory/search", (req, res) => {
    const parseResult = searchMemorySchema.safeParse(req.query);
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot memory search query");
    const results = memoryRepoFor(options.db, req).search({
      query: parseResult.data.query,
      ...(parseResult.data.scope ? { scope: parseResult.data.scope } : {}),
      ...(parseResult.data.projectId ? { projectId: parseResult.data.projectId } : {}),
      ...(parseResult.data.includeNotes !== undefined ? { includeNotes: parseResult.data.includeNotes } : {}),
      ...(parseResult.data.limit !== undefined ? { limit: parseResult.data.limit } : {})
    });
    res.json({ code: 0, data: { results }, message: "" });
  });

  router.get("/memory/:type/:id", (req, res) => {
    const parseResult = memoryItemParamsSchema.safeParse(req.params);
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot memory item");
    const repo = memoryRepoFor(options.db, req);
    const item = getMemoryItem(repo, parseResult.data.type, parseResult.data.id);
    if (!item) return sendMemoryItemNotFound(res);
    res.json(memoryItemEnvelope(parseResult.data.type, item));
  });

  router.delete("/memory/:type/:id", (req, res) => {
    const parseResult = memoryItemParamsSchema.safeParse(req.params);
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot memory item");
    const repo = memoryRepoFor(options.db, req);
    const item = deleteMemoryItem(repo, parseResult.data.type, parseResult.data.id);
    if (!item) return sendMemoryItemNotFound(res);
    res.json(memoryItemEnvelope(parseResult.data.type, item));
  });

  router.get("/runs", (req, res) => {
    const parseResult = listRunsSchema.safeParse(req.query);
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot run query");
    const repo = repoFor(options.db, req);
    res.json({ code: 0, data: { runs: listRunsWithLiveRecovery(repo, parseResult.data.limit) }, message: "" });
  });

  router.get("/conversations", (req, res) => {
    const parseResult = listConversationsSchema.safeParse(req.query);
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot conversation query");
    const repo = repoFor(options.db, req);
    res.json({ code: 0, data: { conversations: repo.listConversations(parseResult.data.limit) }, message: "" });
  });

  router.post("/conversations", (req, res) => {
    const parseResult = createConversationSchema.safeParse(req.body ?? {});
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot conversation payload");
    const repo = repoFor(options.db, req);
    const conversation = repo.createConversation({
      title: parseResult.data.title,
      source: parseResult.data.source,
      ...(parseResult.data.sourceRefId ? { sourceRefId: parseResult.data.sourceRefId } : {})
    });
    res.status(201).json(conversationEnvelope(conversation));
  });

  router.patch("/conversations/:id", (req, res) => {
    const parseResult = updateConversationSchema.safeParse(req.body ?? {});
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot conversation payload");
    const conversation = repoFor(options.db, req).updateConversation(req.params.id, {
      title: parseResult.data.title
    });
    if (!conversation) return res.status(404).json({ code: 1, message: "Copilot conversation not found" });
    res.json(conversationEnvelope(conversation));
  });

  router.delete("/conversations/:id", (req, res) => {
    const conversation = repoFor(options.db, req).deleteConversation(req.params.id);
    if (!conversation) return res.status(404).json({ code: 1, message: "Copilot conversation not found" });
    res.json(conversationEnvelope(conversation));
  });

  router.get("/conversations/:id/messages", (req, res) => {
    const repo = repoFor(options.db, req);
    if (!repo.getConversation(req.params.id)) {
      return res.status(404).json({ code: 1, message: "Copilot conversation not found" });
    }
    res.json(messagesEnvelope(repo.listConversationMessages(req.params.id)));
  });

  router.post("/conversations/:id/messages", async (req, res) => {
    const parseResult = createConversationMessageSchema.safeParse(req.body ?? {});
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot message payload");
    const userId = userIdFor(req);
    const repo = new CopilotRepository(options.db, userId);
    if (!repo.getConversation(req.params.id)) {
      return res.status(404).json({ code: 1, message: "Copilot conversation not found" });
    }
    if (activeRunUsers.has(userId)) {
      return sendRunAlreadyActive(res);
    }
    const existingActiveRun = repo.listRuns(200).find((run) => isLiveRunStatus(run.status));
    if (existingActiveRun) return sendRunAlreadyActive(res, existingActiveRun);
    activeRunUsers.add(userId);
    const userMessage = repo.createConversationMessage(req.params.id, {
      role: "user",
      content: parseResult.data.prompt,
      payload: {
        source: parseResult.data.source,
        ...(parseResult.data.sourceRefId ? { sourceRefId: parseResult.data.sourceRefId } : {})
      }
    });
    try {
      const runInput = {
        userId,
        prompt: parseResult.data.prompt,
        source: parseResult.data.source,
        ...(parseResult.data.providerProfileId ? { providerProfileId: parseResult.data.providerProfileId } : {}),
        ...(parseResult.data.modelProfileId ? { modelProfileId: parseResult.data.modelProfileId } : {}),
        ...(parseResult.data.sourceRefId ? { sourceRefId: parseResult.data.sourceRefId } : {})
      };
      const startedRunRef: { current: CopilotRun | null } = { current: null };
      const orchestrator = new CopilotOrchestrator({
        ...options,
        runControls,
        onRunStarted: (run) => {
          startedRunRef.current = run;
          recordCopilotRunAudit(options.db, userId, req.ip, "copilot.run.start", run, {}, {
            eventBus: options.eventBus,
            conversationId: req.params.id
          });
        },
        ...(parseResult.data.async === true ? {
          onRunEvent: (run: CopilotRun, event: CopilotRunEvent) => {
            emitCopilotRunUpdated(options.eventBus, userId, run, "event_appended", req.params.id, event);
          },
          onTextDelta: (run: CopilotRun, delta: string) => {
            emitCopilotRunUpdated(options.eventBus, userId, run, "assistant_delta", req.params.id, undefined, delta);
          }
        } : {})
      });
      if (parseResult.data.async === true) {
        const resultPromise = orchestrator.runText(runInput);
        const initialRun = startedRunRef.current;
        if (!initialRun) throw new Error("Copilot run did not start");
        void resultPromise
          .then((result) => {
            const backgroundRepo = new CopilotRepository(options.db, userId);
            const pendingActions = backgroundRepo.listPendingActions(result.run.id);
            recordCopilotEventAudits(options.db, userId, req.ip, result.run, result.events, pendingActions);
            storeAssistantMessages(
              backgroundRepo,
              req.params.id,
              result.run.id,
              result.events,
              pendingActions
            );
            if (!result.ok && result.run.status === "failed") {
              recordCopilotRunAudit(options.db, userId, req.ip, "copilot.run.fail", result.run, {}, {
                eventBus: options.eventBus,
                conversationId: req.params.id
              });
              return;
            }
            if (result.ok && result.run.status === "completed") {
              recordCopilotRunAudit(options.db, userId, req.ip, "copilot.run.complete", result.run, {}, {
                eventBus: options.eventBus,
                conversationId: req.params.id
              });
              return;
            }
            if (result.run.status === "waiting_for_approval") {
              emitCopilotRunUpdated(options.eventBus, userId, result.run, "waiting_for_approval", req.params.id);
            }
          })
          .catch(() => {
            const backgroundRepo = new CopilotRepository(options.db, userId);
            const run = backgroundRepo.updateRun(initialRun.id, {
              status: "failed",
              errorCode: "copilot_run_failed",
              errorMessage: "Failed to create copilot conversation message",
              completedAt: Date.now()
            }) ?? initialRun;
            backgroundRepo.addEvent(run.id, {
              type: "run_failed",
              message: "Failed to create copilot conversation message",
              payload: {
                code: "copilot_run_failed",
                message: "Failed to create copilot conversation message"
              }
            });
            recordCopilotRunAudit(options.db, userId, req.ip, "copilot.run.fail", run, {}, {
              eventBus: options.eventBus,
              conversationId: req.params.id
            });
          })
          .finally(() => {
            activeRunUsers.delete(userId);
          });
        res.status(202).json(messagesEnvelope([userMessage], initialRun, [], []));
        return;
      }
      const result = await orchestrator.runText(runInput);
      const pendingActions = repo.listPendingActions(result.run.id);
      recordCopilotEventAudits(options.db, userId, req.ip, result.run, result.events, pendingActions);
      const assistantMessages = storeAssistantMessages(
        repo,
        req.params.id,
        result.run.id,
        result.events,
        pendingActions
      );
      if (!result.ok) {
        if (result.run.status === "failed") {
          recordCopilotRunAudit(options.db, userId, req.ip, "copilot.run.fail", result.run, {}, {
            eventBus: options.eventBus,
            conversationId: req.params.id
          });
        }
        res.status(result.status).json({
          ...errorEnvelope(result.error.message, result.error.code, result.run, result.events),
          details: {
            ...errorEnvelope(result.error.message, result.error.code, result.run, result.events).details,
            messages: [userMessage, ...assistantMessages]
          }
        });
        return;
      }
      if (result.run.status === "completed") {
        recordCopilotRunAudit(options.db, userId, req.ip, "copilot.run.complete", result.run, {}, {
          eventBus: options.eventBus,
          conversationId: req.params.id
        });
      } else if (result.run.status === "waiting_for_approval") {
        emitCopilotRunUpdated(options.eventBus, userId, result.run, "waiting_for_approval", req.params.id);
      }
      res.status(201).json(messagesEnvelope([userMessage, ...assistantMessages], result.run, result.events, pendingActions));
    } catch {
      res.status(500).json({ code: 1, message: "Failed to create copilot conversation message" });
    } finally {
      if (parseResult.data.async !== true) {
        activeRunUsers.delete(userId);
      }
    }
  });

  router.delete("/messages/:id", (req, res) => {
    const message = repoFor(options.db, req).deleteConversationMessage(req.params.id);
    if (!message) return res.status(404).json({ code: 1, message: "Copilot message not found" });
    res.json({ code: 0, data: { message }, message: "" });
  });

  router.post("/runs", async (req, res) => {
    const parseResult = createRunSchema.safeParse(req.body ?? {});
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot run payload");
    const userId = userIdFor(req);
    if (activeRunUsers.has(userId)) {
      return sendRunAlreadyActive(res);
    }
    const repo = new CopilotRepository(options.db, userId);
    const existingActiveRun = repo.listRuns(200).find((run) => isLiveRunStatus(run.status));
    if (existingActiveRun) return sendRunAlreadyActive(res, existingActiveRun);
    activeRunUsers.add(userId);
    try {
      const result = await new CopilotOrchestrator({
        ...options,
        runControls,
        onRunStarted: (run) => recordCopilotRunAudit(options.db, userId, req.ip, "copilot.run.start", run, {}, {
          eventBus: options.eventBus
        })
      }).runText({
        userId,
        prompt: parseResult.data.prompt,
        source: parseResult.data.source,
        ...(parseResult.data.providerProfileId ? { providerProfileId: parseResult.data.providerProfileId } : {}),
        ...(parseResult.data.modelProfileId ? { modelProfileId: parseResult.data.modelProfileId } : {}),
        ...(parseResult.data.sourceRefId ? { sourceRefId: parseResult.data.sourceRefId } : {})
      });
      const pendingActions = repo.listPendingActions(result.run.id);
      recordCopilotEventAudits(options.db, userId, req.ip, result.run, result.events, pendingActions);
      if (!result.ok) {
        if (result.run.status === "failed") {
          recordCopilotRunAudit(options.db, userId, req.ip, "copilot.run.fail", result.run, {}, {
            eventBus: options.eventBus
          });
        }
        res.status(result.status).json(errorEnvelope(result.error.message, result.error.code, result.run, result.events));
        return;
      }
      if (result.run.status === "completed") {
        recordCopilotRunAudit(options.db, userId, req.ip, "copilot.run.complete", result.run, {}, {
          eventBus: options.eventBus
        });
      } else if (result.run.status === "waiting_for_approval") {
        emitCopilotRunUpdated(options.eventBus, userId, result.run, "waiting_for_approval", undefined);
      }
      res.status(201).json(successEnvelope(result.run, result.events, pendingActions));
    } catch {
      res.status(500).json({ code: 1, message: "Failed to create copilot run" });
    } finally {
      activeRunUsers.delete(userId);
    }
  });

  router.get("/runs/:id", (req, res) => {
    const repo = repoFor(options.db, req);
    const run = repo.getRun(req.params.id);
    if (!run) return res.status(404).json({ code: 1, message: "Copilot run not found" });
    res.json(successEnvelope(run, repo.listEvents(run.id), repo.listPendingActions(run.id)));
  });

  router.post("/runs/:id/cancel", (req, res) => {
    const repo = repoFor(options.db, req);
    const current = repo.getRun(req.params.id);
    if (!current) return res.status(404).json({ code: 1, message: "Copilot run not found" });
    if (!isCancellableRunStatus(current.status)) {
      return res.status(409).json({
        code: 1,
        message: "Copilot run cannot be cancelled from its current status",
        details: { code: "copilot_run_not_cancellable", status: current.status }
      });
    }
    const run = repo.updateRunIfStatus(current.id, current.status, {
      status: "cancelled",
      completedAt: Date.now()
    });
    if (!run) {
      const latest = repo.getRun(current.id) ?? current;
      return res.status(409).json({
        code: 1,
        message: "Copilot run cannot be cancelled from its current status",
        details: { code: "copilot_run_not_cancellable", status: latest.status }
      });
    }
    const rejectedPendingActions = rejectPendingActions(repo, current.id);
    for (const action of rejectedPendingActions) {
      recordPendingActionAudit(options.db, userIdFor(req), req.ip, action, "rejected", { reason: "run_cancelled" });
      recordPendingActionDecision(repo, action, "rejected");
    }
    const abortSignalDelivered = runControls.cancel(current.id);
    repo.addEvent(run.id, {
      type: "run_cancelled",
      message: "Copilot run cancelled",
      payload: {
        rejectedPendingActionCount: rejectedPendingActions.length,
        abortSignalDelivered
      }
    });
    recordCopilotRunAudit(options.db, userIdFor(req), req.ip, "copilot.run.cancel", run, {
      rejectedPendingActionCount: rejectedPendingActions.length,
      abortSignalDelivered
    }, {
      eventBus: options.eventBus,
      conversationId: repo.findConversationIdByRunId(run.id)
    });
    res.json(successEnvelope(run, repo.listEvents(run.id), repo.listPendingActions(run.id)));
  });

  router.post("/runs/:id/pending-actions/:actionId/approve", async (req, res) => {
    const repo = repoFor(options.db, req);
    const target = findPendingActionTarget(repo, req.params.id, req.params.actionId);
    if (!target) return res.status(404).json({ code: 1, message: "Pending action not found" });
    const action = target.action;
    if (action.status !== "pending") {
      return sendPendingActionNotPending(res, "Pending action is not approvable", 409, action.status);
    }
    if (!isApprovalRunStatus(target.run.status)) {
      return res.status(409).json({
        code: 1,
        message: "Copilot run is not waiting for approval",
        details: { code: "copilot_run_not_approvable", status: target.run.status }
      });
    }
    const claimed = repo.updatePendingActionIfStatus(action.id, "pending", { status: "processing" });
    if (!claimed) {
      return sendPendingActionNotPending(
        res,
        "Pending action is not approvable",
        409,
        repo.getPendingAction(action.id)?.status
      );
    }
    let result: Record<string, unknown>;
    try {
      result = await (options.pendingActionApprover ?? approvePendingAction)(claimed, options, userIdFor(req));
    } catch {
      const cancelled = rejectClaimIfRunCancelled(repo, target.run.id, claimed.id);
      if (cancelled) return sendRunCancelledDuringApproval(res);
      repo.updatePendingActionIfStatus(claimed.id, "processing", {
        status: "pending",
        result: null,
        approvedBy: null,
        approvedAt: null
      });
      res.status(500).json({
        code: 1,
        message: "Failed to approve pending action",
        details: { code: "copilot_pending_action_approval_failed" }
      });
      return;
    }
    const cancelled = rejectClaimIfRunCancelled(repo, target.run.id, claimed.id);
    if (cancelled) return sendRunCancelledDuringApproval(res);
    if (isApprovalError(result)) {
      repo.updatePendingActionIfStatus(claimed.id, "processing", {
        status: "pending",
        result: null,
        approvedBy: null,
        approvedAt: null
      });
      res.status(400).json({ code: 1, message: result.error.message, details: { code: result.error.code } });
      return;
    }
    const updated = repo.updatePendingActionIfStatusAndRunStatus(claimed.id, "processing", "waiting_for_approval", {
      status: "approved",
      result,
      approvedBy: userIdFor(req),
      approvedAt: Date.now()
    });
    if (!updated) {
      const cancelled = rejectClaimIfRunCancelled(repo, target.run.id, claimed.id);
      if (cancelled) return sendRunCancelledDuringApproval(res);
      const latestRun = repo.getRun(target.run.id);
      if (latestRun && !isApprovalRunStatus(latestRun.status)) {
        return res.status(409).json({
          code: 1,
          message: "Copilot run is not waiting for approval",
          details: { code: "copilot_run_not_approvable", status: latestRun.status }
        });
      }
      return sendPendingActionNotPending(
        res,
        "Pending action is not approvable",
        409,
        repo.getPendingAction(claimed.id)?.status
      );
    }
    recordPendingActionAudit(options.db, userIdFor(req), req.ip, claimed, "approved", result);
    const decisionEvent = recordPendingActionDecision(repo, claimed, "approved", result);
    const continuationConversationId = repo.findConversationIdByRunId(target.run.id);
    const continuation = await continueApprovedPendingAction({
      repo,
      options,
      userId: userIdFor(req),
      ipAddress: req.ip,
      run: target.run,
      action: claimed,
      result,
      decisionEvent,
      runControls,
      conversationId: continuationConversationId
    });
    if (continuation) {
      res.json(pendingActionEnvelope(
        updated,
        continuation.run,
        repo.listEvents(continuation.run.id),
        repo.listPendingActions(continuation.run.id)
      ));
      return;
    }
    const run = completeRunIfNoPendingActions(repo, target.run);
    storePendingActionApprovalFollowUpMessage(repo, run, claimed, decisionEvent, continuationConversationId);
    if (run.status === "completed") {
      recordCopilotRunAudit(options.db, userIdFor(req), req.ip, "copilot.run.complete", run, {}, {
        eventBus: options.eventBus,
        conversationId: continuationConversationId
      });
    } else if (run.status === "waiting_for_approval") {
      emitCopilotRunUpdated(options.eventBus, userIdFor(req), run, "waiting_for_approval", continuationConversationId);
    }
    res.json(pendingActionEnvelope(updated, run, repo.listEvents(run.id), repo.listPendingActions(run.id)));
  });

  router.post("/runs/:id/pending-actions/:actionId/reject", (req, res) => {
    const repo = repoFor(options.db, req);
    const target = findPendingActionTarget(repo, req.params.id, req.params.actionId);
    if (!target) return res.status(404).json({ code: 1, message: "Pending action not found" });
    if (target.action.status !== "pending" && target.action.status !== "processing") {
      return sendPendingActionNotPending(res, "Pending action is not rejectable", 400, target.action.status);
    }
    if (!isApprovalRunStatus(target.run.status)) {
      return res.status(409).json({
        code: 1,
        message: "Copilot run is not waiting for approval",
        details: { code: "copilot_run_not_approvable", status: target.run.status }
      });
    }
    const result = { reason: "user_rejected" };
    const updated = repo.updatePendingActionIfStatus(target.action.id, target.action.status, {
      status: "rejected",
      result
    });
    if (!updated) {
      return sendPendingActionNotPending(
        res,
        "Pending action is not rejectable",
        409,
        repo.getPendingAction(target.action.id)?.status
      );
    }
    recordPendingActionAudit(options.db, userIdFor(req), req.ip, target.action, "rejected", result);
    recordPendingActionDecision(repo, target.action, "rejected", result);
    const run = completeRunIfNoPendingActions(repo, target.run);
    const conversationId = repo.findConversationIdByRunId(run.id);
    if (run.status === "completed") {
      recordCopilotRunAudit(options.db, userIdFor(req), req.ip, "copilot.run.complete", run, {}, {
        eventBus: options.eventBus,
        conversationId
      });
    } else if (run.status === "waiting_for_approval") {
      emitCopilotRunUpdated(options.eventBus, userIdFor(req), run, "waiting_for_approval", conversationId);
    }
    res.json(pendingActionEnvelope(updated, run, repo.listEvents(run.id), repo.listPendingActions(run.id)));
  });

  return router;
}

function repoFor(db: Database, req: unknown): CopilotRepository {
  return new CopilotRepository(db, userIdFor(req));
}

function memoryRepoFor(db: Database, req: unknown): CopilotMemoryRepository {
  return new CopilotMemoryRepository(db, userIdFor(req));
}

function userIdFor(req: unknown): string {
  return (req as AuthenticatedRequest).userId;
}

function listRunsWithLiveRecovery(repo: CopilotRepository, limit: number | undefined): CopilotRun[] {
  const historyLimit = limit ?? 50;
  const recentRuns = repo.listRuns(historyLimit);
  const seenIds = new Set(recentRuns.map((run) => run.id));
  const recoveredLiveRuns = repo
    .listRuns(200)
    .filter((run) => isLiveRunStatus(run.status) && !seenIds.has(run.id));
  return [...recentRuns, ...recoveredLiveRuns];
}

function successEnvelope(
  run: CopilotRun,
  events: CopilotRunEvent[],
  pendingActions: CopilotPendingAction[] = []
) {
  return {
    code: 0,
    data: { run, events, pendingActions },
    message: ""
  };
}

function conversationEnvelope(conversation: CopilotConversation) {
  return {
    code: 0,
    data: { conversation },
    message: ""
  };
}

function messagesEnvelope(
  messages: CopilotMessage[],
  run?: CopilotRun,
  events: CopilotRunEvent[] = [],
  pendingActions: CopilotPendingAction[] = []
) {
  return {
    code: 0,
    data: {
      messages,
      ...(run ? { run, events, pendingActions } : {})
    },
    message: ""
  };
}

function memoryItemEnvelope(type: CopilotMemoryItemType, item: CopilotMemoryEntry | CopilotMemoryNote) {
  return {
    code: 0,
    data: {
      item: {
        type,
        ...item
      }
    },
    message: ""
  };
}

function getMemoryItem(
  repo: CopilotMemoryRepository,
  type: CopilotMemoryItemType,
  id: string
): CopilotMemoryEntry | CopilotMemoryNote | undefined {
  return type === "entry" ? repo.getEntry(id) : repo.getNote(id);
}

function deleteMemoryItem(
  repo: CopilotMemoryRepository,
  type: CopilotMemoryItemType,
  id: string
): CopilotMemoryEntry | CopilotMemoryNote | undefined {
  return type === "entry" ? repo.deleteEntry(id) : repo.deleteNote(id);
}

function pendingActionEnvelope(
  action: CopilotPendingAction,
  run: CopilotRun,
  events: CopilotRunEvent[],
  pendingActions: CopilotPendingAction[]
) {
  return {
    code: 0,
    data: { action, run, events, pendingActions },
    message: ""
  };
}

function storeAssistantMessages(
  repo: CopilotRepository,
  conversationId: string,
  runId: string,
  events: CopilotRunEvent[],
  pendingActions: CopilotPendingAction[] = []
): CopilotMessage[] {
  const messages: CopilotMessage[] = [];
  let previousAssistantSequence = 0;
  const assistantEvents = events.filter((event) => event.type === "assistant_message");
  for (let index = 0; index < assistantEvents.length; index += 1) {
    const event = assistantEvents[index];
    if (!event) continue;
    if (event.type !== "assistant_message") continue;
    const text = sanitizeCopilotAssistantText(
      typeof event.payload.text === "string" ? event.payload.text : event.message ?? ""
    );
    const nextAssistantSequence = assistantEvents[index + 1]?.sequence;
    const activityEvents = events
      .filter((item) =>
        item.type !== "assistant_message" &&
        (nextAssistantSequence
          ? item.sequence > previousAssistantSequence && item.sequence < event.sequence
          : item.sequence > previousAssistantSequence && item.sequence !== event.sequence)
      )
      .map(toConversationRunActivityEvent);
    previousAssistantSequence = event.sequence;
    if (!text) continue;
    const activity = {
      events: activityEvents,
      pendingActions: pendingActions.map(toConversationPendingAction)
    };
    messages.push(repo.createConversationMessage(conversationId, {
      role: "assistant",
      content: text,
      runId,
      payload: {
        eventId: event.id,
        sequence: event.sequence,
        ...((activity.events.length > 0 || activity.pendingActions.length > 0) ? { runActivity: activity } : {})
      }
    }));
  }
  return messages;
}

function storePendingActionApprovalFollowUpMessage(
  repo: CopilotRepository,
  run: CopilotRun,
  action: CopilotPendingAction,
  decisionEvent: CopilotRunEvent,
  conversationId = repo.findConversationIdByRunId(run.id)
): CopilotMessage | undefined {
  if (action.type !== "openforge.propose_session_input") return undefined;
  if (!conversationId) return undefined;
  return repo.createConversationMessage(conversationId, {
    role: "assistant",
    content: "Terminal input was sent to the session. I captured the latest terminal output in the activity below.",
    runId: run.id,
    payload: {
      eventId: decisionEvent.id,
      sequence: decisionEvent.sequence,
      runActivity: {
        events: [toConversationRunActivityEvent(decisionEvent)],
        pendingActions: []
      }
    }
  });
}

async function continueApprovedPendingAction(input: {
  repo: CopilotRepository;
  options: CopilotRoutesOptions;
  userId: string;
  ipAddress: string | undefined;
  run: CopilotRun;
  action: CopilotPendingAction;
  result: Record<string, unknown>;
  decisionEvent: CopilotRunEvent;
  runControls: CopilotRunControlRegistry;
  conversationId: string | undefined;
}): Promise<RunCopilotContinuation | null> {
  if (!input.run.providerProfileId || !input.run.modelProfileId) return null;
  if (input.repo.listPendingActions(input.run.id).some((action) => action.status === "pending" || action.status === "processing")) {
    return null;
  }
  const orchestrator = new CopilotOrchestrator({
    ...input.options,
    runControls: input.runControls
  });
  const result = await orchestrator.continueAfterApprovedAction({
    userId: input.userId,
    runId: input.run.id,
    action: input.action,
    result: input.result
  });
  if (!result) return null;
  const pendingActions = input.repo.listPendingActions(result.run.id);
  const newEvents = result.events.filter((event) => event.sequence > input.decisionEvent.sequence);
  const conversationEvents = result.events.filter((event) => event.sequence >= input.decisionEvent.sequence);
  recordCopilotEventAudits(input.options.db, input.userId, input.ipAddress, result.run, newEvents, pendingActions);
  if (input.conversationId) {
    storeAssistantMessages(input.repo, input.conversationId, result.run.id, conversationEvents, pendingActions);
  }
  if (!result.ok && result.run.status === "failed") {
    recordCopilotRunAudit(input.options.db, input.userId, input.ipAddress, "copilot.run.fail", result.run, {}, {
      eventBus: input.options.eventBus,
      conversationId: input.conversationId
    });
  }
  if (result.ok && result.run.status === "completed") {
    recordCopilotRunAudit(input.options.db, input.userId, input.ipAddress, "copilot.run.complete", result.run, {}, {
      eventBus: input.options.eventBus,
      conversationId: input.conversationId
    });
  } else if (result.run.status === "waiting_for_approval") {
    emitCopilotRunUpdated(input.options.eventBus, input.userId, result.run, "waiting_for_approval", input.conversationId);
  }
  return { run: result.run };
}

interface RunCopilotContinuation {
  run: CopilotRun;
}

function toConversationRunActivityEvent(event: CopilotRunEvent): Record<string, unknown> {
  return {
    id: event.id,
    runId: event.runId,
    type: event.type,
    sequence: event.sequence,
    message: event.message,
    payload: redactCopilotPayload(event.payload) as Record<string, unknown>,
    createdAt: event.createdAt
  };
}

function toConversationPendingAction(action: CopilotPendingAction): Record<string, unknown> {
  return {
    id: action.id,
    runId: action.runId,
    type: action.type,
    status: action.status,
    input: redactCopilotPayload(action.input) as Record<string, unknown>,
    result: action.result ? redactCopilotPayload(action.result) as Record<string, unknown> : null,
    approvedBy: action.approvedBy,
    approvedAt: action.approvedAt,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt
  };
}

function errorEnvelope(message: string, code: string, run: CopilotRun, events: CopilotRunEvent[]) {
  return {
    code: 1,
    message,
    details: { code, run, events }
  };
}

function sendInvalid(res: { status: (code: number) => { json: (body: unknown) => void } }, message: string): void {
  res.status(400).json({ code: 1, message });
}

function sendMemoryItemNotFound(res: { status: (code: number) => { json: (body: unknown) => void } }): void {
  res.status(404).json({ code: 1, message: "Copilot memory item not found" });
}

function isCancellableRunStatus(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting_for_approval";
}

function isLiveRunStatus(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting_for_approval";
}

function isApprovalRunStatus(status: string): boolean {
  return status === "waiting_for_approval";
}

function sendRunAlreadyActive(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  run?: Pick<CopilotRun, "id" | "status">
): void {
  res.status(409).json({
    code: 1,
    message: "Copilot run already active for this user",
    details: {
      code: "copilot_run_already_active",
      ...(run ? { runId: run.id, status: run.status } : {})
    }
  });
}

function sendPendingActionNotPending(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  message: string,
  statusCode: number,
  status?: string
): void {
  res.status(statusCode).json({
    code: 1,
    message,
    details: {
      code: "copilot_pending_action_not_pending",
      ...(status ? { status } : {})
    }
  });
}

function rejectPendingActions(repo: CopilotRepository, runId: string): CopilotPendingAction[] {
  const rejected: CopilotPendingAction[] = [];
  for (const action of repo.listPendingActions(runId)) {
    if (action.status === "pending" || action.status === "processing") {
      const updated = repo.updatePendingActionIfStatus(action.id, action.status, {
        status: "rejected",
        result: { reason: "run_cancelled" }
      });
      if (updated) rejected.push(updated);
    }
  }
  return rejected;
}

function rejectClaimIfRunCancelled(repo: CopilotRepository, runId: string, actionId: string): boolean {
  const run = repo.getRun(runId);
  if (run?.status !== "cancelled") return false;
  repo.updatePendingActionIfStatus(actionId, "processing", {
    status: "rejected",
    result: { reason: "run_cancelled" }
  });
  return true;
}

function sendRunCancelledDuringApproval(
  res: { status: (code: number) => { json: (body: unknown) => void } }
): void {
  res.status(409).json({
    code: 1,
    message: "Copilot run was cancelled before the pending action could be approved",
    details: { code: "copilot_run_cancelled" }
  });
}

function recordPendingActionDecision(
  repo: CopilotRepository,
  action: CopilotPendingAction,
  decision: "approved" | "rejected",
  result?: Record<string, unknown>
): CopilotRunEvent {
  const actionType = String(redactCopilotPayload(action.type));
  return repo.addEvent(action.runId, {
    type: `pending_action_${decision}`,
    message: actionType,
    payload: {
      actionId: action.id,
      actionType,
      status: decision,
      ...(result ? { result: redactCopilotPayload(result) } : {})
    }
  });
}

function recordCopilotEventAudits(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  run: CopilotRun,
  events: CopilotRunEvent[],
  pendingActions: CopilotPendingAction[]
): void {
  let pendingTool: { id?: string; name?: string } | null = null;
  for (const event of events) {
    if (event.type === "tool_call_requested") {
      recordCopilotToolRequestAudit(db, userId, ipAddress, run, event);
      pendingTool = readToolAuditRef(event);
      continue;
    }
    if (event.type === "tool_result") {
      recordCopilotToolResultAudit(db, userId, ipAddress, run, event, pendingTool);
      pendingTool = null;
      continue;
    }
    if (event.type === "run_failed" && pendingTool) {
      recordCopilotToolFailureAudit(db, userId, ipAddress, run, event, pendingTool);
      pendingTool = null;
    }
  }
  for (const action of pendingActions) {
    recordPendingActionCreateAudit(db, userId, ipAddress, action);
  }
}

function readToolAuditRef(event: CopilotRunEvent): { id?: string; name?: string } {
  const ref: { id?: string; name?: string } = {};
  if (typeof event.payload.id === "string") ref.id = event.payload.id;
  if (typeof event.payload.name === "string") ref.name = event.payload.name;
  else if (event.message) ref.name = event.message;
  return ref;
}

function recordCopilotToolRequestAudit(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  run: CopilotRun,
  event: CopilotRunEvent
): void {
  const payload = event.payload;
  new AuditLogRepository(db, userId).create({
    action: "copilot.tool.request",
    resourceType: "copilot_run",
    resourceId: run.id,
    details: {
      runId: run.id,
      eventId: event.id,
      sequence: event.sequence,
      toolCallId: redactCopilotPayload(typeof payload.id === "string" ? payload.id : undefined),
      toolName: redactCopilotPayload(typeof payload.name === "string" ? payload.name : event.message),
      input: redactCopilotPayload(payload.input)
    },
    ipAddress
  });
}

function recordCopilotToolResultAudit(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  run: CopilotRun,
  event: CopilotRunEvent,
  pendingTool: { id?: string; name?: string } | null
): void {
  const payload = event.payload;
  new AuditLogRepository(db, userId).create({
    action: "copilot.tool.result",
    resourceType: "copilot_run",
    resourceId: run.id,
    details: {
      runId: run.id,
      eventId: event.id,
      sequence: event.sequence,
      toolCallId: redactCopilotPayload(typeof payload.toolCallId === "string" ? payload.toolCallId : pendingTool?.id),
      toolName: redactCopilotPayload(event.message ?? pendingTool?.name),
      output: redactCopilotPayload(payload.output)
    },
    ipAddress
  });
}

function recordCopilotToolFailureAudit(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  run: CopilotRun,
  event: CopilotRunEvent,
  pendingTool: { id?: string; name?: string }
): void {
  const payload = event.payload;
  new AuditLogRepository(db, userId).create({
    action: "copilot.tool.fail",
    resourceType: "copilot_run",
    resourceId: run.id,
    details: {
      runId: run.id,
      eventId: event.id,
      sequence: event.sequence,
      toolCallId: redactCopilotPayload(pendingTool.id),
      toolName: redactCopilotPayload(pendingTool.name),
      errorCode: typeof payload.code === "string" ? payload.code : undefined,
      errorMessage: redactCopilotPayload(
        typeof payload.message === "string" ? payload.message : event.message
      )
    },
    ipAddress
  });
}

function recordPendingActionCreateAudit(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  action: CopilotPendingAction
): void {
  new AuditLogRepository(db, userId).create({
    action: "copilot.pending_action.create",
    resourceType: "copilot_run",
    resourceId: action.runId,
    details: {
      runId: action.runId,
      actionId: action.id,
      actionType: redactCopilotPayload(action.type),
      status: action.status,
      input: redactCopilotPayload(action.input)
    },
    ipAddress
  });
}

type CopilotRunAuditAction = "copilot.run.start" | "copilot.run.complete" | "copilot.run.fail" | "copilot.run.cancel";
type CopilotRunUpdateEventType =
  | "started"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_for_approval"
  | "event_appended"
  | "assistant_delta";

const copilotRunAuditEventTypes: Record<CopilotRunAuditAction, CopilotRunUpdateEventType> = {
  "copilot.run.start": "started",
  "copilot.run.complete": "completed",
  "copilot.run.fail": "failed",
  "copilot.run.cancel": "cancelled"
};

interface CopilotRunAuditOptions {
  eventBus?: OpenForgeEventBus | undefined;
  conversationId?: string | undefined;
  eventType?: CopilotRunUpdateEventType | undefined;
}

function recordCopilotRunAudit(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  auditAction: CopilotRunAuditAction,
  run: CopilotRun,
  extraDetails: Record<string, unknown> = {},
  auditOptions: CopilotRunAuditOptions = {}
): void {
  new AuditLogRepository(db, userId).create({
    action: auditAction,
    resourceType: "copilot_run",
    resourceId: run.id,
    details: {
      runId: run.id,
      status: run.status,
      source: run.source,
      ...(run.sourceRefId ? { sourceRefId: redactCopilotPayload(run.sourceRefId) } : {}),
      ...(run.providerProfileId ? { providerProfileId: run.providerProfileId } : {}),
      ...(run.modelProfileId ? { modelProfileId: run.modelProfileId } : {}),
      stepCount: run.stepCount,
      ...(run.errorCode ? { errorCode: run.errorCode } : {}),
      ...(run.errorMessage ? { errorMessage: redactCopilotPayload(run.errorMessage) } : {}),
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      ...extraDetails
    },
    ipAddress
  });
  emitCopilotRunUpdated(
    auditOptions.eventBus,
    userId,
    run,
    auditOptions.eventType ?? copilotRunAuditEventTypes[auditAction],
    auditOptions.conversationId
  );
}

function emitCopilotRunUpdated(
  eventBus: OpenForgeEventBus | undefined,
  userId: string,
  run: CopilotRun,
  eventType: CopilotRunUpdateEventType,
  conversationId: string | undefined,
  runEvent?: CopilotRunEvent | undefined,
  deltaText?: string | undefined
): void {
  eventBus?.emitEvent({
    type: "copilot_run_updated",
    userId,
    runId: run.id,
    status: run.status,
    source: run.source,
    ...(run.sourceRefId ? { sourceRefId: run.sourceRefId } : {}),
    ...(conversationId ? { conversationId } : {}),
    eventType,
    ...(runEvent ? {
      runEventType: runEvent.type,
      runEventSequence: runEvent.sequence
    } : {}),
    ...(deltaText ? { deltaText: redactCopilotText(deltaText) } : {}),
    ...(run.errorCode ? { errorCode: run.errorCode } : {})
  });
}

function recordPendingActionAudit(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  action: CopilotPendingAction,
  decision: "approved" | "rejected",
  result: Record<string, unknown>
): void {
  new AuditLogRepository(db, userId).create({
    action: decision === "approved" ? "copilot.pending_action.approve" : "copilot.pending_action.reject",
    resourceType: "copilot_run",
    resourceId: action.runId,
    details: {
      runId: action.runId,
      actionId: action.id,
      actionType: action.type,
      decision,
      ...(decision === "approved" ? { approvedBy: userId } : { rejectedBy: userId }),
      input: redactCopilotPayload(action.input),
      result: redactCopilotAuditResult(result)
    },
    ipAddress
  });
}

function redactCopilotAuditResult(result: Record<string, unknown>): unknown {
  const redacted = redactCopilotPayload(result);
  if (!isRecord(redacted) || !isRecord(redacted.report)) return redacted;
  const report = redacted.report;
  return {
    report: {
      generatedAt: report.generatedAt,
      app: report.app,
      counts: report.counts
    }
  };
}

function completeRunIfNoPendingActions(repo: CopilotRepository, run: CopilotRun): CopilotRun {
  const hasPendingActions = repo
    .listPendingActions(run.id)
    .some((action) => action.status === "pending" || action.status === "processing");
  const current = repo.getRun(run.id) ?? run;
  if (hasPendingActions || current.status !== "waiting_for_approval") return current;
  return repo.updateRunIfStatus(current.id, "waiting_for_approval", {
    status: "completed",
    completedAt: Date.now()
  }) ?? current;
}

function findPendingActionTarget(
  repo: CopilotRepository,
  runId: string,
  actionId: string
): { run: CopilotRun; action: CopilotPendingAction } | undefined {
  const run = repo.getRun(runId);
  if (!run) return undefined;
  const action = repo.getPendingAction(actionId);
  return action?.runId === runId ? { run, action } : undefined;
}

async function approvePendingAction(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  if (action.type === "openforge.propose_diagnostics_export") {
    return {
      report: buildLocalDiagnosticsExport({
        db: options.db,
        userId,
        masterKey: options.masterKey,
        appVersion: options.appVersion ?? "0.0.0"
      })
    };
  }
  if (action.type === "openforge.propose_adapter_refresh") {
    return {
      adapters: await discoverAdapters(options.adapterCommandRunner)
    };
  }
  if (action.type === "openforge.propose_session_create") {
    return await approveCopilotSessionCreateDraft(action, options, userId);
  }
  if (action.type === "openforge.propose_project_create") {
    return await approveCopilotProjectCreate(action, options, userId);
  }
  if (action.type === "openforge.propose_project_import") {
    return await approveCopilotProjectImport(action, options, userId);
  }
  if (action.type === "openforge.propose_project_delete") {
    return await approveCopilotProjectDelete(action, options, userId);
  }
  if (action.type === "openforge.propose_project_config_sync") {
    return await approveCopilotProjectConfigSync(action, options, userId);
  }
  if (action.type === "openforge.propose_session_input") {
    return await approveCopilotSessionInput(action, options, userId);
  }
  if (action.type === "openforge.propose_session_start") {
    return await approveCopilotSessionStart(action, options, userId);
  }
  if (action.type === "openforge.propose_session_stop") {
    return await approveCopilotSessionStop(action, options, userId);
  }
  if (action.type === "openforge.propose_session_delete") {
    return await approveCopilotSessionDelete(action, options, userId);
  }
  if (action.type === "openforge.propose_agent_create") {
    return approveCopilotAgentCreate(action, options, userId);
  }
  if (action.type === "openforge.propose_agent_update") {
    return approveCopilotAgentUpdate(action, options, userId);
  }
  if (action.type === "openforge.propose_agent_delete") {
    return approveCopilotAgentDelete(action, options, userId);
  }
  if (action.type === "openforge.propose_template_create") {
    return approveCopilotTemplateCreate(action, options, userId);
  }
  if (action.type === "openforge.propose_template_update") {
    return approveCopilotTemplateUpdate(action, options, userId);
  }
  if (action.type === "openforge.propose_template_delete") {
    return approveCopilotTemplateDelete(action, options, userId);
  }
  if (action.type === "openforge.propose_skill_toggle") {
    return approveCopilotSkillToggle(action, options, userId);
  }
  if (action.type === "openforge.propose_plugin_toggle") {
    return approveCopilotPluginToggle(action, options, userId);
  }
  if (action.type === "openforge.propose_project_skill_toggle") {
    return approveCopilotProjectSkillToggle(action, options, userId);
  }
  if (action.type === "openforge.propose_copilot_model_selection") {
    return approveCopilotModelSelection(action, options, userId);
  }
  if (action.type === "openforge.propose_model_provider_sync") {
    return await approveCopilotModelProviderSync(action, options, userId);
  }
  if (action.type === "openforge.propose_model_provider_apply") {
    return await approveCopilotModelProviderApply(action, options, userId);
  }
  if (isFeishuPendingActionType(action.type)) {
    return await approveCopilotFeishuAction(action, options, userId);
  }
  if (action.type === "openforge.propose_memory_write") {
    return approveCopilotMemoryWrite(action, { db: options.db, userId });
  }
  if (action.type === "openforge.propose_memory_delete") {
    return approveCopilotMemoryDelete(action, { db: options.db, userId });
  }
  if (action.type === "openforge.propose_troubleshooting_steps") {
    return approveCopilotTroubleshootingSteps(action);
  }
  return {
    error: {
      code: "copilot_pending_action_unsupported",
      message: "Copilot pending action type is not supported"
    }
  };
}

const feishuPendingActionOperations = {
  "openforge.propose_feishu_message_send": "message_send",
  "openforge.propose_feishu_doc_create": "doc_create",
  "openforge.propose_feishu_doc_update": "doc_update",
  "openforge.propose_feishu_task_create": "task_create",
  "openforge.propose_feishu_task_update": "task_update"
} satisfies Record<string, FeishuCommandOperation>;

function isFeishuPendingActionType(type: string): type is keyof typeof feishuPendingActionOperations {
  return type in feishuPendingActionOperations;
}

async function approveCopilotFeishuAction(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const operation = feishuPendingActionOperations[action.type as keyof typeof feishuPendingActionOperations];
  if (!new FeishuIntegrationRepository(options.db, userId).canExecuteActions()) {
    return {
      error: {
        code: "feishu_integration_disabled",
        message: "Feishu integration is disabled"
      }
    };
  }

  const commandResult = await (options.executeFeishuCommand ?? executeFeishuCommand)({
    operation,
    input: action.input
  });
  if (!commandResult.ok) {
    return {
      error: {
        code: commandResult.error.code,
        message: commandResult.error.message
      }
    };
  }

  const result = {
    feishu: {
      operation,
      result: redactCopilotPayload(commandResult.output)
    }
  };
  new AuditLogRepository(options.db, userId).create({
    action: `feishu.${operation}`,
    resourceType: "feishu_integration",
    resourceId: operation,
    details: {
      actionId: action.id,
      runId: action.runId,
      operation,
      result: result.feishu.result
    }
  });
  new CopilotRepository(options.db, userId).addEvent(action.runId, {
    type: "feishu_action_executed",
    message: operation,
    payload: {
      actionId: action.id,
      operation,
      result: result.feishu.result
    }
  });
  return result;
}

async function approveCopilotSessionCreateDraft(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = sessionCreateApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return {
      error: {
        code: "copilot_session_draft_invalid",
        message: "Copilot session draft is invalid"
      }
    };
  }
  const project = new ProjectRepository(options.db, userId).getById(parsed.data.projectId);
  if (!project) {
    return {
      error: {
        code: "copilot_session_draft_invalid",
        message: "Copilot session draft project is not available"
      }
    };
  }
  const adapter = normalizeAdapter(parsed.data.aiTool);
  if (!adapter) {
    return sessionCreateApprovalError(
      "copilot_session_draft_invalid",
      "Copilot session draft adapter is not supported"
    );
  }
  if (!options.sessionManager) {
    return sessionCreateApprovalError(
      "copilot_session_create_unavailable",
      "Copilot session creation is not available"
    );
  }
  const launchStatus = await getAdapterLaunchStatus(adapter, options.adapterCommandRunner);
  if (!launchStatus.launchEnabled) {
    return sessionCreateApprovalError(
      "copilot_session_create_unavailable",
      `${launchStatus.label} is not available for launch`
    );
  }

  const sessionRepo = new SessionRepository(options.db, userId);
  const dbSession = sessionRepo.create({
    projectId: project.id,
    name: parsed.data.name ?? project.name,
    aiTool: adapter,
    workingDir: project.path,
    credentialMode: "host_environment"
  });
  recordCopilotSessionActivity(options, userId, dbSession, "session_created", "info", `Session ${dbSession.name} created`);
  options.eventBus?.emitEvent({
    type: "session_created",
    userId,
    sessionId: dbSession.id,
    projectId: project.id,
    name: dbSession.name
  });

  try {
    const pluginDirs = await prepareClaudeLaunchExtras(options.db, userId, adapter, project.path, dbSession.id);
    const launchPlan = createLaunchPlan({
      db: options.db,
      userId,
      masterKey: options.masterKey,
      adapter,
      projectRoot: project.path,
      sessionId: dbSession.id,
      credentialMode: "host_environment",
      ...(pluginDirs.length > 0 ? { pluginDirs } : {})
    });
    const attachToken = randomUUID();
    sessionRepo.update(dbSession.id, { attachToken });
    const session = await options.sessionManager.createSession({
      userId,
      sessionId: dbSession.id,
      launchPlan,
      attachToken
    });
    const oldStatus = dbSession.status;
    const updated = sessionRepo.update(dbSession.id, {
      status: "running",
      attachToken: session.attachToken,
      tmuxSession: session.tmuxName,
      lastActive: new Date()
    }) ?? dbSession;
    recordCopilotSessionActivity(options, userId, updated, "session_started", "success", `Session ${updated.name} started`);
    recordSessionSnapshot({
      db: options.db,
      userId,
      session: updated,
      metadata: { reason: "copilot_session_create_approved" }
    });
    options.eventBus?.emitEvent({
      type: "session_status_changed",
      userId,
      sessionId: dbSession.id,
      oldStatus,
      newStatus: "running"
    });
    return { session: toCopilotSessionPayload(updated), executed: true };
  } catch (error) {
    const oldStatus = dbSession.status;
    const message = error instanceof Error ? error.message : "Failed to create session";
    const updated = sessionRepo.update(dbSession.id, {
      status: "error",
      attachToken: "",
      errorMessage: message
    }) ?? dbSession;
    recordCopilotSessionActivity(options, userId, updated, "session_error", "error", message);
    options.eventBus?.emitEvent({
      type: "session_status_changed",
      userId,
      sessionId: dbSession.id,
      oldStatus,
      newStatus: "error"
    });
    return sessionCreateApprovalError("copilot_session_create_failed", message);
  }
}

function sessionCreateApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

async function approveCopilotProjectCreate(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = projectCreateApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return projectCreateApprovalError(
      "copilot_project_create_invalid",
      "Copilot project draft is invalid"
    );
  }

  try {
    const aiTool = parsed.data.aiTool ?? "claude";
    const rootPath = await prepareCreatedProjectRoot(parsed.data.path);
    const templateId = resolveProjectTemplateId(options.db, userId, aiTool, parsed.data.templateId);
    const project = new ProjectRepository(options.db, userId).create({
      name: parsed.data.name,
      path: rootPath,
      description: parsed.data.description,
      techStack: parsed.data.techStack,
      aiTool,
      templateId
    });
    return { project: toCopilotProjectPayload(project), executed: true };
  } catch (error) {
    return projectCreateApprovalError(
      "copilot_project_create_failed",
      error instanceof Error ? error.message : "Failed to create project"
    );
  }
}

function projectCreateApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

async function approveCopilotProjectImport(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = projectImportApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return projectImportApprovalError(
      "copilot_project_import_invalid",
      "Copilot project import payload is invalid"
    );
  }

  try {
    const aiTool = parsed.data.aiTool ?? "claude";
    const rootPath = await prepareImportedProjectRoot(parsed.data.path);
    const templateId = resolveProjectTemplateId(options.db, userId, aiTool, parsed.data.templateId);
    const project = new ProjectRepository(options.db, userId).import({
      name: parsed.data.name,
      path: rootPath,
      description: parsed.data.description,
      techStack: parsed.data.techStack,
      aiTool,
      templateId
    });
    return { project: toCopilotProjectPayload(project), executed: true };
  } catch (error) {
    return projectImportApprovalError(
      "copilot_project_import_failed",
      error instanceof Error ? error.message : "Failed to import project"
    );
  }
}

function projectImportApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

async function approveCopilotProjectDelete(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = projectDeleteApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return projectDeleteApprovalError(
      "copilot_project_delete_invalid",
      "Copilot project delete payload is invalid"
    );
  }
  const projectRepo = new ProjectRepository(options.db, userId);
  const project = projectRepo.getById(parsed.data.projectId);
  if (!project) {
    return projectDeleteApprovalError(
      "copilot_project_delete_invalid",
      "Copilot project delete target is not available"
    );
  }

  try {
    const sessionRepo = new SessionRepository(options.db, userId);
    const runningSessions = sessionRepo
      .listByProject(project.id)
      .filter((session) => session.status === "running" && session.tmuxSession);
    let stoppedSessionCount = 0;
    if (options.sessionManager) {
      for (const session of runningSessions) {
        try {
          await options.sessionManager.stopSession(session.id, session.tmuxSession ?? undefined, userId);
          stoppedSessionCount += 1;
        } catch {
          // Match project deletion behavior: an already-dead tmux pane must not block deleting the project record.
        }
      }
    }
    projectRepo.delete(project.id);
    return {
      project: toCopilotProjectPayload(project),
      stoppedSessionCount,
      executed: true
    };
  } catch (error) {
    return projectDeleteApprovalError(
      "copilot_project_delete_failed",
      error instanceof Error ? error.message : "Failed to delete project"
    );
  }
}

function projectDeleteApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

async function approveCopilotProjectConfigSync(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = projectConfigSyncApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return projectConfigSyncApprovalError(
      "copilot_project_config_sync_invalid",
      "Copilot project config sync payload is invalid"
    );
  }
  const project = new ProjectRepository(options.db, userId).getById(parsed.data.projectId);
  if (!project) {
    return projectConfigSyncApprovalError(
      "copilot_project_config_sync_invalid",
      "Copilot project config sync target is not available"
    );
  }

  try {
    const templateId = resolveProjectTemplateId(
      options.db,
      userId,
      project.aiTool,
      parsed.data.templateId ?? project.templateId ?? undefined
    );
    const plan = await buildProjectConfigRenderPlan(
      options.db,
      userId,
      project.id,
      templateId,
      parsed.data.credentialMode,
      false
    );
    const result = await writeConfigPlan(
      plan,
      parsed.data.decisions === undefined ? {} : { decisions: parsed.data.decisions }
    );
    const summary = buildConfigSyncSummary(plan, result.conflicts);
    recordActivity({
      db: options.db,
      eventBus: options.eventBus,
      userId,
      projectId: project.id,
      type: "config_sync",
      status: "success",
      message: `Config synced for ${project.name}`,
      metadata: {
        templateId,
        writtenFiles: result.writtenFiles,
        skippedFiles: result.skippedFiles
      }
    });
    new AuditLogRepository(options.db, userId).create({
      action: "project.config_sync",
      resourceType: "project",
      resourceId: project.id,
      details: {
        templateId,
        writtenFiles: result.writtenFiles.length,
        skippedFiles: result.skippedFiles.length,
        conflicts: result.conflicts.length,
        decisionRequired: summary.requiresDecision.length,
        source: "copilot"
      }
    });
    return { result, summary, executed: true };
  } catch (error) {
    if (error instanceof ConfigWriteError) {
      return projectConfigSyncApprovalError(
        "copilot_project_config_sync_conflict",
        error.message
      );
    }
    return projectConfigSyncApprovalError(
      "copilot_project_config_sync_failed",
      error instanceof Error ? error.message : "Failed to sync project config"
    );
  }
}

function projectConfigSyncApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

function recordCopilotSessionActivity(
  options: Pick<CopilotRoutesOptions, "db" | "eventBus">,
  userId: string,
  session: Session,
  type: string,
  status: "info" | "success" | "warning" | "error",
  message: string
): void {
  recordActivity({
    db: options.db,
    eventBus: options.eventBus,
    userId,
    sessionId: session.id,
    projectId: session.projectId,
    type,
    status,
    message
  });
}

function toCopilotSessionPayload(session: Session): Omit<Session, "attachToken"> & { tmuxName: string | null } {
  const { attachToken: _attachToken, ...safe } = session;
  return {
    ...safe,
    tmuxName: session.tmuxSession
  };
}

function toCopilotProjectPayload(project: Project): Project {
  return project;
}

async function approveCopilotSessionInput(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = sessionInputApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return sessionInputApprovalError(
      "copilot_session_input_invalid",
      "Copilot session input payload is invalid"
    );
  }
  const session = new SessionRepository(options.db, userId).getById(parsed.data.sessionId);
  if (!session || session.status !== "running" || !session.tmuxSession) {
    return sessionInputApprovalError(
      "copilot_session_input_invalid",
      "Copilot session input target is not a running terminal session"
    );
  }
  if (!options.sessionManager) {
    return sessionInputApprovalError(
      "copilot_session_input_unavailable",
      "Copilot terminal input is not available"
    );
  }
  const data = buildApprovedSessionInput(parsed.data.input, parsed.data.submit === true);
  await options.sessionManager.sendInput(session.id, data);
  new SessionRepository(options.db, userId).update(session.id, { lastActive: new Date() });
  const terminal = await captureApprovedSessionInputHistory(options, session);
  return {
    sessionId: session.id,
    submitted: parsed.data.submit === true,
    bytes: Buffer.byteLength(data, "utf8"),
    terminal
  };
}

async function captureApprovedSessionInputHistory(
  options: CopilotRoutesOptions,
  session: Session
): Promise<{ available: boolean; text?: string; truncated?: boolean; reason?: string }> {
  if (!options.sessionManager?.captureHistory) {
    return { available: false, reason: "terminal_history_unavailable" };
  }
  try {
    const raw = await options.sessionManager.captureHistory(session.id);
    const redacted = redactCopilotText(raw);
    const maxLength = 4_000;
    const truncated = redacted.length > maxLength;
    const text = truncated ? redacted.slice(redacted.length - maxLength) : redacted;
    return { available: true, text, truncated };
  } catch {
    return { available: false, reason: "terminal_history_capture_failed" };
  }
}

function sessionInputApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

async function approveCopilotSessionStart(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = sessionStartApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return sessionStartApprovalError(
      "copilot_session_start_invalid",
      "Copilot session start payload is invalid"
    );
  }
  const sessionRepo = new SessionRepository(options.db, userId);
  const session = sessionRepo.getById(parsed.data.sessionId);
  if (!session) {
    return sessionStartApprovalError(
      "copilot_session_start_invalid",
      "Copilot session start target is not available"
    );
  }
  if (session.status === "running") {
    return sessionStartApprovalError(
      "copilot_session_start_invalid",
      "Copilot session start target is already running"
    );
  }
  if (!options.sessionManager) {
    return sessionStartApprovalError(
      "copilot_session_start_unavailable",
      "Copilot session start is not available"
    );
  }
  const adapter = normalizeAdapter(session.aiTool);
  if (!adapter) {
    return sessionStartApprovalError(
      "copilot_session_start_invalid",
      "Copilot session start adapter is not supported"
    );
  }
  const credentialBoundary = validateCodexTerminalCredentialBoundary({
    adapter,
    credentialMode: session.credentialMode,
    ...(session.apiKeyId ? { apiKeyId: session.apiKeyId } : {}),
    ...(session.modelId ? { modelId: session.modelId } : {})
  });
  if (!credentialBoundary.ok) {
    return sessionStartApprovalError("copilot_session_start_invalid", credentialBoundary.message);
  }
  const launchStatus = await getAdapterLaunchStatus(adapter, options.adapterCommandRunner);
  if (!launchStatus.launchEnabled) {
    return sessionStartApprovalError(
      "copilot_session_start_unavailable",
      `${launchStatus.label} is not available for launch`
    );
  }

  try {
    const pluginDirs = await prepareClaudeLaunchExtras(options.db, userId, adapter, session.workingDir, session.id);
    const launchPlan = createLaunchPlan({
      db: options.db,
      userId,
      masterKey: options.masterKey,
      adapter,
      projectRoot: session.workingDir,
      sessionId: session.id,
      credentialMode: session.credentialMode,
      ...(session.apiKeyId ? { apiKeyId: session.apiKeyId } : {}),
      ...(session.modelId ? { modelId: session.modelId } : {}),
      ...(pluginDirs.length > 0 ? { pluginDirs } : {})
    });
    const attachToken = randomUUID();
    sessionRepo.update(session.id, { attachToken });
    const runtimeSession = await options.sessionManager.createSession({
      userId,
      sessionId: session.id,
      launchPlan,
      attachToken
    });
    const oldStatus = session.status;
    const updated = sessionRepo.update(session.id, {
      status: "running",
      attachToken: runtimeSession.attachToken,
      tmuxSession: runtimeSession.tmuxName,
      lastActive: new Date()
    }) ?? session;
    recordCopilotSessionActivity(options, userId, updated, "session_started", "success", `Session ${updated.name} started`);
    recordSessionSnapshot({
      db: options.db,
      userId,
      session: updated,
      metadata: { reason: "copilot_session_start_approved" }
    });
    options.eventBus?.emitEvent({
      type: "session_status_changed",
      userId,
      sessionId: session.id,
      oldStatus,
      newStatus: "running"
    });
    return { session: toCopilotSessionPayload(updated), executed: true };
  } catch (error) {
    const oldStatus = session.status;
    const message = error instanceof Error ? error.message : "Failed to start session";
    const updated = sessionRepo.update(session.id, {
      status: "error",
      attachToken: "",
      errorMessage: message
    }) ?? session;
    recordCopilotSessionActivity(options, userId, updated, "session_error", "error", message);
    options.eventBus?.emitEvent({
      type: "session_status_changed",
      userId,
      sessionId: session.id,
      oldStatus,
      newStatus: "error"
    });
    return sessionStartApprovalError("copilot_session_start_failed", message);
  }
}

function sessionStartApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

async function approveCopilotSessionStop(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = sessionStopApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return sessionStopApprovalError(
      "copilot_session_stop_invalid",
      "Copilot session stop payload is invalid"
    );
  }
  const sessionRepo = new SessionRepository(options.db, userId);
  const session = sessionRepo.getById(parsed.data.sessionId);
  if (!session || session.status !== "running" || !session.tmuxSession) {
    return sessionStopApprovalError(
      "copilot_session_stop_invalid",
      "Copilot session stop target is not a running terminal session"
    );
  }
  if (!options.sessionManager) {
    return sessionStopApprovalError(
      "copilot_session_stop_unavailable",
      "Copilot session stop is not available"
    );
  }

  try {
    await options.sessionManager.stopSession(session.id, session.tmuxSession, userId);
    const oldStatus = session.status;
    const updated = sessionRepo.update(session.id, {
      status: "stopped",
      attachToken: "",
      tmuxSession: null,
      lastActive: new Date()
    }) ?? session;
    recordCopilotSessionActivity(options, userId, updated, "session_stopped", "success", `Session ${session.name} stopped`);
    options.eventBus?.emitEvent({
      type: "session_status_changed",
      userId,
      sessionId: session.id,
      oldStatus,
      newStatus: "stopped"
    });
    return { session: toCopilotSessionPayload(updated), executed: true };
  } catch (error) {
    const oldStatus = session.status;
    const message = error instanceof Error ? error.message : "Failed to stop session";
    const updated = sessionRepo.update(session.id, {
      status: "error",
      errorMessage: message
    }) ?? session;
    recordCopilotSessionActivity(options, userId, updated, "session_error", "error", message);
    options.eventBus?.emitEvent({
      type: "session_status_changed",
      userId,
      sessionId: session.id,
      oldStatus,
      newStatus: "error"
    });
    return sessionStopApprovalError("copilot_session_stop_failed", message);
  }
}

function sessionStopApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

async function approveCopilotSessionDelete(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = sessionDeleteApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return sessionDeleteApprovalError(
      "copilot_session_delete_invalid",
      "Copilot session delete payload is invalid"
    );
  }
  const sessionRepo = new SessionRepository(options.db, userId);
  const session = sessionRepo.getById(parsed.data.sessionId);
  if (!session) {
    return sessionDeleteApprovalError(
      "copilot_session_delete_invalid",
      "Copilot session delete target is not available"
    );
  }

  try {
    let stopped = false;
    if (session.status === "running") {
      if (!options.sessionManager) {
        return sessionDeleteApprovalError(
          "copilot_session_delete_failed",
          "Copilot session delete cannot stop the running terminal session"
        );
      }
      try {
        await options.sessionManager.stopSession(session.id, session.tmuxSession ?? undefined, userId);
        stopped = true;
      } catch {
        // Match the session delete route: a stale tmux reference should not block deleting the DB record.
      }
    }
    recordCopilotSessionActivity(
      options,
      userId,
      session,
      "session_deleted",
      "warning",
      `Session ${session.name} deleted`
    );
    sessionRepo.delete(session.id);
    options.eventBus?.emitEvent({
      type: "session_deleted",
      userId,
      sessionId: session.id
    });
    return {
      session: toCopilotSessionPayload(session),
      stopped,
      executed: true
    };
  } catch (error) {
    return sessionDeleteApprovalError(
      "copilot_session_delete_failed",
      error instanceof Error ? error.message : "Failed to delete session"
    );
  }
}

function sessionDeleteApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

function approveCopilotAgentCreate(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = agentCreateApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return agentApprovalError("copilot_agent_create_invalid", "Copilot agent create payload is invalid");
  }
  try {
    const agent = new AgentRepository(options.db, userId).create(parsed.data);
    return {
      agent: toCopilotAgentPayload(agent),
      executed: true
    };
  } catch (error) {
    return agentApprovalError(
      isAgentReferenceError(error) ? "copilot_agent_create_invalid" : "copilot_agent_create_failed",
      error instanceof Error ? error.message : "Failed to create agent"
    );
  }
}

function approveCopilotAgentUpdate(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = agentUpdateApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return agentApprovalError("copilot_agent_update_invalid", "Copilot agent update payload is invalid");
  }
  const { agentId, reason: _reason, ...updateInput } = parsed.data;
  try {
    const agent = new AgentRepository(options.db, userId).update(agentId, updateInput);
    if (!agent) {
      return agentApprovalError("copilot_agent_update_invalid", "Copilot agent update target is not available");
    }
    return {
      agent: toCopilotAgentPayload(agent),
      executed: true
    };
  } catch (error) {
    return agentApprovalError(
      isAgentReferenceError(error) ? "copilot_agent_update_invalid" : "copilot_agent_update_failed",
      error instanceof Error ? error.message : "Failed to update agent"
    );
  }
}

function approveCopilotAgentDelete(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = agentDeleteApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return agentApprovalError("copilot_agent_delete_invalid", "Copilot agent delete payload is invalid");
  }
  const repo = new AgentRepository(options.db, userId);
  const agent = repo.getById(parsed.data.agentId);
  if (!agent) {
    return agentApprovalError("copilot_agent_delete_invalid", "Copilot agent delete target is not available");
  }
  try {
    repo.delete(agent.id);
    return {
      agent: toCopilotAgentPayload(agent),
      executed: true
    };
  } catch (error) {
    return agentApprovalError(
      "copilot_agent_delete_failed",
      error instanceof Error ? error.message : "Failed to delete agent"
    );
  }
}

function agentApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

function isAgentReferenceError(error: unknown): boolean {
  return error instanceof Error && (error.message === "Project not found" || error.message === "Model not found");
}

function approveCopilotTemplateCreate(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = templateCreateApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return templateApprovalError("copilot_template_create_invalid", "Copilot template create payload is invalid");
  }
  try {
    const repo = new TemplateRepository(options.db, userId);
    const created = repo.create(parsed.data);
    const template = repo.getById(created.id) ?? created;
    return {
      template: toCopilotTemplatePayload(template),
      executed: true
    };
  } catch (error) {
    return templateApprovalError(
      "copilot_template_create_failed",
      error instanceof Error ? error.message : "Failed to create template"
    );
  }
}

function approveCopilotTemplateUpdate(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = templateUpdateApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return templateApprovalError("copilot_template_update_invalid", "Copilot template update payload is invalid");
  }
  const repo = new TemplateRepository(options.db, userId);
  const existing = repo.getById(parsed.data.templateId);
  if (!existing || existing.isBuiltin) {
    return templateApprovalError(
      "copilot_template_update_invalid",
      "Copilot template update target is not an editable custom template"
    );
  }
  const { templateId, reason: _reason, ...updateInput } = parsed.data;
  try {
    const updated = repo.update(templateId, updateInput);
    if (!updated) {
      return templateApprovalError("copilot_template_update_failed", "Failed to update template");
    }
    return {
      template: toCopilotTemplatePayload(repo.getById(updated.id) ?? updated),
      executed: true
    };
  } catch (error) {
    return templateApprovalError(
      "copilot_template_update_failed",
      error instanceof Error ? error.message : "Failed to update template"
    );
  }
}

function approveCopilotTemplateDelete(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = templateDeleteApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return templateApprovalError("copilot_template_delete_invalid", "Copilot template delete payload is invalid");
  }
  const repo = new TemplateRepository(options.db, userId);
  const template = repo.getById(parsed.data.templateId);
  if (!template || template.isBuiltin) {
    return templateApprovalError(
      "copilot_template_delete_invalid",
      "Copilot template delete target is not an editable custom template"
    );
  }
  try {
    if (!repo.delete(template.id)) {
      return templateApprovalError("copilot_template_delete_failed", "Failed to delete template");
    }
    return {
      template: toCopilotTemplatePayload(template),
      executed: true
    };
  } catch (error) {
    return templateApprovalError(
      "copilot_template_delete_failed",
      error instanceof Error ? error.message : "Failed to delete template"
    );
  }
}

function templateApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

function approveCopilotSkillToggle(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = skillToggleApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return skillToggleApprovalError(
      "copilot_skill_toggle_invalid",
      "Copilot skill toggle payload is invalid"
    );
  }
  const repo = new SkillRepository(options.db, userId);
  const skill = repo.getById(parsed.data.skillId);
  if (!skill) {
    return skillToggleApprovalError(
      "copilot_skill_toggle_invalid",
      "Copilot skill toggle target is not available"
    );
  }
  const updated = repo.toggle(skill.id, parsed.data.enabled);
  if (!updated) {
    return skillToggleApprovalError(
      "copilot_skill_toggle_failed",
      "Failed to update skill state"
    );
  }
  return {
    skill: toCopilotSkillPayload(updated),
    executed: true
  };
}

function skillToggleApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

function approveCopilotPluginToggle(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = pluginToggleApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return pluginToggleApprovalError(
      "copilot_plugin_toggle_invalid",
      "Copilot plugin toggle payload is invalid"
    );
  }
  const repo = new PluginRepository(options.db, userId);
  const plugin = repo.getByPluginId(parsed.data.pluginId);
  if (!plugin) {
    return pluginToggleApprovalError(
      "copilot_plugin_toggle_invalid",
      "Copilot plugin toggle target is not available"
    );
  }
  const updated = repo.setEnabled(plugin.id, parsed.data.enabled);
  if (!updated) {
    return pluginToggleApprovalError(
      "copilot_plugin_toggle_failed",
      "Failed to update plugin state"
    );
  }
  return {
    plugin: toCopilotPluginPayload(updated),
    executed: true
  };
}

function pluginToggleApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

function approveCopilotProjectSkillToggle(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = projectSkillToggleApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return projectSkillToggleApprovalError(
      "copilot_project_skill_toggle_invalid",
      "Copilot project skill toggle payload is invalid"
    );
  }
  const project = new ProjectRepository(options.db, userId).getById(parsed.data.projectId);
  if (!project) {
    return projectSkillToggleApprovalError(
      "copilot_project_skill_toggle_invalid",
      "Copilot project skill toggle project is not available"
    );
  }
  const skill = new SkillRepository(options.db, userId).getById(parsed.data.skillId);
  if (!skill) {
    return projectSkillToggleApprovalError(
      "copilot_project_skill_toggle_invalid",
      "Copilot project skill toggle skill is not available"
    );
  }
  const projectSkill = new ProjectSkillRepository(options.db, userId)
    .setSkill(project.id, skill.id, parsed.data.enabled);
  if (!projectSkill) {
    return projectSkillToggleApprovalError(
      "copilot_project_skill_toggle_failed",
      "Failed to update project skill state"
    );
  }
  return {
    project: toCopilotProjectPayload(project),
    skill: toCopilotSkillPayload(skill),
    projectSkill,
    executed: true
  };
}

function projectSkillToggleApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

function toCopilotSkillPayload(skill: Skill): Omit<Skill, "content"> & { contentPreview: string } {
  const { content: _content, ...safe } = skill;
  return {
    ...safe,
    contentPreview: sanitizeCopilotAssistantText(skill.content).slice(0, 1_000)
  };
}

function toCopilotPluginPayload(plugin: PluginSummary): Omit<PluginSummary, "skills"> & { skillCount: number } {
  const { skills: _skills, ...safe } = plugin;
  return {
    ...safe,
    skillCount: plugin.skills.length
  };
}

function toCopilotAgentPayload(agent: Agent): Omit<Agent, "customPrompt"> & { customPromptPreview: string | null } {
  const { customPrompt: _customPrompt, ...safe } = agent;
  return {
    ...safe,
    customPromptPreview: agent.customPrompt
      ? sanitizeCopilotAssistantText(agent.customPrompt).slice(0, 1_000)
      : null
  };
}

function toCopilotTemplatePayload(
  template: Template & { files?: TemplateFile[] }
): Omit<Template, "userId"> & { fileCount: number; filePaths: string[] } {
  const { userId: _userId, files: _files, ...safe } = template;
  const files = Array.isArray(template.files) ? template.files : [];
  return {
    ...safe,
    fileCount: files.length,
    filePaths: files.map((file) => file.filePath).slice(0, 20)
  };
}

function approveCopilotModelSelection(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  const parsed = copilotModelSelectionApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return copilotModelSelectionApprovalError(
      "copilot_model_selection_invalid",
      "Copilot model selection payload is invalid"
    );
  }
  const repo = new ModelProviderRepository(options.db, userId, options.masterKey);
  const target = getCopilotModelSelectionTarget(repo, parsed.data.providerProfileId, parsed.data.modelProfileId);
  if (!target.ok) {
    return copilotModelSelectionApprovalError(target.code, target.message);
  }
  const applied = repo.setDefaultModel(target.model.id);
  if (!applied) {
    return copilotModelSelectionApprovalError(
      "copilot_model_selection_failed",
      "Failed to set Copilot default model"
    );
  }
  return {
    selection: toCopilotModelSelectionPayload(target.provider, applied),
    executed: true
  };
}

function getCopilotModelSelectionTarget(
  repo: ModelProviderRepository,
  providerProfileId: string,
  modelProfileId: string
): (
  { ok: true; provider: ProviderProfile; model: ModelProfile } |
  { ok: false; code: string; message: string }
) {
  const provider = repo.getProviderProfile(providerProfileId);
  if (!provider || provider.status !== "active") {
    return {
      ok: false,
      code: "copilot_model_selection_invalid",
      message: "Copilot model selection provider is not available"
    };
  }
  const model = repo.getModelProfile(modelProfileId);
  if (!model || model.providerProfileId !== provider.id || model.status !== "active") {
    return {
      ok: false,
      code: "copilot_model_selection_invalid",
      message: "Copilot model selection model is not available"
    };
  }
  if (!isCopilotModelSelectionFormatSupported(provider.apiFormat)) {
    return {
      ok: false,
      code: "copilot_model_selection_unavailable",
      message: "Copilot model selection provider format is not supported"
    };
  }
  const hasCredential = provider.authType === "none" ||
    repo.listCredentials(provider.id).some((credential) => credential.status === "active");
  if (!hasCredential) {
    return {
      ok: false,
      code: "copilot_model_selection_unavailable",
      message: "Copilot model selection provider has no active credential"
    };
  }
  return { ok: true, provider, model };
}

function isCopilotModelSelectionFormatSupported(apiFormat: string): boolean {
  return apiFormat === "openai" || apiFormat === "openai-compatible" || apiFormat === "anthropic";
}

function toCopilotModelSelectionPayload(provider: ProviderProfile, model: ModelProfile) {
  return {
    providerProfileId: provider.id,
    providerName: provider.name,
    providerKey: provider.providerKey,
    modelProfileId: model.id,
    modelName: model.name,
    modelId: model.modelId,
    apiFormat: provider.apiFormat
  };
}

function copilotModelSelectionApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

async function approveCopilotModelProviderSync(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = modelProviderSyncApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return modelProviderSyncApprovalError(
      "copilot_model_provider_sync_invalid",
      "Copilot model provider sync payload is invalid"
    );
  }
  const repo = new ModelProviderRepository(options.db, userId, options.masterKey);
  const target = getModelProviderSyncApprovalTarget(repo, parsed.data);
  if (!target.ok) {
    return modelProviderSyncApprovalError(target.code, target.message);
  }

  try {
    const catalog = await (options.loadProviderCatalog ?? loadProviderCatalogFromSource)();
    const catalogPreset = catalog.find((preset) => preset.id === target.provider.providerKey);
    const fetchedModels = await (options.fetchProviderModels ?? fetchProviderModelsFromEndpoint)({
      baseUrl: target.modelFetchBaseUrl,
      ...(target.credential ? { apiKey: repo.decryptCredential(target.credential.id) } : {}),
      ...(catalogPreset?.modelFetch?.modelsUrl ? { modelsUrl: catalogPreset.modelFetch.modelsUrl } : {}),
      ...(parsed.data.timeoutMs ? { timeoutMs: parsed.data.timeoutMs } : {})
    });
    const createdModels = syncModelProviderFetchedModels(repo, target.provider, fetchedModels);
    recordActivity({
      db: options.db,
      eventBus: options.eventBus,
      userId,
      type: "config_sync",
      status: "success",
      message: `Models synced for ${target.provider.name}`,
      metadata: {
        source: "copilot",
        providerProfileId: target.provider.id,
        fetchedCount: fetchedModels.length,
        createdCount: createdModels.length
      }
    });
    new AuditLogRepository(options.db, userId).create({
      action: "model_provider.models_sync",
      resourceType: "model_provider",
      resourceId: target.provider.id,
      details: {
        source: "copilot",
        fetchedCount: fetchedModels.length,
        createdCount: createdModels.length
      }
    });
    return {
      provider: toModelProviderSyncPayload(target.provider),
      fetchedCount: fetchedModels.length,
      createdCount: createdModels.length,
      models: createdModels.map((model) => ({
        id: model.id,
        name: model.name,
        modelId: model.modelId,
        isDefault: model.isDefault
      })),
      executed: true
    };
  } catch (error) {
    return modelProviderSyncApprovalError(
      "copilot_model_provider_sync_failed",
      error instanceof Error ? error.message : "Failed to sync provider models"
    );
  }
}

function getModelProviderSyncApprovalTarget(
  repo: ModelProviderRepository,
  input: z.infer<typeof modelProviderSyncApprovalSchema>
): (
  {
    ok: true;
    provider: ProviderProfile;
    credential?: { id: string; providerProfileId: string; status: string } | undefined;
    modelFetchBaseUrl: string;
  } |
  { ok: false; code: string; message: string }
) {
  const provider = repo.getProviderProfile(input.providerProfileId);
  if (!provider || provider.status !== "active") {
    return {
      ok: false,
      code: "copilot_model_provider_sync_invalid",
      message: "Copilot model provider sync provider is not available"
    };
  }
  const modelFetchBaseUrl = provider.openaiBaseUrl ?? provider.baseUrl;
  if (!modelFetchBaseUrl) {
    return {
      ok: false,
      code: "copilot_model_provider_sync_unavailable",
      message: "Copilot model provider sync requires a provider base URL"
    };
  }
  const credential = selectProviderApplyCredential(repo, provider.id, input.credentialId);
  if (provider.authType !== "none" && !credential) {
    return {
      ok: false,
      code: "copilot_model_provider_sync_unavailable",
      message: "Copilot model provider sync provider has no active credential"
    };
  }
  return { ok: true, provider, modelFetchBaseUrl, ...(credential ? { credential } : {}) };
}

function syncModelProviderFetchedModels(
  repo: ModelProviderRepository,
  provider: ProviderProfile,
  fetchedModels: FetchedProviderModel[]
): ModelProfile[] {
  const existing = new Set(repo.listModelProfiles(provider.id).map((model) => model.modelId));
  const created: ModelProfile[] = [];
  for (const fetched of fetchedModels) {
    if (existing.has(fetched.id)) continue;
    const model = repo.createModelProfile({
      providerProfileId: provider.id,
      name: fetched.id,
      modelId: fetched.id,
      capabilities: ["chat"],
      isDefault: existing.size === 0 && created.length === 0
    });
    existing.add(fetched.id);
    created.push(model);
  }
  return created;
}

function toModelProviderSyncPayload(provider: ProviderProfile) {
  return {
    id: provider.id,
    name: provider.name,
    providerKey: provider.providerKey,
    apiFormat: provider.apiFormat
  };
}

function modelProviderSyncApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

async function approveCopilotModelProviderApply(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  const parsed = modelProviderApplyApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return modelProviderApplyApprovalError(
      "copilot_model_provider_apply_invalid",
      "Copilot model provider apply payload is invalid"
    );
  }
  const repo = new ModelProviderRepository(options.db, userId, options.masterKey);
  const target = getModelProviderApplyApprovalTarget(repo, options.db, userId, parsed.data);
  if (!target.ok) {
    return modelProviderApplyApprovalError(target.code, target.message);
  }
  if (parsed.data.adapter === "openforge-copilot") {
    const applied = repo.setDefaultModel(target.model.id);
    if (!applied) {
      return modelProviderApplyApprovalError(
        "copilot_model_provider_apply_failed",
        "Failed to set OpenForge Copilot default model"
      );
    }
    return {
      adapter: "openforge-copilot",
      internalDefault: toCopilotModelSelectionPayload(target.provider, applied),
      changedFiles: [],
      secretEnvNames: [],
      executed: true
    };
  }
  const project = target.project;
  if (!project) {
    return modelProviderApplyApprovalError(
      "copilot_model_provider_apply_invalid",
      "Copilot model provider apply target project is not available"
    );
  }

  try {
    const result = await applyModelProviderConfig({
      projectRoot: project.path,
      adapter: parsed.data.adapter,
      provider: {
        id: target.provider.id,
        providerKey: target.provider.providerKey,
        baseUrl: target.provider.baseUrl,
        anthropicBaseUrl: target.provider.anthropicBaseUrl,
        openaiBaseUrl: target.provider.openaiBaseUrl,
        authType: target.provider.authType,
        apiFormat: target.provider.apiFormat,
        opencodeNpm: target.provider.opencodeNpm
      },
      model: {
        id: target.model.id,
        modelId: target.model.modelId
      },
      ...(target.credential ? {
        credential: {
          id: target.credential.id,
          envName: envNameForProviderApply(target.provider.providerKey, parsed.data.adapter)
        }
      } : {})
    });
    recordActivity({
      db: options.db,
      eventBus: options.eventBus,
      userId,
      projectId: project.id,
      type: "config_sync",
      status: "success",
      message: `Model provider applied to ${project.name}`,
      metadata: {
        source: "copilot",
        adapter: parsed.data.adapter,
        providerProfileId: target.provider.id,
        modelProfileId: target.model.id,
        changedFiles: result.changedFiles.map((file) => file.relativePath)
      }
    });
    new AuditLogRepository(options.db, userId).create({
      action: "model_provider.apply",
      resourceType: "project",
      resourceId: project.id,
      details: {
        source: "copilot",
        adapter: parsed.data.adapter,
        providerProfileId: target.provider.id,
        modelProfileId: target.model.id,
        changedFiles: result.changedFiles.length
      }
    });
    return {
      ...result,
      projectId: project.id,
      providerProfileId: target.provider.id,
      modelProfileId: target.model.id,
      executed: true
    };
  } catch (error) {
    return modelProviderApplyApprovalError(
      "copilot_model_provider_apply_failed",
      error instanceof Error ? error.message : "Failed to apply model provider config"
    );
  }
}

function getModelProviderApplyApprovalTarget(
  repo: ModelProviderRepository,
  db: Database,
  userId: string,
  input: z.infer<typeof modelProviderApplyApprovalSchema>
): (
  { ok: true; provider: ProviderProfile; model: ModelProfile; credential?: { id: string; providerProfileId: string; status: string } | undefined; project?: Project | undefined } |
  { ok: false; code: string; message: string }
) {
  const provider = repo.getProviderProfile(input.providerProfileId);
  if (!provider || provider.status !== "active") {
    return {
      ok: false,
      code: "copilot_model_provider_apply_invalid",
      message: "Copilot model provider apply provider is not available"
    };
  }
  if (input.adapter !== "openforge-copilot" && !provider.supportedAdapters.includes(input.adapter)) {
    return {
      ok: false,
      code: "copilot_model_provider_apply_unavailable",
      message: "Provider does not support the selected adapter"
    };
  }
  if (input.adapter === "openforge-copilot" && !isCopilotModelSelectionFormatSupported(provider.apiFormat)) {
    return {
      ok: false,
      code: "copilot_model_provider_apply_unavailable",
      message: "Provider does not support OpenForge Copilot"
    };
  }
  const model = selectProviderApplyModel(repo, provider.id, input.modelProfileId);
  if (!model) {
    return {
      ok: false,
      code: "copilot_model_provider_apply_invalid",
      message: "Copilot model provider apply model is not available"
    };
  }
  const credential = selectProviderApplyCredential(repo, provider.id, input.credentialId);
  if (provider.authType !== "none" && !credential) {
    return {
      ok: false,
      code: "copilot_model_provider_apply_unavailable",
      message: "Copilot model provider apply provider has no active credential"
    };
  }
  if (input.adapter === "openforge-copilot") {
    return { ok: true, provider, model, ...(credential ? { credential } : {}) };
  }
  if (!input.projectId) {
    return {
      ok: false,
      code: "copilot_model_provider_apply_invalid",
      message: "Copilot model provider apply requires a target project"
    };
  }
  const project = new ProjectRepository(db, userId).getById(input.projectId);
  if (!project) {
    return {
      ok: false,
      code: "copilot_model_provider_apply_invalid",
      message: "Copilot model provider apply project is not available"
    };
  }
  return { ok: true, provider, model, ...(credential ? { credential } : {}), project };
}

function selectProviderApplyModel(
  repo: ModelProviderRepository,
  providerId: string,
  modelProfileId: string | undefined
): ModelProfile | undefined {
  if (modelProfileId) {
    const model = repo.getModelProfile(modelProfileId);
    return model?.providerProfileId === providerId && model.status === "active" ? model : undefined;
  }
  return repo.listModelProfiles(providerId).find((model) => model.status === "active");
}

function selectProviderApplyCredential(
  repo: ModelProviderRepository,
  providerId: string,
  credentialId: string | undefined
): { id: string; providerProfileId: string; status: string } | undefined {
  if (credentialId) {
    const credential = repo.getCredential(credentialId);
    return credential?.providerProfileId === providerId && credential.status === "active" ? credential : undefined;
  }
  return repo.listCredentials(providerId).find((credential) => credential.status === "active");
}

function envNameForProviderApply(providerKey: string, adapter: "claude" | "opencode"): string {
  if (adapter === "claude") return "ANTHROPIC_AUTH_TOKEN";
  const normalized = providerKey.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (normalized === "ANTHROPIC") return "ANTHROPIC_API_KEY";
  if (normalized === "OPENAI") return "OPENAI_API_KEY";
  return `${normalized}_API_KEY`;
}

function modelProviderApplyApprovalError(code: string, message: string): Record<string, unknown> {
  return {
    error: { code, message }
  };
}

function buildApprovedSessionInput(input: string, submit: boolean): string {
  if (!submit || input.endsWith("\n") || input.endsWith("\r")) {
    return input;
  }
  return `${input}\n`;
}

function approveCopilotTroubleshootingSteps(action: CopilotPendingAction): Record<string, unknown> {
  const parsed = troubleshootingStepsApprovalSchema.safeParse(action.input);
  if (!parsed.success) {
    return {
      error: {
        code: "copilot_troubleshooting_steps_invalid",
        message: "Copilot troubleshooting steps payload is invalid"
      }
    };
  }
  return { steps: parsed.data, executed: false };
}

function isApprovalError(result: Record<string, unknown>): result is { error: { code: string; message: string } } {
  const error = result.error;
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
