import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createAuthorizationPolicy } from "../src/services/portfolio/authorization-policy.js";
import { createExecutionService } from "../src/services/portfolio/execution-service.js";
import { createPlatformToolManifestService } from "../src/services/portfolio/platform-tool-manifest.js";
import { createTaskPacketService } from "../src/services/portfolio/task-packet-service.js";
import { createWorkerSignalService } from "../src/services/portfolio/worker-signal-service.js";
import type { WorkerBinding } from "../src/services/portfolio/worker-contract.js";
import { digestPortfolioValue } from "../src/db/repositories/portfolio-repository.js";
import { createPortfolioPhase4Fixture, type PortfolioPhase4Fixture } from "./portfolio-phase4-fixture.js";

interface SignalDispatchFixture {
  fixture: PortfolioPhase4Fixture;
  workerSignals: ReturnType<typeof createWorkerSignalService>;
  prepared: ReturnType<ReturnType<typeof createExecutionService>["prepareDispatch"]>;
}

function createSignalDispatchFixture(fixture: PortfolioPhase4Fixture): SignalDispatchFixture {
  const packets = createTaskPacketService(fixture.repository, createPlatformToolManifestService());
  const attempt = packets.prepareAttempt({
    projectId: fixture.projectId,
    workItemId: fixture.workItem.id,
    adapter: "claude",
    createdBy: fixture.owner.id,
    skillVersion: "portfolio-execution/v1",
    toolIds: ["portfolio.submit_canonical_task_packet"],
    idempotencyKey: "attempt:worker-signal"
  });
  const assignment = fixture.repository.claimSessionAssignment({
    projectId: fixture.projectId,
    workItemId: fixture.workItem.id,
    attemptId: attempt.attempt.id,
    sessionId: fixture.session.id,
    adapter: "claude",
    leaseDurationMs: 60_000,
    now: new Date()
  });
  const workerSignals = createWorkerSignalService({
    repository: fixture.repository,
    capabilitySecret: "phase4-test-worker-capability-secret"
  });
  const execution = createExecutionService({
    repository: fixture.repository,
    packetService: packets,
    authorizationPolicy: createAuthorizationPolicy({ preauthorizedActionClasses: ["packet_submit"] }),
    workerSignals
  });
  const prepared = execution.prepareDispatch({
    projectId: fixture.projectId,
    workItemId: fixture.workItem.id,
    attemptId: attempt.attempt.id,
    sessionId: fixture.session.id,
    assignmentId: assignment.id,
    leaseToken: assignment.leaseToken,
    expectedAttemptProjectionVersion: attempt.attempt.projectionVersion,
    expectedAssignmentProjectionVersion: assignment.projectionVersion,
    idempotencyKey: "dispatch:worker-signal",
    expiresAt: new Date("2099-08-15T00:10:00.000Z")
  });
  return { fixture, workerSignals, prepared };
}

function bindingFor(dispatch: SignalDispatchFixture): WorkerBinding {
  return {
    commandId: dispatch.prepared.command.id,
    assignmentId: dispatch.prepared.assignment.id,
    attemptId: dispatch.prepared.command.attemptId,
    sessionId: dispatch.fixture.session.id,
    adapter: "claude",
    leaseGeneration: dispatch.prepared.assignment.leaseGeneration,
    packetDigest: dispatch.prepared.command.payloadDigest
  };
}

describe("Portfolio WorkerSignalService", () => {
  let fixture: PortfolioPhase4Fixture;

  beforeEach(() => {
    // Arrange
    fixture = createPortfolioPhase4Fixture();
  });

  afterEach(() => {
    fixture.db.close();
  });

  it("stores only a capability digest and rejects attach tokens, stale generations, and ACK replay", () => {
    // Arrange
    const dispatch = createSignalDispatchFixture(fixture);
    const binding = bindingFor(dispatch);
    const capability = dispatch.workerSignals.deriveSessionStartCapabilityForForwarder(binding);
    const expected = fixture.repository.getWorkerSignalForCommand(binding.commandId);
    assert.ok(expected);

    // Act / Assert
    assert.equal(expected.capabilityDigest, digestPortfolioValue(capability));
    assert.notEqual(expected.capabilityDigest, capability);
    assert.equal("capability" in expected, false);
    assert.equal(JSON.stringify(expected).includes(capability), false);
    assert.throws(
      () => dispatch.workerSignals.acknowledgeSessionStart({ ...binding, capability: fixture.session.attachToken }),
      /PORTFOLIO_WORKER_SIGNAL_ACK_REJECTED/
    );
    assert.equal(fixture.repository.getWorkerSignalForCommand(binding.commandId)?.state, "expected");
    assert.equal(fixture.repository.getCommand(binding.commandId)?.dispatchReceiptDigest, null);
    assert.throws(
      () => dispatch.workerSignals.acknowledgeSessionStart({ ...binding, capability: "wrong-worker-ack-capability" }),
      /PORTFOLIO_WORKER_SIGNAL_ACK_REJECTED/
    );
    assert.equal(fixture.repository.getWorkerSignalForCommand(binding.commandId)?.state, "expected");
    assert.equal(fixture.repository.getCommand(binding.commandId)?.dispatchReceiptDigest, null);

    const staleGeneration = { ...binding, leaseGeneration: binding.leaseGeneration - 1 };
    const staleCapability = dispatch.workerSignals.deriveSessionStartCapabilityForForwarder(staleGeneration);
    assert.throws(
      () => dispatch.workerSignals.acknowledgeSessionStart({ ...staleGeneration, capability: staleCapability }),
      /PORTFOLIO_WORKER_SIGNAL_BINDING_MISMATCH/
    );

    const crossSession = { ...binding, sessionId: "session:another-user-scope" };
    const crossSessionCapability = dispatch.workerSignals.deriveSessionStartCapabilityForForwarder(crossSession);
    assert.throws(
      () => dispatch.workerSignals.acknowledgeSessionStart({ ...crossSession, capability: crossSessionCapability }),
      /PORTFOLIO_WORKER_SIGNAL_BINDING_MISMATCH/
    );

    const acknowledged = dispatch.workerSignals.acknowledgeSessionStart({ ...binding, capability });
    assert.equal(acknowledged.state, "acknowledged");
    assert.throws(
      () => dispatch.workerSignals.acknowledgeSessionStart({ ...binding, capability }),
      /PORTFOLIO_WORKER_SIGNAL_ACK_REJECTED/
    );
  });

  it("requires ACK before canonical authorization and consumes the worker write right exactly once", () => {
    // Arrange
    const dispatch = createSignalDispatchFixture(fixture);
    const binding = bindingFor(dispatch);
    const capability = dispatch.workerSignals.deriveSessionStartCapabilityForForwarder(binding);

    // Act / Assert
    assert.throws(
      () => dispatch.workerSignals.authorizeCanonicalPacket({ ...binding, capability }),
      /PORTFOLIO_DISPATCH_UNKNOWN/
    );
    dispatch.workerSignals.acknowledgeSessionStart({ ...binding, capability });
    const authorization = dispatch.workerSignals.authorizeCanonicalPacket({ ...binding, capability });
    assert.deepEqual(authorization.binding, binding);
    assert.equal(authorization.packet.execution.adapter, "claude");
    assert.equal("capability" in authorization, false);
    assert.equal(JSON.stringify(authorization).includes(capability), false);
    assert.equal(JSON.stringify(authorization.binding).includes(capability), false);
    assert.equal(fixture.repository.getWorkerSignalForCommand(binding.commandId)?.state, "consumed");
    assert.throws(
      () => dispatch.workerSignals.authorizeCanonicalPacket({ ...binding, capability }),
      /PORTFOLIO_DISPATCH_UNKNOWN/
    );
  });

  it("records the actual receipt only after a consumed authorization and replays that receipt idempotently", () => {
    // Arrange
    const dispatch = createSignalDispatchFixture(fixture);
    const binding = bindingFor(dispatch);
    const capability = dispatch.workerSignals.deriveSessionStartCapabilityForForwarder(binding);
    dispatch.workerSignals.acknowledgeSessionStart({ ...binding, capability });
    const authorization = dispatch.workerSignals.authorizeCanonicalPacket({ ...binding, capability });

    // Act
    const first = dispatch.workerSignals.recordDispatchReceipt({
      ...authorization,
      receiptDigest: "sha256:actual-worker-write-receipt",
      idempotencyKey: "receipt:worker-signal"
    });
    const replay = dispatch.workerSignals.recordDispatchReceipt({
      ...authorization,
      receiptDigest: "sha256:actual-worker-write-receipt",
      idempotencyKey: "receipt:worker-signal"
    });

    // Assert
    assert.equal(first.receiptRecorded, true);
    assert.equal(replay.receiptRecorded, true);
    assert.equal(first.command.state, "observed");
    assert.equal(first.attempt.state, "running");
    assert.equal(replay.command.id, first.command.id);
  });
});
