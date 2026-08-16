import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type Database from "better-sqlite3";

import { createPlatformToolManifestService } from "../src/services/portfolio/platform-tool-manifest.js";
import { createTaskPacketService } from "../src/services/portfolio/task-packet-service.js";
import {
  createPortfolioPhase4Fixture,
  mutateWorkItemForPacketDrift,
  type PortfolioPhase4Fixture
} from "./portfolio-phase4-fixture.js";

interface AttemptRow {
  id: string;
  packet_digest: string;
  packet_version: number;
  source_work_item_version: number;
  state: string;
}

const executableSelection: { skillVersion: string; toolIds: string[] } = {
  skillVersion: "portfolio-execution/v1",
  toolIds: ["portfolio.submit_canonical_task_packet"]
};

function persistentPrepareAttemptKey(idempotencyKey: string): string {
  return `prepare-attempt:${idempotencyKey}`;
}

function preparedAttempt(db: Database.Database, idempotencyKey: string): AttemptRow {
  const row = db.prepare(`SELECT id, packet_digest, packet_version, source_work_item_version, state
    FROM portfolio_task_attempts WHERE idempotency_key = ?`).get(persistentPrepareAttemptKey(idempotencyKey)) as AttemptRow | undefined;
  assert.ok(row, `the prepared attempt for ${idempotencyKey} must be durable`);
  return row;
}

describe("Portfolio Task Packet", () => {
  let fixture: PortfolioPhase4Fixture;

  beforeEach(() => {
    // Arrange
    fixture = createPortfolioPhase4Fixture();
  });

  afterEach(() => {
    fixture.db.close();
  });

  it("reuses one immutable prepared attempt and rebuilds the same canonical packet", () => {
    // Arrange
    const manifest = createPlatformToolManifestService();
    const packets = createTaskPacketService(fixture.repository, manifest);
    const input = {
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      adapter: "claude",
      createdBy: fixture.owner.id,
      ...executableSelection,
      idempotencyKey: "attempt:deterministic-packet"
    };

    // Act
    const first = packets.prepareAttempt(input);
    const replay = packets.prepareAttempt(input);
    const attempt = preparedAttempt(fixture.db, input.idempotencyKey);
    const rebuilt = packets.rebuild({
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      adapter: "claude",
      ...executableSelection
    });
    const validated = packets.validateAttempt(attempt.id);

    // Assert
    assert.equal(attempt.state, "prepared");
    assert.equal(attempt.packet_version, 1);
    assert.equal(attempt.source_work_item_version, fixture.workItem.projectionVersion);
    assert.match(attempt.packet_digest, /^[a-f0-9]{64}$/);
    assert.equal(replay.attempt.id, first.attempt.id);
    assert.equal(first.packet.packetDigest, attempt.packet_digest);
    assert.deepEqual(first.packet.canonicalPacket, rebuilt);
    assert.deepEqual(validated, rebuilt);
    assert.equal(
      (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_attempts WHERE idempotency_key = ?")
        .get(persistentPrepareAttemptKey(input.idempotencyKey)) as { count: number }).count,
      1
    );
  });

  it("rejects a different packet payload for the same idempotency key without replacing history", () => {
    // Arrange
    const packets = createTaskPacketService(fixture.repository, createPlatformToolManifestService());
    const input = {
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      adapter: "claude",
      createdBy: fixture.owner.id,
      ...executableSelection,
      idempotencyKey: "attempt:packet-idempotency-conflict"
    };
    const first = packets.prepareAttempt(input);

    // Act / Assert
    assert.throws(
      () => packets.prepareAttempt({ ...input, adapter: "opencode" }),
      /PORTFOLIO_IDEMPOTENCY_CONFLICT/
    );
    assert.equal(preparedAttempt(fixture.db, input.idempotencyKey).id, first.attempt.id);
    assert.equal(
      (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_packets WHERE work_item_id = ?")
        .get(fixture.workItem.id) as { count: number }).count,
      1
    );
  });

  it("rolls back packet history when creation of its paired attempt fails", () => {
    // Arrange
    const packets = createTaskPacketService(fixture.repository, createPlatformToolManifestService());
    const beforePackets = (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_packets").get() as { count: number }).count;
    const beforeAttempts = (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_attempts").get() as { count: number }).count;
    fixture.db.exec(`CREATE TRIGGER fail_paired_task_attempt
      BEFORE INSERT ON portfolio_task_attempts
      WHEN NEW.idempotency_key = 'prepare-attempt:attempt:packet-attempt-atomicity'
      BEGIN
        SELECT RAISE(ABORT, 'forced task-attempt persistence failure');
      END;`);

    // Act / Assert
    assert.throws(
      () => packets.prepareAttempt({
        projectId: fixture.projectId,
        workItemId: fixture.workItem.id,
        adapter: "claude",
        createdBy: fixture.owner.id,
        ...executableSelection,
        idempotencyKey: "attempt:packet-attempt-atomicity"
      }),
      /forced task-attempt persistence failure/
    );
    assert.equal(
      (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_packets").get() as { count: number }).count,
      beforePackets
    );
    assert.equal(
      (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_attempts").get() as { count: number }).count,
      beforeAttempts
    );
  });

  it("collapses an interleaved retry with the same key into one packet-attempt pair", () => {
    // Arrange
    const repository = fixture.repository;
    const input = {
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      adapter: "claude",
      createdBy: fixture.owner.id,
      ...executableSelection,
      idempotencyKey: "attempt:packet-interleaved-retry"
    };
    const originalPrepareAttempt = repository.prepareTaskAttempt.bind(repository);
    let packets!: ReturnType<typeof createTaskPacketService>;
    let nestedAttemptId: string | undefined;
    let enteredRetry = false;
    repository.prepareTaskAttempt = ((attemptInput: Parameters<typeof repository.prepareTaskAttempt>[0]) => {
      if (!enteredRetry) {
        enteredRetry = true;
        nestedAttemptId = packets.prepareAttempt(input).attempt.id;
      }
      return originalPrepareAttempt(attemptInput);
    }) as typeof repository.prepareTaskAttempt;
    packets = createTaskPacketService(repository, createPlatformToolManifestService());

    // Act
    let outer: ReturnType<typeof packets.prepareAttempt>;
    try {
      outer = packets.prepareAttempt(input);
    } finally {
      repository.prepareTaskAttempt = originalPrepareAttempt;
    }

    // Assert
    assert.equal(nestedAttemptId, outer!.attempt.id);
    assert.equal(
      (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_packets WHERE work_item_id = ?")
        .get(fixture.workItem.id) as { count: number }).count,
      1
    );
    assert.equal(
      (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_attempts WHERE work_item_id = ?")
        .get(fixture.workItem.id) as { count: number }).count,
      1
    );
  });

  it("fails closed when a source Work Item changes after preparation", () => {
    // Arrange
    const packets = createTaskPacketService(fixture.repository, createPlatformToolManifestService());
    const idempotencyKey = "attempt:packet-source-drift";
    packets.prepareAttempt({
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      adapter: "claude",
      createdBy: fixture.owner.id,
      ...executableSelection,
      idempotencyKey
    });
    const prepared = preparedAttempt(fixture.db, idempotencyKey);
    mutateWorkItemForPacketDrift(fixture);

    // Act / Assert
    assert.throws(() => packets.validateAttempt(prepared.id), /PORTFOLIO_PACKET_DRIFT/);
    const retained = preparedAttempt(fixture.db, idempotencyKey);
    assert.equal(retained.packet_digest, prepared.packet_digest);
    assert.equal(retained.source_work_item_version, prepared.source_work_item_version);
    assert.equal(retained.state, "prepared");
  });

  it("rejects every persisted packet-history mutation before validation", () => {
    // Arrange
    const packets = createTaskPacketService(fixture.repository, createPlatformToolManifestService());
    const prepared = packets.prepareAttempt({
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      adapter: "claude",
      createdBy: fixture.owner.id,
      ...executableSelection,
      idempotencyKey: "attempt:packet-history-tamper"
    });

    // Act / Assert
    assert.throws(
      () => fixture.db.prepare("UPDATE portfolio_task_packets SET manifest_digest = ? WHERE id = ?")
        .run("sha256:tampered-manifest", prepared.packet.id),
      /PORTFOLIO_TASK_PACKET_IMMUTABLE/
    );
    assert.throws(
      () => fixture.db.prepare("UPDATE portfolio_task_packets SET canonical_packet_json = ? WHERE id = ?")
        .run("{}", prepared.packet.id),
      /PORTFOLIO_TASK_PACKET_IMMUTABLE/
    );
    assert.doesNotThrow(() => packets.validateAttempt(prepared.attempt.id));
  });

  it("rejects raw shell text instead of widening packet authority", () => {
    // Arrange
    const manifest = createPlatformToolManifestService();

    // Act / Assert
    assert.throws(
      () => manifest.select({ rawShellText: "rm -rf /" }),
      /PORTFOLIO_RAW_SHELL_REJECTED/
    );
  });

  it("requires an explicit executable skill and registered dispatch tool before preparation or rebuild", () => {
    // Arrange
    const packets = createTaskPacketService(fixture.repository, createPlatformToolManifestService());
    const base = {
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      adapter: "claude",
      createdBy: fixture.owner.id,
      ...executableSelection,
      idempotencyKey: "attempt:executable-contract"
    };
    const withoutSkillVersion: Record<string, unknown> = { ...base };
    delete withoutSkillVersion.skillVersion;

    // Act / Assert
    assert.throws(
      () => packets.prepareAttempt(withoutSkillVersion as unknown as Parameters<typeof packets.prepareAttempt>[0]),
      /PORTFOLIO_EXECUTABLE_SKILL_REQUIRED/
    );
    assert.throws(
      () => packets.prepareAttempt({ ...base, skillVersion: null } as unknown as Parameters<typeof packets.prepareAttempt>[0]),
      /PORTFOLIO_EXECUTABLE_SKILL_REQUIRED/
    );
    assert.throws(
      () => packets.prepareAttempt({ ...base, toolIds: [] }),
      /PORTFOLIO_EXECUTABLE_TOOLS_REQUIRED/
    );
    assert.throws(
      () => packets.prepareAttempt({ ...base, toolIds: ["portfolio.bounded_observation"] }),
      /PORTFOLIO_EXECUTABLE_TOOL_UNREGISTERED/
    );
    assert.throws(
      () => packets.rebuild({
        projectId: fixture.projectId,
        workItemId: fixture.workItem.id,
        adapter: "claude"
      } as unknown as Parameters<typeof packets.rebuild>[0]),
      /PORTFOLIO_EXECUTABLE_SKILL_REQUIRED/
    );
    assert.equal(
      (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_packets").get() as { count: number }).count,
      0
    );
    assert.equal(
      (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_attempts").get() as { count: number }).count,
      0
    );
    assert.equal(
      (fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_commands").get() as { count: number }).count,
      0
    );
  });
});
