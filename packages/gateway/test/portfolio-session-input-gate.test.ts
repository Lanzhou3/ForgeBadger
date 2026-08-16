import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LaunchPlan } from "../src/adapters/claude.js";
import type { GateASession } from "../src/services/session-manager.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import type { TmuxClient } from "../src/services/tmux.js";
import type { CanonicalTaskPacket } from "../src/services/portfolio/task-packet-service.js";
import type { WorkerDispatchAuthorization } from "../src/services/portfolio/worker-contract.js";
import {
  PortfolioSessionInputGate,
  type PortfolioSessionAssignment,
  type PortfolioWorkerInputCapability,
  type PortfolioWorkerWriteRequest
} from "../src/services/portfolio/session-input-gate.js";

const workerAckCapability = "worker-ack-capability-only";

function session(): GateASession {
  return {
    id: "session:active",
    userId: "user:active",
    attachToken: "browser-attach-token-must-not-authorize-worker-input",
    tmuxName: "of-portfolio-session-gate",
    launchPlan: {
      command: "claude",
      args: [],
      cwd: "/tmp/openforge-portfolio-session-gate",
      env: {},
      secretEnvNames: [],
      credentialMode: "host_environment"
    },
    status: "running",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z"
  };
}

function activeAssignment(): PortfolioSessionAssignment {
  return {
    id: "assignment:active",
    projectId: "project:active",
    workItemId: "work-item:active",
    attemptId: "attempt:active",
    sessionId: "session:active",
    adapter: "claude",
    leaseGeneration: 2,
    leaseExpiresAt: new Date("2026-08-15T00:05:00.000Z"),
    active: true
  };
}

function workerWriteRequest(assignment = activeAssignment()): PortfolioWorkerWriteRequest {
  return {
    userId: "user:active",
    projectId: assignment.projectId,
    workItemId: assignment.workItemId,
    attemptId: assignment.attemptId,
    sessionId: assignment.sessionId,
    assignmentId: assignment.id,
    adapter: assignment.adapter,
    leaseGeneration: assignment.leaseGeneration,
    packetDigest: "a".repeat(64),
    commandId: "command:active"
  };
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

function gate(assignment: PortfolioSessionAssignment | undefined, authorizes = true): PortfolioSessionInputGate {
  return new PortfolioSessionInputGate(
    {
      findActiveAssignment: ({ userId, sessionId }) => (
        userId === "user:active" && sessionId === "session:active" ? assignment : undefined
      )
    },
    {
      authorizeCanonicalPacket: (input, suppliedWorkerAckCapability) => {
        if (!authorizes || suppliedWorkerAckCapability !== workerAckCapability) {
          throw new Error("worker signal does not authorize the packet");
        }
        return workerAuthorization(input);
      }
    }
  );
}

function launchPlan(): LaunchPlan {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp/openforge-portfolio-session-gate",
    env: {},
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

describe("PortfolioSessionInputGate", () => {
  it("keeps browser and legacy direct writers outside an active Portfolio assignment", () => {
    // Arrange
    const activeSession = session();
    const inputGate = gate(activeAssignment());

    // Act / Assert
    assert.throws(() => inputGate.assertBrowserInputAllowed(activeSession), /PORTFOLIO_WRITER_FENCE_REJECTED/);
    assert.throws(() => inputGate.assertDirectInputAllowed(activeSession), /PORTFOLIO_WRITER_FENCE_REJECTED/);
  });

  it("preserves ordinary terminal access when the session has no active assignment", () => {
    // Arrange
    const activeSession = session();
    const inputGate = gate(undefined);

    // Act / Assert
    assert.doesNotThrow(() => inputGate.assertBrowserInputAllowed(activeSession));
    assert.doesNotThrow(() => inputGate.assertDirectInputAllowed(activeSession));
  });

  it("permits exactly one assignment-bound worker write and rejects its replay", () => {
    // Arrange
    const assignment = activeAssignment();
    const activeSession = session();
    const inputGate = gate(assignment);
    const capability = inputGate.issueWorkerInputCapability(workerWriteRequest(assignment), workerAckCapability);

    // Act / Assert
    assert.doesNotThrow(() => inputGate.assertWorkerInputAllowed(activeSession, capability));
    assert.throws(
      () => inputGate.assertWorkerInputAllowed(activeSession, capability),
      /PORTFOLIO_WRITER_FENCE_REJECTED/
    );
  });

  it("rejects stale assignment generations and a forged attach-token lookalike before input", () => {
    // Arrange
    const assignment = activeAssignment();
    const inputGate = gate(assignment);
    const stale = { ...workerWriteRequest(assignment), leaseGeneration: assignment.leaseGeneration - 1 };
    const attachTokenLookalike = {
      kind: "portfolio_worker_input",
      attachToken: session().attachToken
    } as unknown as PortfolioWorkerInputCapability;

    // Act / Assert
    assert.throws(
      () => inputGate.issueWorkerInputCapability(stale, workerAckCapability),
      /PORTFOLIO_WRITER_FENCE_REJECTED/
    );
    assert.throws(
      () => inputGate.assertWorkerInputAllowed(session(), attachTokenLookalike),
      /PORTFOLIO_WRITER_FENCE_REJECTED/
    );
  });

  it("fails closed when the durable worker-signal authorization rejects the packet binding", () => {
    // Arrange
    const inputGate = gate(activeAssignment(), false);

    // Act / Assert
    assert.throws(
      () => inputGate.issueWorkerInputCapability(workerWriteRequest()),
      /PORTFOLIO_WRITER_FENCE_REJECTED/
    );
  });

  it("rejects missing and attach-token lookalike worker ACK capabilities before issuing input rights", () => {
    // Arrange
    const inputGate = gate(activeAssignment());

    // Act / Assert
    assert.throws(
      () => inputGate.issueWorkerInputCapability(workerWriteRequest()),
      /PORTFOLIO_WRITER_FENCE_REJECTED/
    );
    assert.throws(
      () => inputGate.issueWorkerInputCapability(workerWriteRequest(), session().attachToken),
      /PORTFOLIO_WRITER_FENCE_REJECTED/
    );
  });

  it("blocks direct session-manager input but permits one gate-issued worker write", async () => {
    // Arrange
    const assignment = activeAssignment();
    const inputGate = gate(assignment);
    const writes: string[] = [];
    const tmux: TmuxClient = {
      async createSession() {},
      async killSession() {},
      async capturePane() { return ""; },
      async listSessions() { return []; },
      async hasSession() { return true; },
      async showEnvironment() { return {}; },
      async sendInput(_name, data) { writes.push(data); }
    };
    const manager = new InMemorySessionManager(tmux, undefined, undefined, { sessionInputGate: inputGate });
    const managed = await manager.createSession({
      userId: "user:active",
      sessionId: assignment.sessionId,
      launchPlan: launchPlan()
    });
    const capability = inputGate.issueWorkerInputCapability(workerWriteRequest(assignment), workerAckCapability);

    // Act / Assert
    await assert.rejects(() => manager.sendInput(managed.id, "browser raw input"), /PORTFOLIO_WRITER_FENCE_REJECTED/);
    await manager.sendInput(managed.id, "canonical packet", capability);
    await assert.rejects(
      () => manager.sendInput(managed.id, "replayed canonical packet", capability),
      /PORTFOLIO_WRITER_FENCE_REJECTED/
    );
    assert.deepEqual(writes, ["canonical packet"]);
  });
});
