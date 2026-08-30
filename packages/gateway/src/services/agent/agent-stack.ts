/**
 * Per-user agent stack factory for the Copilot harness.
 *
 * Builds the log, memory, LLM client, tool registry, and orchestrator for one
 * user. Shared by the HTTP routes (a turn per request) and the reactive loop
 * (a proactive turn per platform event) so there is a single construction path
 * and every entry point is scoped by user_id.
 */
import type { Database } from "../../db/types.js";
import type { ForgeBadgerEventBus } from "../event-bus.js";
import type { CommandRunner } from "../../lib/dependency-check.js";
import type { InMemorySessionManager } from "../session-manager.js";
import { ModelProviderRepository } from "../../db/repositories/model-provider-repository.js";
import { CopilotToolPreferenceRepository } from "../../db/repositories/copilot-tool-preference-repository.js";
import { CopilotConversationLog } from "./conversation-log.js";
import { AgentMemoryRepository } from "./memory.js";
import { createAgentLlmClient } from "./llm-client.js";
import { createAgentToolRegistry, type AgentToolRegistry } from "./tool-registry.js";
import { createPlatformTools } from "./tools/index.js";
import { createCopilotOrchestrator } from "./orchestrator.js";
import type { PortfolioApiFacade } from "../portfolio/portfolio-api-service.js";
import type { DshCopilotBff } from "../dsh-copilot/bff-service.js";

export interface AgentStackDeps {
  db: Database;
  masterKey: string;
  eventBus: ForgeBadgerEventBus;
  portfolioApi?: PortfolioApiFacade | undefined;
  /**
   * M3: present when FORGEBADGER_DSH_COPILOT_ENABLED=1. Proactive (reactive-loop)
   * and Feishu-channel turns then run on the dsh kernel BFF instead of the
   * in-process orchestrator, with the same run/pending-action contract.
   */
  dshBff?: DshCopilotBff | undefined;
  /** Test-only fetch override; production callers omit it. */
  llmFetch?: typeof fetch;
  /**
   * Runtime seams for tools that act on live sessions (output tail reading,
   * task-packet start/dispatch). Optional: read-only stacks may omit them.
   */
  sessionManager?: InMemorySessionManager | undefined;
  adapterCommandRunner?: CommandRunner | undefined;
}

export interface AgentStack {
  log: CopilotConversationLog;
  memory: AgentMemoryRepository;
  orchestrator: ReturnType<typeof createCopilotOrchestrator>;
  toolRegistry: AgentToolRegistry;
}

export function buildAgentStack(deps: AgentStackDeps, userId: string): AgentStack {
  const log = new CopilotConversationLog(deps.db, userId);
  const memory = new AgentMemoryRepository(deps.db, userId);
  const modelRepo = new ModelProviderRepository(deps.db, userId, deps.masterKey);
  const llm = createAgentLlmClient({
    modelProviderRepository: modelRepo,
    ...(deps.llmFetch !== undefined ? { fetchImpl: deps.llmFetch } : {})
  });
  const toolRegistry = createAgentToolRegistry(createPlatformTools());
  // Owner tool switches: disabled tools vanish from the model schema and are
  // refused at execution time (see orchestrator).
  const toolPreferences = new CopilotToolPreferenceRepository(deps.db, userId);
  const orchestrator = createCopilotOrchestrator({
    db: deps.db,
    masterKey: deps.masterKey,
    toolRegistry,
    llm,
    eventBus: deps.eventBus,
    isToolDisabled: (toolName) => !toolPreferences.isEnabled(toolName),
    ...(deps.sessionManager !== undefined ? { sessionManager: deps.sessionManager } : {}),
    ...(deps.adapterCommandRunner !== undefined ? { adapterCommandRunner: deps.adapterCommandRunner } : {}),
    ...(deps.portfolioApi !== undefined ? { portfolioApi: deps.portfolioApi } : {})
  });
  return { log, memory, orchestrator, toolRegistry };
}
