import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createAuthorizationPolicy } from "../src/services/portfolio/authorization-policy.js";
import { createExecutionService, type WorkerLaunchPort } from "../src/services/portfolio/execution-service.js";
import { createPlatformToolManifestService } from "../src/services/portfolio/platform-tool-manifest.js";
import { createTaskPacketService } from "../src/services/portfolio/task-packet-service.js";
import { createWorkerSignalService } from "../src/services/portfolio/worker-signal-service.js";
import {
  createPortfolioPhase4Fixture,
  mutateWorkItemForPacketDrift,
  type PortfolioPhase4Fixture
} from "./portfolio-phase4-fixture.js";

interface DispatchFixture {
  fixture: PortfolioPhase4Fixture;
  execute: ReturnType<typeof createExecutionService>;
  workerSignals: ReturnType<typeof createWorkerSignalService>;
  attemptId: string;
  attemptProjectionVersion: number;
  assignmentId: string;
  assignmentProjectionVersion: number;
  leaseToken: string;
}

function createDispatchFixture(
  fixture: PortfolioPhase4Fixture,
  preauthorizePacketSubmit = true,
  workerLaunchPort?: WorkerLaunchPort
): DispatchFixture {
  const packets = createTaskPacketService(fixture.repository, createPlatformToolManifestService());
  const prepared = packets.prepareAttempt({
    projectId: fixture.projectId,
    workItemId: fixture.workItem.id,
    adapter: "claude",
    createdBy: fixture.owner.id,
    skillVersion: "portfolio-execution/v1",
    toolIds: ["portfolio.submit_canonical_task_packet"],
    idempotencyKey: "attempt:execution-service"
  });
  const assignment = fixture.repository.claimSessionAssignment({
    projectId: fixture.projectId,
    workItemId: fixture.workItem.id,
    attemptId: prepared.attempt.id,
    sessionId: fixture.session.id,
    adapter: "claude",
    leaseDurationMs: 60_000,
    now: new Date()
  });
  const workerSignals = createWorkerSignalService({
    repository: fixture.repository,
    capabilitySecret: "phase4-test-worker-capability-secret"
  });
  const execute = createExecutionService({
    repository: fixture.repository,
    packetService: packets,
    authorizationPolicy: createAuthorizationPolicy({
      preauthorizedActionClasses: preauthorizePacketSubmit ? ["packet_submit"] : []
    }),
    workerSignals,
    ...(workerLaunchPort ? { workerLaunchPort } : {})
  });
  return {
    fixture,
    execute,
    workerSignals,
    attemptId: prepared.attempt.id,
    attemptProjectionVersion: prepared.attempt.projectionVersion,
    assignmentId: assignment.id,
    assignmentProjectionVersion: assignment.projectionVersion,
    leaseToken: assignment.leaseToken
  };
}

function prepareDispatchInput(dispatch: DispatchFixture, idempotencyKey: string) {
  return {
    projectId: dispatch.fixture.projectId,
    workItemId: dispatch.fixture.workItem.id,
    attemptId: dispatch.attemptId,
    sessionId: dispatch.fixture.session.id,
    assignmentId: dispatch.assignmentId,
    leaseToken: dispatch.leaseToken,
    expectedAttemptProjectionVersion: dispatch.attemptProjectionVersion,
    expectedAssignmentProjectionVersion: dispatch.assignmentProjectionVersion,
    idempotencyKey,
    expiresAt: new Date("2099-08-15T00:10:00.000Z")
  };
}

function pendingCommandCount(fixture: PortfolioPhase4Fixture): number {
  return (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_commands").get() as { count: number }).count;
}

function dispatchDurableCounts(fixture: PortfolioPhase4Fixture): {
  actions: number;
  authorizations: number;
  commands: number;
  signals: number;
} {
  return {
    actions: (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_action_intents").get() as { count: number }).count,
    authorizations: (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_execution_authorizations").get() as { count: number }).count,
    commands: (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_commands").get() as { count: number }).count,
    signals: (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_worker_signals").get() as { count: number }).count
  };
}

describe("PortfolioExecutionService", () => {
  let fixture: PortfolioPhase4Fixture;

  beforeEach(() => {
    // Arrange
    fixture = createPortfolioPhase4Fixture();
  });

  afterEach(() => {
    fixture.db.close();
  });

  it("fails closed before creating a command when the prepared packet source drifts", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture);
    mutateWorkItemForPacketDrift(fixture);

    // Act / Assert
    assert.throws(
      () => dispatch.execute.prepareDispatch(prepareDispatchInput(dispatch, "dispatch:packet-drift")),
      /PORTFOLIO_PACKET_DRIFT/
    );
    assert.equal(pendingCommandCount(fixture), 0);
    assert.equal(fixture.repository.getTaskAttempt(dispatch.attemptId)?.state, "prepared");
  });

  it("rejects a stale lease token before it creates an idempotent dispatch command", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture);

    // Act / Assert
    assert.throws(
      () => dispatch.execute.prepareDispatch({
        ...prepareDispatchInput(dispatch, "dispatch:stale-lease"),
        leaseToken: "replaced-lease-token"
      }),
      /PORTFOLIO_LEASE_MISMATCH/
    );
    assert.equal(pendingCommandCount(fixture), 0);
    assert.equal(fixture.repository.getTaskAttempt(dispatch.attemptId)?.state, "prepared");
  });

  it("rejects a pre-renewal lease generation before it creates a command", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture);
    const renewed = fixture.repository.renewSessionAssignment({
      assignmentId: dispatch.assignmentId,
      leaseToken: dispatch.leaseToken,
      expectedProjectionVersion: dispatch.assignmentProjectionVersion,
      leaseDurationMs: 60_000,
      now: new Date()
    });

    // Act / Assert
    assert.equal(renewed.leaseGeneration, 2);
    assert.throws(
      () => dispatch.execute.prepareDispatch(prepareDispatchInput(dispatch, "dispatch:stale-generation")),
      /PORTFOLIO_LEASE_MISMATCH/
    );
    assert.equal(pendingCommandCount(fixture), 0);
  });

  it("fails closed on an expired assignment lease before it creates a command", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture);
    fixture.db.prepare("UPDATE portfolio_session_assignments SET lease_expires_at = ? WHERE id = ?")
      .run(Date.now() - 1, dispatch.assignmentId);

    // Act / Assert
    assert.throws(
      () => dispatch.execute.prepareDispatch(prepareDispatchInput(dispatch, "dispatch:expired-lease")),
      /PORTFOLIO_LEASE_MISMATCH/
    );
    assert.equal(pendingCommandCount(fixture), 0);
  });

  it("records one atomic preauthorized dispatch intent and returns its idempotent replay without a raw capability", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture);
    const input = prepareDispatchInput(dispatch, "dispatch:atomic-replay");

    // Act
    const first = dispatch.execute.prepareDispatch(input);
    const replay = dispatch.execute.prepareDispatch(input);

    // Assert
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.command.id, first.command.id);
    assert.equal(first.command.assignmentId, dispatch.assignmentId);
    assert.equal(first.command.actionIntentId, first.actionIntent.id);
    assert.equal(first.command.authorizationId, first.authorization.id);
    assert.equal(first.authorization.state, "consumed");
    assert.equal(fixture.repository.getTaskAttempt(dispatch.attemptId)?.state, "dispatching");
    assert.equal("capability" in first.expectedSignal, false);
    assert.equal(pendingCommandCount(fixture), 1);
  });

  it("rolls back all dispatch records when expected-signal persistence fails", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture);
    const before = dispatchDurableCounts(fixture);
    fixture.db.exec(`CREATE TRIGGER fail_expected_worker_signal
      BEFORE INSERT ON portfolio_worker_signals
      BEGIN
        SELECT RAISE(ABORT, 'forced expected worker signal persistence failure');
      END;`);

    // Act / Assert
    assert.throws(
      () => dispatch.execute.prepareDispatch(prepareDispatchInput(dispatch, "dispatch:atomic-rollback")),
      /forced expected worker signal persistence failure/
    );
    assert.deepEqual(dispatchDurableCounts(fixture), before);
    assert.equal(fixture.repository.getTaskAttempt(dispatch.attemptId)?.state, "prepared");
  });

  it("replays the same dispatch idempotency key after wall-clock time advances", async () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture);
    const input = prepareDispatchInput(dispatch, "dispatch:time-separated-replay");
    const first = dispatch.execute.prepareDispatch(input);

    // Act: ensure the service cannot rely on two calls sharing a clock millisecond.
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const replay = dispatch.execute.prepareDispatch(input);

    // Assert
    assert.equal(replay.replayed, true);
    assert.equal(replay.command.id, first.command.id);
    assert.equal(pendingCommandCount(fixture), 1);
  });

  it("issues worker launch material only through the internal port and only once across replay DTOs", async () => {
    // Arrange
    const launched: Array<{ commandId: string; workerAckCapability: string }> = [];
    const dispatch = createDispatchFixture(fixture, true, {
      launch: async ({ prepared, material }) => {
        launched.push({ commandId: prepared.command.id, workerAckCapability: material.workerAckCapability });
      }
    });
    const input = prepareDispatchInput(dispatch, "dispatch:single-worker-launch");
    const first = dispatch.execute.prepareDispatch(input);
    const replay = dispatch.execute.prepareDispatch(input);

    // Act
    await dispatch.execute.launchPreparedDispatch(first);

    // Assert
    assert.equal("workerAckCapability" in first, false);
    assert.equal("prepareWorkerLaunch" in dispatch.execute, false);
    assert.deepEqual(launched.map((launch) => launch.commandId), [first.command.id]);
    assert.match(launched[0]?.workerAckCapability ?? "", /^[a-f0-9]{64}$/iu);
    assert.ok(fixture.repository.getWorkerSignalForCommand(first.command.id)?.launchIssuedAt);
    await assert.rejects(
      () => dispatch.execute.launchPreparedDispatch(first),
      /PORTFOLIO_WORKER_LAUNCH_UNKNOWN/
    );
    await assert.rejects(
      () => dispatch.execute.launchPreparedDispatch(replay),
      /PORTFOLIO_WORKER_LAUNCH_UNKNOWN/
    );
    assert.equal(launched.length, 1);
  });

  it("maps a worker launch-port crash to unknown and never retries the claimed command", async () => {
    // Arrange
    let attempts = 0;
    const dispatch = createDispatchFixture(fixture, true, {
      launch: async () => {
        attempts += 1;
        throw new Error("simulated startup port crash");
      }
    });
    const prepared = dispatch.execute.prepareDispatch(prepareDispatchInput(dispatch, "dispatch:launch-port-crash"));

    // Act / Assert
    await assert.rejects(
      () => dispatch.execute.launchPreparedDispatch(prepared),
      /PORTFOLIO_WORKER_LAUNCH_UNKNOWN/
    );
    await assert.rejects(
      () => dispatch.execute.launchPreparedDispatch(prepared),
      /PORTFOLIO_WORKER_LAUNCH_UNKNOWN/
    );
    assert.equal(attempts, 1);
    assert.ok(fixture.repository.getWorkerSignalForCommand(prepared.command.id)?.launchIssuedAt);
  });

  it("rejects a semantically different dispatch payload for an already-used idempotency key", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture);
    const input = prepareDispatchInput(dispatch, "dispatch:payload-idempotency-conflict");
    dispatch.execute.prepareDispatch(input);

    // Act / Assert
    assert.throws(
      () => dispatch.execute.prepareDispatch({
        ...input,
        expiresAt: new Date("2099-08-15T00:11:00.000Z")
      }),
      /PORTFOLIO_IDEMPOTENCY_CONFLICT/
    );
    assert.equal(pendingCommandCount(fixture), 1);
  });

  it("creates no command when canonical dispatch has no matching preauthorization", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture, false);

    // Act / Assert
    assert.throws(
      () => dispatch.execute.prepareDispatch(prepareDispatchInput(dispatch, "dispatch:authorization-required")),
      /PORTFOLIO_AUTHORIZATION_REQUIRED/
    );
    assert.equal(pendingCommandCount(fixture), 0);
    assert.equal(fixture.repository.getTaskAttempt(dispatch.attemptId)?.state, "prepared");
  });

  it("requires the exact owner-issued authorization to be approved and consumed before owner-tier dispatch", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture, false);
    const expiresAt = new Date("2099-08-15T00:10:00.000Z");
    const ownerIssued = dispatch.execute.prepareOwnerAuthorization({
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      attemptId: dispatch.attemptId,
      sessionId: fixture.session.id,
      assignmentId: dispatch.assignmentId,
      leaseToken: dispatch.leaseToken,
      idempotencyKey: "owner-authorization:dispatch",
      expiresAt
    });
    const input = {
      ...prepareDispatchInput(dispatch, "dispatch:owner-confirmed"),
      expiresAt,
      authorizationId: ownerIssued.authorization.id
    };

    // Act / Assert
    assert.equal(ownerIssued.authorization.authorizationTier, "owner_confirmation");
    assert.equal(ownerIssued.authorization.state, "awaiting_owner");
    assert.throws(
      () => dispatch.execute.prepareDispatch(input),
      /PORTFOLIO_AUTHORIZATION_SCOPE_MISMATCH/
    );
    const approved = fixture.repository.approveAuthorization({
      authorizationId: ownerIssued.authorization.id,
      expectedProjectionVersion: ownerIssued.authorization.projectionVersion,
      actionDigest: ownerIssued.authorization.actionDigest,
      actorId: fixture.owner.id
    });
    const gate = fixture.repository.createStateGate();
    gate.transition({
      recordType: "authorization",
      recordId: approved.id,
      toState: "consumed",
      expectedProjectionVersion: approved.projectionVersion,
      actorId: fixture.owner.id,
      idempotencyKey: "owner-authorization:consume"
    });
    const prepared = dispatch.execute.prepareDispatch(input);
    assert.equal(prepared.authorization.id, ownerIssued.authorization.id);
    assert.equal(prepared.authorization.state, "consumed");
    assert.equal(prepared.actionIntent.id, ownerIssued.actionIntent.id);
  });

  it("never preauthorizes a protected raw terminal action", () => {
    // Arrange
    const policy = createAuthorizationPolicy({ preauthorizedActionClasses: ["raw_terminal_input"] });
    const issuedAt = new Date("2026-08-15T00:00:00.000Z");

    // Act / Assert
    assert.throws(
      () => policy.requirePreauthorization({
        userId: fixture.owner.id,
        projectId: fixture.projectId,
        workItemId: fixture.workItem.id,
        attemptId: "attempt:protected",
        sessionId: fixture.session.id,
        actionClass: "raw_terminal_input",
        resourceScope: { rawTerminalInput: "untrusted browser data" },
        packetDigest: "sha256:packet",
        assignmentLeaseTokenDigest: "sha256:lease",
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 60_000)
      }),
      /PORTFOLIO_PROTECTED_ACTION/
    );
  });

  it("binds authorization tier and digest to the exact canonical action", () => {
    // Arrange
    const issuedAt = new Date("2026-08-15T00:00:00.000Z");
    const baseAction = {
      userId: fixture.owner.id,
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      attemptId: "attempt:authorization-digest",
      sessionId: fixture.session.id,
      actionClass: "packet_submit",
      resourceScope: { toolId: "portfolio.submit_canonical_task_packet" },
      packetDigest: "sha256:canonical-packet-a",
      assignmentLeaseTokenDigest: "sha256:lease-a",
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 60_000)
    };
    const preauthorized = createAuthorizationPolicy({ preauthorizedActionClasses: ["packet_submit"] });
    const ownerGated = createAuthorizationPolicy();

    // Act
    const first = preauthorized.requirePreauthorization(baseAction);
    const changedPacket = preauthorized.classify({ ...baseAction, packetDigest: "sha256:canonical-packet-b" });
    const changedScope = preauthorized.classify({
      ...baseAction,
      resourceScope: { toolId: "portfolio.submit_canonical_task_packet", target: "another-resource" }
    });

    // Assert
    assert.equal(first.tier, "preauthorized");
    assert.notEqual(changedPacket.action.digest, first.action.digest);
    assert.notEqual(changedScope.action.digest, first.action.digest);
    assert.throws(
      () => ownerGated.requirePreauthorization(baseAction),
      /PORTFOLIO_AUTHORIZATION_REQUIRED/
    );
    assert.throws(
      () => preauthorized.requirePreauthorization({
        ...baseAction,
        actionClass: "packet_submit",
        resourceScope: { rawTerminalInput: "browser text must not share packet authority" }
      }),
      /PORTFOLIO_PROTECTED_ACTION/
    );
  });

  it("marks a receipt-persistence crash unknown and never re-authorizes a second packet write", () => {
    // Arrange
    const dispatch = createDispatchFixture(fixture);
    const input = prepareDispatchInput(dispatch, "dispatch:receipt-crash");
    const prepared = dispatch.execute.prepareDispatch(input);
    const binding = {
      commandId: prepared.command.id,
      assignmentId: prepared.assignment.id,
      attemptId: dispatch.attemptId,
      sessionId: fixture.session.id,
      adapter: "claude",
      leaseGeneration: prepared.assignment.leaseGeneration,
      packetDigest: prepared.command.payloadDigest
    };
    const capability = dispatch.workerSignals.deriveSessionStartCapabilityForForwarder(binding);
    dispatch.workerSignals.acknowledgeSessionStart({ ...binding, capability });
    fixture.db.exec(`CREATE TRIGGER fail_portfolio_dispatch_receipt
      BEFORE UPDATE ON portfolio_commands
      WHEN NEW.dispatch_receipt_digest IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'forced receipt persistence crash');
      END;`);

    const authorization = dispatch.workerSignals.authorizeCanonicalPacket({ ...binding, capability });

    // Act / Assert
    assert.throws(
      () => dispatch.execute.recordWorkerDispatchReceipt({
        ...authorization,
        receiptDigest: "sha256:receipt-after-worker-write",
        idempotencyKey: "receipt:forced-crash"
      }),
      /forced receipt persistence crash/
    );
    assert.throws(
      () => dispatch.workerSignals.authorizeCanonicalPacket({ ...binding, capability }),
      /PORTFOLIO_DISPATCH_UNKNOWN/
    );
    const replay = dispatch.execute.prepareDispatch(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.command.id, prepared.command.id);
    assert.equal(pendingCommandCount(fixture), 1);
    assert.equal(fixture.repository.getWorkerSignalForCommand(prepared.command.id)?.state, "consumed");
    assert.equal(fixture.repository.getCommand(prepared.command.id)?.state, "awaiting_readiness");
  });
});
