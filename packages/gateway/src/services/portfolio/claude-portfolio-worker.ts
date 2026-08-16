import { digestPortfolioValue } from "../../db/repositories/portfolio-repository.js";
import type { InMemorySessionManager } from "../session-manager.js";
import {
  type PortfolioAssignmentLookup,
  type PortfolioSessionAssignment,
  type PortfolioSessionInputGate,
  type PortfolioWorkerSignalBinding
} from "./session-input-gate.js";
import type { CanonicalTaskPacket } from "./task-packet-service.js";
import type { WorkerDispatchAuthorization } from "./worker-contract.js";

export type ClaudePortfolioWorkerRuntime = "unverified_no_input" | "verified_input";
export type ClaudePortfolioWorkerStatus =
  | "acknowledged"
  | "awaiting_signal"
  | "ignored"
  | "rejected"
  | "unsupported"
  | "unverified_no_input"
  | "submitted";

export interface PortfolioWorkerSignal extends PortfolioWorkerSignalBinding {
  id: string;
  state: "expected" | "acknowledged" | "consumed" | "expired";
  projectId: string;
  workItemId: string;
}

/** Tenant-scoped signal service implemented by the durable Portfolio core. */
export interface ClaudePortfolioWorkerSignals {
  listWorkerSignalsForAttempt(attemptId: string): PortfolioWorkerSignal[];
  acknowledgeSessionStart(input: PortfolioWorkerSignalBinding & { capability: string }): unknown;
  recordDispatchReceipt(input: WorkerDispatchAuthorization & {
    receiptDigest: string;
    idempotencyKey: string;
    now?: Date;
  }): unknown;
}

export interface ClaudePortfolioWorkerSignalFactory {
  forUser(userId: string): ClaudePortfolioWorkerSignals;
}

export interface ClaudeSessionStartForward {
  userId: string;
  sessionId: string;
  workerAckCapability: string | undefined;
  now?: Date;
}

export interface ClaudeCanonicalPacketSubmission extends Omit<ClaudeSessionStartForward, "workerAckCapability"> {
  commandId: string;
  assignmentId: string;
  attemptId: string;
  adapter: "claude";
  leaseGeneration: number;
  packetDigest: string;
  idempotencyKey: string;
}

export interface ClaudePortfolioWorkerResult {
  status: ClaudePortfolioWorkerStatus;
}

export interface VerifiedWorkerCapabilityProvider {
  getWorkerAckCapability(binding: PortfolioWorkerSignalBinding): string | undefined;
}

/**
 * Internal-only extension used by the fixed SessionStart forwarder after the
 * durable service has accepted the supplied capability. It is never reachable
 * from attach/connect/WebSocket code.
 */
export interface VerifiedWorkerCapabilityRegistry extends VerifiedWorkerCapabilityProvider {
  rememberWorkerAckCapability(binding: PortfolioWorkerSignalBinding, capability: string): void;
  forgetWorkerAckCapability(binding: PortfolioWorkerSignalBinding): void;
}

/** Keeps raw worker capability material only in the Gateway process lifetime. */
export class InMemoryVerifiedWorkerCapabilityRegistry implements VerifiedWorkerCapabilityRegistry {
  readonly #capabilities = new Map<string, string>();

  getWorkerAckCapability(binding: PortfolioWorkerSignalBinding): string | undefined {
    return this.#capabilities.get(workerCapabilityKey(binding));
  }

  rememberWorkerAckCapability(binding: PortfolioWorkerSignalBinding, capability: string): void {
    this.#capabilities.set(workerCapabilityKey(binding), capability);
  }

  forgetWorkerAckCapability(binding: PortfolioWorkerSignalBinding): void {
    this.#capabilities.delete(workerCapabilityKey(binding));
  }
}

/**
 * The only adapter worker currently eligible to acknowledge readiness. Its
 * default runtime persists readiness but deliberately never sends CLI input.
 */
export class ClaudePortfolioWorker {
  constructor(private readonly dependencies: {
    assignmentLookup: PortfolioAssignmentLookup;
    workerSignals: ClaudePortfolioWorkerSignalFactory;
    sessionInputGate: PortfolioSessionInputGate;
    sessionManager: Pick<InMemorySessionManager, "sendInput">;
    runtime?: ClaudePortfolioWorkerRuntime;
    verifiedWorkerCapabilityProvider?: VerifiedWorkerCapabilityProvider;
  }) {}

  forwardSessionStart(input: ClaudeSessionStartForward): ClaudePortfolioWorkerResult {
    if (!input.workerAckCapability) return { status: "rejected" };
    const assignment = this.findAssignment(input);
    if (!assignment) return { status: "ignored" };
    if (assignment.adapter !== "claude") return { status: "unsupported" };
    const signal = this.findExpectedClaudeSignal(input.userId, assignment);
    if (!signal) return { status: "awaiting_signal" };

    const binding = bindingFor(signal);
    try {
      const signals = this.dependencies.workerSignals.forUser(input.userId);
      signals.acknowledgeSessionStart({ ...binding, capability: input.workerAckCapability });
      this.rememberVerifiedCapability(binding, input.workerAckCapability);
      return { status: "acknowledged" };
    } catch {
      return { status: "rejected" };
    }
  }

  async submitCanonicalPacket(input: ClaudeCanonicalPacketSubmission): Promise<ClaudePortfolioWorkerResult> {
    if (this.runtime() !== "verified_input") return { status: "unverified_no_input" };
    if (!input.idempotencyKey || !isPacketDigest(input.packetDigest)) return { status: "rejected" };
    const assignment = this.findAssignment(input);
    if (!assignment || !matchesAssignment(assignment, input)) return { status: "rejected" };
    const binding: PortfolioWorkerSignalBinding = {
      commandId: input.commandId,
      assignmentId: input.assignmentId,
      attemptId: input.attemptId,
      sessionId: input.sessionId,
      adapter: input.adapter,
      leaseGeneration: input.leaseGeneration,
      packetDigest: input.packetDigest
    };
    const workerAckCapability = this.dependencies.verifiedWorkerCapabilityProvider
      ?.getWorkerAckCapability(binding);
    if (!workerAckCapability) return { status: "rejected" };

    try {
      const grant = this.dependencies.sessionInputGate.issueWorkerInputGrant({
        userId: input.userId,
        projectId: assignment.projectId,
        workItemId: assignment.workItemId,
        commandId: input.commandId,
        assignmentId: input.assignmentId,
        attemptId: input.attemptId,
        sessionId: input.sessionId,
        adapter: input.adapter,
        leaseGeneration: input.leaseGeneration,
        packetDigest: input.packetDigest
      }, workerAckCapability, input.now);
      await this.dependencies.sessionManager.sendInput(
        input.sessionId,
        renderCanonicalClaudeTaskPacket(grant.authorization.packet),
        grant.capability
      );
      this.dependencies.workerSignals.forUser(input.userId).recordDispatchReceipt({
        ...grant.authorization,
        receiptDigest: dispatchReceiptDigest(grant.authorization),
        idempotencyKey: input.idempotencyKey,
        ...(input.now ? { now: input.now } : {})
      });
      this.forgetVerifiedCapability(binding);
      return { status: "submitted" };
    } catch {
      // After a capability is consumed, a tmux failure remains unknown; callers
      // must reconcile rather than reuse it or blindly resend the packet.
      return { status: "rejected" };
    }
  }

  private findAssignment(
    input: Pick<ClaudeSessionStartForward, "userId" | "sessionId" | "now">
  ): PortfolioSessionAssignment | undefined {
    try {
      return this.dependencies.assignmentLookup.findActiveAssignment({
        userId: input.userId,
        sessionId: input.sessionId,
        ...(input.now ? { now: input.now } : {})
      });
    } catch {
      return undefined;
    }
  }

  private findExpectedClaudeSignal(userId: string, assignment: PortfolioSessionAssignment): PortfolioWorkerSignal | undefined {
    const matching = this.dependencies.workerSignals.forUser(userId)
      .listWorkerSignalsForAttempt(assignment.attemptId)
      .filter((signal) => signal.state === "expected" && matchesAssignment(assignment, signal));
    return matching.length === 1 ? matching[0] : undefined;
  }

  private runtime(): ClaudePortfolioWorkerRuntime {
    return this.dependencies.runtime ?? "unverified_no_input";
  }

  private rememberVerifiedCapability(binding: PortfolioWorkerSignalBinding, capability: string): void {
    const provider = this.dependencies.verifiedWorkerCapabilityProvider;
    if (isVerifiedWorkerCapabilityRegistry(provider)) {
      provider.rememberWorkerAckCapability(binding, capability);
    }
  }

  private forgetVerifiedCapability(binding: PortfolioWorkerSignalBinding): void {
    const provider = this.dependencies.verifiedWorkerCapabilityProvider;
    if (isVerifiedWorkerCapabilityRegistry(provider)) {
      provider.forgetWorkerAckCapability(binding);
    }
  }
}

function bindingFor(signal: PortfolioWorkerSignal): PortfolioWorkerSignalBinding {
  return {
    commandId: signal.commandId,
    assignmentId: signal.assignmentId,
    attemptId: signal.attemptId,
    sessionId: signal.sessionId,
    adapter: signal.adapter,
    leaseGeneration: signal.leaseGeneration,
    packetDigest: signal.packetDigest
  };
}

function matchesAssignment(
  assignment: PortfolioSessionAssignment,
  binding: Pick<PortfolioWorkerSignalBinding, "assignmentId" | "attemptId" | "sessionId" | "adapter" | "leaseGeneration">
): boolean {
  return assignment.active && assignment.id === binding.assignmentId && assignment.attemptId === binding.attemptId
    && assignment.sessionId === binding.sessionId && assignment.adapter === binding.adapter
    && assignment.leaseGeneration === binding.leaseGeneration;
}

function isPacketDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/iu.test(value);
}

function renderCanonicalClaudeTaskPacket(packet: CanonicalTaskPacket): string {
  return `<openforge-portfolio-task-packet>\n${JSON.stringify(packet)}\n</openforge-portfolio-task-packet>\n`;
}

function dispatchReceiptDigest(authorization: WorkerDispatchAuthorization): string {
  return digestPortfolioValue({
    commandId: authorization.binding.commandId,
    packetDigest: authorization.binding.packetDigest,
    renderedBy: "claude_portfolio_worker"
  });
}

function workerCapabilityKey(binding: PortfolioWorkerSignalBinding): string {
  return digestPortfolioValue(binding);
}

function isVerifiedWorkerCapabilityRegistry(
  provider: VerifiedWorkerCapabilityProvider | undefined
): provider is VerifiedWorkerCapabilityRegistry {
  return typeof (provider as Partial<VerifiedWorkerCapabilityRegistry> | undefined)
    ?.rememberWorkerAckCapability === "function"
    && typeof (provider as Partial<VerifiedWorkerCapabilityRegistry> | undefined)
      ?.forgetWorkerAckCapability === "function";
}
