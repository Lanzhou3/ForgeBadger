/**
 * Per-user agent stack factory for the Copilot harness.
 *
 * Builds the log, memory, LLM client, tool registry, and orchestrator for one
 * user. Shared by the HTTP routes (a turn per request) and the reactive loop
 * (a proactive turn per platform event) so there is a single construction path
 * and every entry point is scoped by user_id.
 */
import type { Database } from "../../db/types.js";
import type { OpenForgeEventBus } from "../event-bus.js";
import { ModelProviderRepository } from "../../db/repositories/model-provider-repository.js";
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
  eventBus: OpenForgeEventBus;
  portfolioApi?: PortfolioApiFacade | undefined;
  /**
   * M3: present when OPENFORGE_DSH_COPILOT_ENABLED=1. Proactive (reactive-loop)
   * and Feishu-channel turns then run on the dsh kernel BFF instead of the
   * in-process orchestrator, with the same run/pending-action contract.
   */
  dshBff?: DshCopilotBff | undefined;
  /** Test-only fetch override; production callers omit it. */
  llmFetch?: typeof fetch;
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
  const orchestrator = createCopilotOrchestrator({
    db: deps.db,
    masterKey: deps.masterKey,
    toolRegistry,
    llm,
    eventBus: deps.eventBus,
    ...(deps.portfolioApi !== undefined ? { portfolioApi: deps.portfolioApi } : {})
  });
  return { log, memory, orchestrator, toolRegistry };
}
