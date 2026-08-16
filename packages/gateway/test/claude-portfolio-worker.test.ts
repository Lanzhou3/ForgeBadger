import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { InMemorySessionManager } from "../src/services/session-manager.js";
import {
  ClaudePortfolioWorker,
  InMemoryVerifiedWorkerCapabilityRegistry,
  type ClaudeCanonicalPacketSubmission,
  type ClaudePortfolioWorkerSignalFactory,
  type ClaudePortfolioWorkerSignals,
  type PortfolioWorkerSignal
} from "../src/services/portfolio/claude-portfolio-worker.js";
import {
  PortfolioSessionInputGate,
  type PortfolioAssignmentLookup,
  type PortfolioCanonicalPacketAuthorizer,
  type PortfolioSessionAssignment,
  type PortfolioWorkerWriteRequest
} from "../src/services/portfolio/session-input-gate.js";
import type { CanonicalTaskPacket } from "../src/services/portfolio/task-packet-service.js";
import type { WorkerDispatchAuthorization } from "../src/services/portfolio/worker-contract.js";

function assignment(adapter = "claude"): PortfolioSessionAssignment {
  return {
    id: "assignment:claude-worker",
    projectId: "project:claude-worker",
    workItemId: "work-item:claude-worker",
    attemptId: "attempt:claude-worker",
    sessionId: "session:claude-worker",
    adapter,
    leaseGeneration: 4,
    leaseExpiresAt: new Date("2026-08-15T00:05:00.000Z"),
    active: true
  };
}

function expectedSignal(activeAssignment: PortfolioSessionAssignment): PortfolioWorkerSignal {
  return {
    id: "signal:claude-worker",
    state: "expected",
    projectId: activeAssignment.projectId,
    workItemId: activeAssignment.workItemId,
    commandId: "command:claude-worker",
    assignmentId: activeAssignment.id,
    attemptId: activeAssignment.attemptId,
    sessionId: activeAssignment.sessionId,
    adapter: activeAssignment.adapter,
    leaseGeneration: activeAssignment.leaseGeneration,
    packetDigest: "a".repeat(64)
  };
}

interface WorkerFixture {
  worker: ClaudePortfolioWorker;
  activeAssignment: PortfolioSessionAssignment;
  workerAckCapability: string;
  acknowledgements: string[];
  writes: string[];
  receiptPermits: string[];
}

function workerAuthorization(input: PortfolioWorkerWriteRequest): WorkerDispatchAuthorization {
  const packet: CanonicalTaskPacket = {
    version: 1,
    project: { id: input.projectId, objective: "Objective", intendedOutcome: "Outcome", scope: {}, dossierVersion: 1 },
    workItem: { id: input.workItemId, title: "Work", description: null, acceptanceCriteria: [], verificationRequirements: [], projectionVersion: 1 },
    execution: { adapter: input.adapter },
    skill: { version: null, toolIds: [] },
    platformTools: { manifestVersion: "platform-tools/v1", manifestDigest: "sha256:manifest", tools: [] }
  };
  return {
    binding: {
      commandId: input.commandId,
      assignmentId: input.assignmentId,
      attemptId: input.attemptId,
      sessionId: input.sessionId,
      adapter: input.adapter,
      leaseGeneration: input.leaseGeneration,
      packetDigest: input.packetDigest
    },
    packet,
    receiptPermit: "receipt-permit",
    expectedCommandProjectionVersion: 1
  };
}

function createWorkerFixture(
  runtime?: "unverified_no_input" | "verified_input",
  adapter = "claude",
  failWrite = false
): WorkerFixture {
  const activeAssignment = assignment(adapter);
  const signal = expectedSignal(activeAssignment);
  const acknowledgements: string[] = [];
  const writes: string[] = [];
  let canonicalPacketConsumed = false;
  const receiptPermits: string[] = [];
  const workerAckCapability = "worker-ack-capability-only";
  const assignmentLookup: PortfolioAssignmentLookup = {
    findActiveAssignment: ({ userId, sessionId }) => (
      userId === "user:claude-worker" && sessionId === activeAssignment.sessionId
        ? activeAssignment
        : undefined
    )
  };
  const canonicalAuthorizer: PortfolioCanonicalPacketAuthorizer = {
    authorizeCanonicalPacket: (input, suppliedWorkerAckCapability) => {
      if (suppliedWorkerAckCapability !== workerAckCapability) throw new Error("invalid worker capability");
      if (canonicalPacketConsumed) throw new Error("canonical packet already consumed");
      canonicalPacketConsumed = true;
      return workerAuthorization(input);
    }
  };
  const signals: ClaudePortfolioWorkerSignals = {
    recordDispatchReceipt: (input) => {
      receiptPermits.push(input.receiptPermit);
    },
    listWorkerSignalsForAttempt: (attemptId) => attemptId === signal.attemptId ? [signal] : [],
    acknowledgeSessionStart: (input) => {
      if (input.capability !== workerAckCapability) throw new Error("invalid worker capability");
      acknowledgements.push(input.commandId);
    }
  };
  const workerSignals: ClaudePortfolioWorkerSignalFactory = {
    forUser: (userId) => {
      if (userId !== "user:claude-worker") throw new Error("cross-tenant signal lookup");
      return signals;
    }
  };
  const sessionInputGate = new PortfolioSessionInputGate(assignmentLookup, canonicalAuthorizer);
  const verifiedWorkerCapabilityProvider = new InMemoryVerifiedWorkerCapabilityRegistry();
  const sessionManager: Pick<InMemorySessionManager, "sendInput"> = {
    sendInput: async (_sessionId, data) => {
      writes.push(data);
      if (failWrite) throw new Error("simulated terminal write crash");
    }
  };
  const worker = new ClaudePortfolioWorker({
    assignmentLookup,
    workerSignals,
    sessionInputGate,
    sessionManager,
    ...(runtime ? { runtime } : {}),
    ...(runtime === "verified_input" ? {
      verifiedWorkerCapabilityProvider
    } : {})
  });
  return { worker, activeAssignment, workerAckCapability, acknowledgements, writes, receiptPermits };
}

describe("ClaudePortfolioWorker", () => {
  it("rejects attach or missing ACK capabilities and sends no default-runtime input", async () => {
    // Arrange
    const fixture = createWorkerFixture();

    // Act
    const missingCapability = fixture.worker.forwardSessionStart({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      workerAckCapability: undefined
    });
    const attachCapability = fixture.worker.forwardSessionStart({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      workerAckCapability: "valid-browser-attach-token-is-not-a-worker-ack"
    });
    const readiness = fixture.worker.forwardSessionStart({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      workerAckCapability: fixture.workerAckCapability
    });
    const dispatch = await fixture.worker.submitCanonicalPacket({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      commandId: "command:claude-worker",
      assignmentId: fixture.activeAssignment.id,
      attemptId: fixture.activeAssignment.attemptId,
      adapter: "claude",
      leaseGeneration: fixture.activeAssignment.leaseGeneration,
      packetDigest: "a".repeat(64),
      idempotencyKey: "dispatch:default-runtime"
    });

    // Assert
    assert.equal(missingCapability.status, "rejected");
    assert.equal(attachCapability.status, "rejected");
    assert.equal(readiness.status, "acknowledged");
    assert.deepEqual(fixture.acknowledgements, ["command:claude-worker"]);
    assert.equal(dispatch.status, "unverified_no_input");
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(fixture.receiptPermits, []);
  });

  it("marks a non-Claude assigned session unsupported and never attempts a terminal write", () => {
    // Arrange
    const fixture = createWorkerFixture(undefined, "opencode");

    // Act
    const result = fixture.worker.forwardSessionStart({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      workerAckCapability: fixture.workerAckCapability
    });

    // Assert
    assert.equal(result.status, "unsupported");
    assert.deepEqual(fixture.acknowledgements, []);
    assert.deepEqual(fixture.writes, []);
  });

  it("rejects empty dispatch identity and malformed packet digests before any verified write", async () => {
    // Arrange
    const fixture = createWorkerFixture("verified_input");

    // Act
    const emptyIdentity = await fixture.worker.submitCanonicalPacket({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      commandId: "command:claude-worker",
      assignmentId: fixture.activeAssignment.id,
      attemptId: fixture.activeAssignment.attemptId,
      adapter: "claude",
      leaseGeneration: fixture.activeAssignment.leaseGeneration,
      packetDigest: "a".repeat(64),
      idempotencyKey: ""
    });
    const malformedDigest = await fixture.worker.submitCanonicalPacket({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      commandId: "command:claude-worker",
      assignmentId: fixture.activeAssignment.id,
      attemptId: fixture.activeAssignment.attemptId,
      adapter: "claude",
      leaseGeneration: fixture.activeAssignment.leaseGeneration,
      packetDigest: "untrusted raw terminal input",
      idempotencyKey: "dispatch:malformed-digest"
    });

    // Assert
    assert.equal(emptyIdentity.status, "rejected");
    assert.equal(malformedDigest.status, "rejected");
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(fixture.receiptPermits, []);
  });

  it("requires a successful worker-only SessionStart ACK before verified input can consume a packet", async () => {
    // Arrange
    const fixture = createWorkerFixture("verified_input");
    const submission: ClaudeCanonicalPacketSubmission = {
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      commandId: "command:claude-worker",
      assignmentId: fixture.activeAssignment.id,
      attemptId: fixture.activeAssignment.attemptId,
      adapter: "claude",
      leaseGeneration: fixture.activeAssignment.leaseGeneration,
      packetDigest: "a".repeat(64),
      idempotencyKey: "dispatch:requires-readiness"
    };

    // Act
    const beforeAck = await fixture.worker.submitCanonicalPacket(submission);
    const readiness = fixture.worker.forwardSessionStart({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      workerAckCapability: fixture.workerAckCapability
    });
    const afterAck = await fixture.worker.submitCanonicalPacket(submission);

    // Assert
    assert.equal(beforeAck.status, "rejected");
    assert.equal(readiness.status, "acknowledged");
    assert.equal(afterAck.status, "submitted");
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.receiptPermits.length, 1);
  });

  it("does not blindly resend after a terminal write crash leaves no receipt", async () => {
    // Arrange
    const fixture = createWorkerFixture("verified_input", "claude", true);
    const submission: ClaudeCanonicalPacketSubmission = {
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      commandId: "command:claude-worker",
      assignmentId: fixture.activeAssignment.id,
      attemptId: fixture.activeAssignment.attemptId,
      adapter: "claude",
      leaseGeneration: fixture.activeAssignment.leaseGeneration,
      packetDigest: "a".repeat(64),
      idempotencyKey: "dispatch:terminal-write-crash"
    };
    fixture.worker.forwardSessionStart({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      workerAckCapability: fixture.workerAckCapability
    });

    // Act
    const first = await fixture.worker.submitCanonicalPacket(submission);
    const replay = await fixture.worker.submitCanonicalPacket(submission);

    // Assert
    assert.equal(first.status, "rejected");
    assert.equal(replay.status, "rejected");
    assert.equal(fixture.writes.length, 1);
    assert.deepEqual(fixture.receiptPermits, []);
  });

  it("forwards exactly one canonical packet in the explicitly verified fake runtime", async () => {
    // Arrange
    const fixture = createWorkerFixture("verified_input");

    const submission: ClaudeCanonicalPacketSubmission = {
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      commandId: "command:claude-worker",
      assignmentId: fixture.activeAssignment.id,
      attemptId: fixture.activeAssignment.attemptId,
      adapter: "claude",
      leaseGeneration: fixture.activeAssignment.leaseGeneration,
      packetDigest: "a".repeat(64),
      idempotencyKey: "dispatch:verified-runtime"
    };

    // Act
    const readiness = fixture.worker.forwardSessionStart({
      userId: "user:claude-worker",
      sessionId: fixture.activeAssignment.sessionId,
      workerAckCapability: fixture.workerAckCapability
    });
    const first = await fixture.worker.submitCanonicalPacket(submission);
    const replay = await fixture.worker.submitCanonicalPacket(submission);

    // Assert
    assert.equal(first.status, "submitted");
    assert.equal(replay.status, "rejected");
    assert.equal(readiness.status, "acknowledged");
    assert.equal(fixture.writes.length, 1);
    assert.match(fixture.writes[0] ?? "", /^<openforge-portfolio-task-packet>\n/);
    assert.match(fixture.writes[0] ?? "", /"execution":\{"adapter":"claude"\}/);
    assert.deepEqual(fixture.receiptPermits, ["receipt-permit"]);
  });
});
