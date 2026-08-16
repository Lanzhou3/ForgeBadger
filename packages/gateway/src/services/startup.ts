import { createHmac } from "node:crypto";

import type { Database } from "../db/types.js";
import { PortfolioRepository, type PortfolioWorkerSignal } from "../db/repositories/portfolio-repository.js";
import { createPortfolioSchedulerRepositoryFactory } from "../db/repositories/portfolio-scheduler-repository.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import type { GatewayEnv } from "../config/env.js";
import { initializeDatabase } from "../db/client.js";
import { InMemoryApiKeyStore } from "../secrets/api-key-store.js";
import { InMemorySessionManager } from "./session-manager.js";
import { createDbSessionRecoveryStore } from "./db-session-recovery-store.js";
import { createTmuxClient, type TmuxClient } from "./tmux.js";
import { OpenForgeEventBus } from "./event-bus.js";
import {
  ClaudePortfolioWorker,
  InMemoryVerifiedWorkerCapabilityRegistry
} from "./portfolio/claude-portfolio-worker.js";
import { PortfolioSessionInputGate } from "./portfolio/session-input-gate.js";
import { createWorkerSignalService } from "./portfolio/worker-signal-service.js";
import { createExecutionService, type PreparedDispatch } from "./portfolio/execution-service.js";
import { createAuthorizationPolicy } from "./portfolio/authorization-policy.js";
import { createPlatformToolManifestService } from "./portfolio/platform-tool-manifest.js";
import { createTaskPacketService } from "./portfolio/task-packet-service.js";
import { NodeFixedGitExecutor } from "./portfolio/git-state-probe.js";
import {
  OperationsRuntime,
  type OperationsRuntimeFactory,
  type OperationsRuntimeDependencies,
  type OperationsRuntimeLifecycle
} from "./portfolio/operations-runtime.js";
import { ApprovedProjectRootValidator } from "./portfolio/observation-root-validator.js";
import { provisionActiveObservationProfiles } from "./portfolio/observation-profile-provisioning.js";
import { getAdapterLaunchStatus } from "./adapter-discovery.js";
import { createProductionFeishuChannelRuntime } from "./integrations/feishu-runtime-factory.js";
import type { FeishuChannelRuntime } from "./integrations/feishu-channel-runtime.js";
import {
  prepareClaudePortfolioWorkerLaunch,
  type ClaudePortfolioWorkerLaunchConfiguration
} from "./session-launch-plan.js";

export interface StartupResult {
  db: Database;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: OpenForgeEventBus;
  feishuChannelRuntime: FeishuChannelRuntime;
  claudePortfolioWorker: ClaudePortfolioWorker;
  portfolioExecution: PortfolioExecutionRuntime;
  operationsRuntime: OperationsRuntimeLifecycle;
}

type PortfolioRuntimeWorkerSignals = Omit<
  ReturnType<typeof createWorkerSignalService>,
  "deriveSessionStartCapabilityForForwarder" | "prepareWorkerLaunch"
> & {
  listWorkerSignalsForAttempt(attemptId: string): PortfolioWorkerSignal[];
};

interface PortfolioRuntimeWorkerSignalFactory {
  forUser(userId: string): PortfolioRuntimeWorkerSignals;
}

type CoreExecutionService = ReturnType<typeof createExecutionService>;

/** Private startup composition; it is intentionally not mounted as an HTTP API. */
export interface PortfolioExecutionRuntime {
  forUser(userId: string): CoreExecutionService;
}

export async function startupGateway(options: {
  env: GatewayEnv;
  tmuxClient?: TmuxClient;
  operationsRuntimeFactory?: OperationsRuntimeFactory;
}): Promise<StartupResult> {
  // 1. Validate env (already done by loadEnv)
  // 2. Initialize database
  const db = initializeDatabase(options.env.OPENFORGE_DB_PATH);

  // 3. Create API key store
  const apiKeyStore = new InMemoryApiKeyStore({
    masterKey: options.env.OPENFORGE_MASTER_KEY
  });

  // 4. Create event bus
  const eventBus = new OpenForgeEventBus();

  // 5. Build the Portfolio writer fence before any Gateway-owned terminal exists.
  const portfolioRuntime = createPortfolioRuntimeBoundary(db, options.env.OPENFORGE_MASTER_KEY);
  const sessionManager = new InMemorySessionManager(
    options.tmuxClient ?? createTmuxClient(),
    createDbSessionRecoveryStore(db, options.env.OPENFORGE_MASTER_KEY),
    eventBus,
    {
      tmuxPrefix: options.env.OPENFORGE_TMUX_PREFIX,
      sessionInputGate: portfolioRuntime.sessionInputGate
    }
  );
  // This registry is populated only after the dedicated worker hook's durable
  // ACK succeeds. The worker remains unverified_no_input unless a future
  // internal runner explicitly opts into verified_input.
  const verifiedWorkerCapabilities = new InMemoryVerifiedWorkerCapabilityRegistry();
  const claudePortfolioWorker = new ClaudePortfolioWorker({
    assignmentLookup: portfolioRuntime.assignmentLookup,
    workerSignals: portfolioRuntime.workerSignals,
    sessionInputGate: portfolioRuntime.sessionInputGate,
    sessionManager,
    verifiedWorkerCapabilityProvider: verifiedWorkerCapabilities
  });
  const portfolioExecution = portfolioRuntime.createExecutionRuntime({
    sessionManager,
    masterKey: options.env.OPENFORGE_MASTER_KEY
  });

  // 6. Recover sessions + kill orphans
  await sessionManager
    .recoverOpenForgeSessions({
      userId: "system",
      cwd: process.cwd()
    })
    .catch((err) => {
      console.error(
        JSON.stringify({
          level: "error",
          action: "gateway.recover_sessions_failed",
          message: err.message
        })
      );
    });

  // Startup is the only production profile provisioner. It validates the
  // project-owned path before persisting an identity; no route exposes roots.
  const projectRootValidator = new ApprovedProjectRootValidator();
  provisionActiveObservationProfiles({ db, projectRootValidator });

  // The read-only reconciler starts only after database and session recovery.
  // It receives no terminal, worker, model, connector, event, or dispatch port.
  const operationsRuntimeDependencies: OperationsRuntimeDependencies = {
    clock: { now: () => new Date() },
    timer: { setInterval: (callback, ms) => setInterval(callback, ms), clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout) },
    schedulerFactory: createPortfolioSchedulerRepositoryFactory(db),
    portfolioFactory: { forUser: (userId) => new PortfolioRepository(db, userId) },
    observationPorts: { projectRootValidator, gitExecutor: new NodeFixedGitExecutor() }
  };
  const operationsRuntime = options.operationsRuntimeFactory?.(operationsRuntimeDependencies)
    ?? new OperationsRuntime(operationsRuntimeDependencies);
  await operationsRuntime.start();

  // Feishu connection failures are isolated from HTTP readiness and retried by the supervisor.
  const feishuChannelRuntime = createProductionFeishuChannelRuntime({
    db,
    masterKey: options.env.OPENFORGE_MASTER_KEY
  });
  await feishuChannelRuntime.start();

  return {
    db,
    sessionManager,
    apiKeyStore,
    eventBus,
    feishuChannelRuntime,
    claudePortfolioWorker,
    portfolioExecution,
    operationsRuntime
  };
}

function createPortfolioRuntimeBoundary(db: Database, masterKey: string) {
  const capabilitySecret = createHmac("sha256", masterKey)
    .update("openforge:portfolio-worker-capability:v1")
    .digest("hex");
  const assignmentLookup = {
    findActiveAssignment(input: { userId: string; sessionId: string; now?: Date }) {
      return new PortfolioRepository(db, input.userId).findActiveAssignment({
        sessionId: input.sessionId,
        ...(input.now ? { now: input.now } : {})
      });
    }
  };
  const workerSignals: PortfolioRuntimeWorkerSignalFactory = {
    forUser(userId: string) {
      const repository = new PortfolioRepository(db, userId);
      const signals = createWorkerSignalService({ repository, capabilitySecret });
      return {
        listWorkerSignalsForAttempt: (attemptId: string) => repository.listWorkerSignalsForAttempt(attemptId),
        acknowledgeSessionStart: signals.acknowledgeSessionStart,
        authorizeCanonicalPacket: signals.authorizeCanonicalPacket,
        recordDispatchReceipt: signals.recordDispatchReceipt
      };
    }
  };
  const sessionInputGate = new PortfolioSessionInputGate(assignmentLookup, {
    authorizeCanonicalPacket(input, workerAckCapability, now) {
      if (!workerAckCapability) throw new Error("PORTFOLIO_WRITER_FENCE_REJECTED");
      const signals = workerSignals.forUser(input.userId);
      const binding = {
        commandId: input.commandId,
        assignmentId: input.assignmentId,
        attemptId: input.attemptId,
        sessionId: input.sessionId,
        adapter: input.adapter,
        leaseGeneration: input.leaseGeneration,
        packetDigest: input.packetDigest
      };
      return signals.authorizeCanonicalPacket({
        ...binding,
        capability: workerAckCapability,
        ...(now ? { now } : {})
      });
    }
  });
  function createExecutionRuntime(input: {
    sessionManager: InMemorySessionManager;
    masterKey: string;
  }): PortfolioExecutionRuntime {
    return {
      forUser(userId: string) {
        const repository = new PortfolioRepository(db, userId);
        const execution = createExecutionService({
          repository,
          packetService: createTaskPacketService(repository, createPlatformToolManifestService()),
          authorizationPolicy: createAuthorizationPolicy({ preauthorizedActionClasses: ["packet_submit"] }),
          workerSignals: createWorkerSignalService({ repository, capabilitySecret }),
          workerLaunchPort: {
            launch: ({ prepared, material }) => launchPreparedClaudeWorker({
              db,
              userId,
              masterKey: input.masterKey,
              sessionManager: input.sessionManager,
              prepared,
              material
            })
          }
        });
        return execution;
      }
    };
  }
  return { assignmentLookup, workerSignals, sessionInputGate, createExecutionRuntime };
}

async function launchPreparedClaudeWorker(input: {
  db: Database;
  userId: string;
  masterKey: string;
  sessionManager: InMemorySessionManager;
  prepared: PreparedDispatch;
  material: ClaudePortfolioWorkerLaunchConfiguration;
}): Promise<void> {
  const sessionRepository = new SessionRepository(input.db, input.userId);
  const session = sessionRepository.getById(input.material.binding.sessionId);
  if (!session || session.aiTool !== "claude" || session.projectId !== input.prepared.assignment.projectId
    || input.prepared.assignment.id !== input.material.binding.assignmentId
    || input.prepared.assignment.attemptId !== input.material.binding.attemptId
    || input.prepared.assignment.sessionId !== session.id
    || input.prepared.assignment.adapter !== "claude"
    || input.prepared.assignment.leaseGeneration !== input.material.binding.leaseGeneration
    || input.prepared.command.id !== input.material.binding.commandId
    || input.prepared.command.payloadDigest !== input.material.binding.packetDigest) {
    throw new Error("PORTFOLIO_WORKER_LAUNCH_BINDING_REJECTED");
  }
  if (session.status === "running" || input.sessionManager.getSession(session.id)) {
    // An already-running terminal cannot be safely retrofitted with the new
    // process-local capability, so fail closed rather than attach to it.
    throw new Error("PORTFOLIO_WORKER_SESSION_REQUIRES_FRESH_LAUNCH");
  }
  const adapterStatus = await getAdapterLaunchStatus("claude");
  if (
    !adapterStatus.available
    || !adapterStatus.launchEnabled
    || !adapterStatus.runtimeModes.includes("terminal")
    || adapterStatus.portfolioWorker.readiness !== "claude_session_start"
  ) {
    throw new Error("PORTFOLIO_WORKER_ADAPTER_NOT_ELIGIBLE");
  }

  const launchPlan = await prepareClaudePortfolioWorkerLaunch({
    db: input.db,
    userId: input.userId,
    masterKey: input.masterKey,
    adapter: "claude",
    projectRoot: session.workingDir,
    sessionId: session.id,
    credentialMode: session.credentialMode,
    ...(session.apiKeyId ? { apiKeyId: session.apiKeyId } : {}),
    ...(session.modelId ? { modelId: session.modelId } : {}),
    portfolioWorker: input.material
  });

  try {
    const live = await input.sessionManager.createSession({
      userId: input.userId,
      sessionId: session.id,
      launchPlan
    });
    // The recovery store has already persisted the attach token encrypted; do
    // not copy it back through the plain repository update path.
    sessionRepository.update(session.id, {
      status: "running",
      tmuxSession: live.tmuxName,
      lastActive: new Date()
    });
  } catch (error) {
    sessionRepository.update(session.id, {
      status: "error",
      errorMessage: error instanceof Error ? error.message : "PORTFOLIO_WORKER_LAUNCH_FAILED"
    });
    throw error;
  }
}
