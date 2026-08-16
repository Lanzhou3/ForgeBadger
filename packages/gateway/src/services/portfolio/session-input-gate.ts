import type { GateASession } from "../session-manager.js";
import type { WorkerDispatchAuthorization } from "./worker-contract.js";

/** Stable error code for any writer that is not the assignment-bound worker. */
export const PORTFOLIO_WRITER_FENCE_REJECTED = "PORTFOLIO_WRITER_FENCE_REJECTED";

export interface PortfolioSessionAssignment {
  id: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  sessionId: string;
  adapter: string;
  leaseGeneration: number;
  leaseExpiresAt: Date;
  active: boolean;
}

export interface PortfolioWorkerSignalBinding {
  commandId: string;
  assignmentId: string;
  attemptId: string;
  sessionId: string;
  adapter: string;
  leaseGeneration: number;
  packetDigest: string;
}

export interface PortfolioWorkerWriteRequest extends PortfolioWorkerSignalBinding {
  userId: string;
  projectId: string;
  workItemId: string;
}

export interface PortfolioAssignmentLookup {
  findActiveAssignment(input: {
    userId: string;
    sessionId: string;
    now?: Date;
  }): PortfolioSessionAssignment | undefined;
}

/**
 * The durable signal service validates the HMAC ACK, command, packet, and
 * authorization linkage. It returns no raw secret to the terminal layer.
 */
export interface PortfolioCanonicalPacketAuthorizer {
  authorizeCanonicalPacket(
    input: PortfolioWorkerWriteRequest,
    workerAckCapability: string | undefined,
    now?: Date
  ): WorkerDispatchAuthorization;
}

/**
 * Opaque, in-memory-only write right. Constructing a lookalike object cannot
 * pass the gate because the instance must be held in the gate's WeakMap.
 */
export interface PortfolioWorkerInputCapability {
  readonly kind: "portfolio_worker_input";
}

export interface PortfolioWorkerInputGrant {
  capability: PortfolioWorkerInputCapability;
  authorization: WorkerDispatchAuthorization;
}

export class PortfolioSessionInputGate {
  readonly #capabilities = new WeakMap<PortfolioWorkerInputCapability, PortfolioWorkerWriteRequest>();
  readonly #consumedCapabilities = new WeakSet<PortfolioWorkerInputCapability>();

  constructor(
    private readonly assignmentLookup: PortfolioAssignmentLookup,
    private readonly packetAuthorizer: PortfolioCanonicalPacketAuthorizer
  ) {}

  assertBrowserInputAllowed(session: GateASession, now?: Date): void {
    this.assertNoActiveAssignment(session, now);
  }

  assertDirectInputAllowed(session: GateASession, now?: Date): void {
    this.assertNoActiveAssignment(session, now);
  }

  issueWorkerInputCapability(
    input: PortfolioWorkerWriteRequest,
    workerAckCapability?: string,
    now?: Date
  ): PortfolioWorkerInputCapability {
    return this.issueWorkerInputGrant(input, workerAckCapability, now).capability;
  }

  issueWorkerInputGrant(
    input: PortfolioWorkerWriteRequest,
    workerAckCapability?: string,
    now?: Date
  ): PortfolioWorkerInputGrant {
    this.assertPacketDigest(input.packetDigest);
    this.assertCurrentAssignment(input, now);
    const authorization = this.authorizeCanonicalPacket(input, workerAckCapability, now);
    const capability: PortfolioWorkerInputCapability = Object.freeze({ kind: "portfolio_worker_input" });
    this.#capabilities.set(capability, input);
    return { capability, authorization };
  }

  assertWorkerInputAllowed(
    session: GateASession,
    capability: PortfolioWorkerInputCapability,
    now?: Date
  ): void {
    const input = this.#capabilities.get(capability);
    if (!input || this.#consumedCapabilities.has(capability)) {
      throw writerFenceError();
    }
    if (input.userId !== session.userId || input.sessionId !== session.id) {
      throw writerFenceError();
    }
    this.assertCurrentAssignment(input, now);
    this.#consumedCapabilities.add(capability);
  }

  private assertNoActiveAssignment(session: GateASession, now?: Date): void {
    if (this.findActiveAssignment(session.userId, session.id, now)) {
      throw writerFenceError();
    }
  }

  private assertCurrentAssignment(input: PortfolioWorkerWriteRequest, now?: Date): void {
    const assignment = this.findActiveAssignment(input.userId, input.sessionId, now);
    if (!assignment || !assignment.active || assignment.id !== input.assignmentId) {
      throw writerFenceError();
    }
    if (
      assignment.projectId !== input.projectId ||
      assignment.workItemId !== input.workItemId ||
      assignment.attemptId !== input.attemptId ||
      assignment.adapter !== input.adapter ||
      assignment.leaseGeneration !== input.leaseGeneration
    ) {
      throw writerFenceError();
    }
  }

  private authorizeCanonicalPacket(
    input: PortfolioWorkerWriteRequest,
    workerAckCapability: string | undefined,
    now?: Date
  ): WorkerDispatchAuthorization {
    try {
      return this.packetAuthorizer.authorizeCanonicalPacket(input, workerAckCapability, now);
    } catch {
      throw writerFenceError();
    }
  }

  private assertPacketDigest(packetDigest: string): void {
    if (!/^[a-f0-9]{64}$/iu.test(packetDigest)) {
      throw writerFenceError();
    }
  }

  private findActiveAssignment(userId: string, sessionId: string, now?: Date): PortfolioSessionAssignment | undefined {
    try {
      return this.assignmentLookup.findActiveAssignment({ userId, sessionId, ...(now ? { now } : {}) });
    } catch {
      // A failed durable lookup must never turn into a permit for terminal input.
      throw writerFenceError();
    }
  }
}

function writerFenceError(): Error {
  return new Error(PORTFOLIO_WRITER_FENCE_REJECTED);
}
