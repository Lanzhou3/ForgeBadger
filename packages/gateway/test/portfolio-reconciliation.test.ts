import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PortfolioRepository } from "../src/db/repositories/portfolio-repository.js";
import {
  PortfolioSchedulerRepository,
  createPortfolioSchedulerRepositoryFactory,
  type PortfolioReconciliationClaim
} from "../src/db/repositories/portfolio-scheduler-repository.js";
import type { ObservationDraft } from "../src/services/portfolio/observation-contract.js";
import {
  ObservationService,
  type Clock,
  type FixedGitExecutor,
  type ProjectRootValidator
} from "../src/services/portfolio/observation-service.js";
import { PortfolioReconciliationService } from "../src/services/portfolio/reconciliation-service.js";
import {
  activatePortfolioObservationProfile,
  createExecutablePortfolioAttempt,
  createPortfolioPhase4Fixture
} from "./portfolio-phase4-fixture.js";

const now = new Date("2026-08-15T00:00:00.000Z");

/** A mutable injected clock makes lease, retry, and persistence times observable. */
class MutableClock implements Clock {
  constructor(private value: Date) {}

  now(): Date {
    return new Date(this.value);
  }

  set(value: Date): void {
    this.value = value;
  }
}

class FakeRootValidator implements ProjectRootValidator {
  identity = { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 99 };

  validate() {
    return this.identity;
  }
}

class FakeGitExecutor implements FixedGitExecutor {
  readonly calls: Parameters<FixedGitExecutor["execute"]>[0][] = [];
  response = { stdout: "## main\n", stderr: "", exitCode: 0 };

  async execute(input: Parameters<FixedGitExecutor["execute"]>[0]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.calls.push(input);
    return this.response;
  }
}

function hasErrorCode(error: unknown, expected: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === expected;
}

function readCount(db: ReturnType<typeof createPortfolioPhase4Fixture>["db"], table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function createAttempt(input: { trackingEnabled?: boolean; idempotencyKey: string }) {
  // Each scenario gets an isolated migrated SQLite database and tenant.
  const fixture = createPortfolioPhase4Fixture();
  const attempt = createExecutablePortfolioAttempt(fixture.repository, {
    projectId: fixture.projectId,
    workItemId: fixture.workItem.id,
    packetVersion: 1,
    adapter: "claude",
    createdBy: fixture.owner.id,
    trackingEnabled: input.trackingEnabled,
    idempotencyKey: input.idempotencyKey
  });
  const scheduler = new PortfolioSchedulerRepository(fixture.db, fixture.owner.id);
  return { ...fixture, attempt, scheduler };
}

function scheduleWakeup(input: ReturnType<typeof createAttempt>, dueAt = now, suffix = "one") {
  return input.scheduler.scheduleWakeup({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    attemptId: input.attempt.id,
    reasonClass: "forecast_checkpoint",
    dueAt,
    coalescingKey: `coalesce:${suffix}`,
    idempotencyKey: `wakeup:${suffix}`,
    now
  });
}

function observationDraft(projectId: string, source: ObservationDraft["source"], errorCode?: string): ObservationDraft {
  return {
    projectId,
    source,
    observedAt: new Date(now),
    collectedAt: new Date(now),
    digest: `digest:${source}:${errorCode ?? "fresh"}`,
    redactedSummary: errorCode ? `Observation collection failed: ${errorCode}` : "Observation collected",
    freshness: errorCode ? "failed" : "fresh",
    ...(errorCode ? { errorCode } : {})
  };
}

function createReconciliationFixture() {
  // This deliberately composes the real repository, collector, reconciler, and scheduler.
  const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "reconciliation" });
  const clock = new MutableClock(now);
  const rootValidator = new FakeRootValidator();
  const gitExecutor = new FakeGitExecutor();
  activatePortfolioObservationProfile(fixture, rootValidator.identity, now);
  scheduleWakeup(fixture, now, "reconciliation");
  const [claim] = fixture.scheduler.claimDue(now, 20);
  assert.ok(claim);
  const observations = new ObservationService({
    clock,
    projectRootValidator: rootValidator,
    gitExecutor,
    repository: fixture.repository
  });
  const reconciliation = new PortfolioReconciliationService({ clock, scheduler: fixture.scheduler, observations });
  return { ...fixture, clock, rootValidator, gitExecutor, claim, observations, reconciliation };
}

function createObservationEvidence(
  repository: PortfolioRepository,
  input: { projectId: string; source: "platform_lifecycle_v1" | "git_state_v1"; freshness: "fresh" | "stale" | "unknown" | "timeout" | "failed"; observedAt: Date; key: string }
) {
  // Source category is the durable V1 Dossier projection key.
  return repository.createEvidence({
    projectId: input.projectId,
    producer: `portfolio.${input.source}`,
    sourceCategory: input.source,
    observedAt: input.observedAt,
    collectedAt: input.observedAt,
    digest: `digest:${input.key}`,
    summary: `${input.source} ${input.freshness}`,
    confidence: "trusted_platform",
    freshness: input.freshness,
    idempotencyKey: `observation:${input.key}`
  });
}

describe("Portfolio tracking and durable reconciliation", () => {
  it("activates only fixed V1 probes bound to one approved canonical root identity", () => {
    // Arrange
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "observation-profile" });
    const root = { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 99 };

    // Act
    activatePortfolioObservationProfile(fixture, root, now);
    const profile = fixture.repository.getObservationProfile(fixture.projectId);
    const platformProbe = fixture.repository.getObservationProbe(fixture.projectId, "platform_lifecycle_v1");
    const gitProbe = fixture.repository.getObservationProbe(fixture.projectId, "git_state_v1");

    // Assert
    assert.deepEqual(profile?.approvedRoot, root);
    assert.deepEqual(platformProbe && {
      profileId: platformProbe.profileId,
      source: platformProbe.source,
      enabled: platformProbe.enabled,
      rootRef: platformProbe.rootRef,
      timeoutMs: platformProbe.timeoutMs,
      maxOutputBytes: platformProbe.maxOutputBytes,
      freshnessMs: platformProbe.freshnessMs
    }, {
      profileId: profile?.id,
      source: "platform_lifecycle_v1",
      enabled: true,
      rootRef: "project_root",
      timeoutMs: 5_000,
      maxOutputBytes: 16 * 1024,
      freshnessMs: 5 * 60_000
    });
    assert.deepEqual(gitProbe && {
      profileId: gitProbe.profileId,
      source: gitProbe.source,
      enabled: gitProbe.enabled,
      rootRef: gitProbe.rootRef,
      timeoutMs: gitProbe.timeoutMs,
      maxOutputBytes: gitProbe.maxOutputBytes,
      freshnessMs: gitProbe.freshnessMs
    }, {
      profileId: profile?.id,
      source: "git_state_v1",
      enabled: true,
      rootRef: "project_root",
      timeoutMs: 5_000,
      maxOutputBytes: 16 * 1024,
      freshnessMs: 15 * 60_000
    });
  });

  it("defaults tracking to false, only allows creation-time tracking, and refuses untracked Wakeups", () => {
    // Arrange
    const untracked = createAttempt({ idempotencyKey: "untracked" });
    const tracked = createAttempt({ trackingEnabled: true, idempotencyKey: "tracked" });

    // Act
    const trackedWakeup = scheduleWakeup(tracked);

    // Assert
    assert.equal(untracked.attempt.trackingEnabled, false);
    assert.equal(tracked.attempt.trackingEnabled, true);
    assert.throws(() => scheduleWakeup(untracked), (error) => hasErrorCode(error, "PORTFOLIO_WAKEUP_TRACKING_REQUIRED"));
    assert.ok(trackedWakeup.id);
    assert.throws(() => untracked.db.prepare("UPDATE portfolio_task_attempts SET tracking_enabled = 1 WHERE id = ?").run(untracked.attempt.id));
  });

  it("creates and claims tracked Wakeups only through the scheduler ledger, with no raw claim token", () => {
    // Arrange
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "legacy-wakeup" });
    const scheduled = scheduleWakeup(fixture, now, "legacy");

    // Act
    const [claim] = fixture.scheduler.claimDue(now, 1);
    const tokenColumn = fixture.db.prepare("SELECT claim_token FROM portfolio_workflow_wakeups WHERE id = ?")
      .get(scheduled.id) as { claim_token: string | null };

    // Assert
    assert.ok(claim);
    assert.equal(fixture.repository.getWorkflowWakeup(scheduled.id)?.state, "claimed");
    assert.equal(fixture.scheduler.getRun(claim.runId)?.state, "claimed");
    assert.equal(tokenColumn.claim_token, null);
    assert.equal("claimToken" in (scheduled as unknown as Record<string, unknown>), false);
  });

  it("coalesces only compatible pending Wakeups, preserves budget/count, and takes the earlier due time", () => {
    // Arrange
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "coalesce" });
    const later = new Date(now.getTime() + 10 * 60_000);
    const earlier = new Date(now.getTime() + 60_000);
    const first = scheduleWakeup(fixture, later, "same");

    // Act
    const second = fixture.scheduler.scheduleWakeup({
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      attemptId: fixture.attempt.id,
      reasonClass: "forecast_checkpoint",
      dueAt: earlier,
      coalescingKey: "coalesce:same",
      idempotencyKey: "wakeup:same-earlier",
      now
    });

    // Assert
    assert.equal(second.id, first.id);
    assert.equal(second.attemptCount, 0);
    assert.equal(second.maxAttempts, 4);
    assert.equal(second.dueAt.getTime(), earlier.getTime());
  });

  it("enforces ledger source foreign keys and one idempotency slot per source record", () => {
    // Arrange
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "ledger-constraints" });
    const wakeup = scheduleWakeup(fixture);
    const scheduledAt = now.getTime();

    // Act / Assert
    assert.throws(() => fixture.db.prepare(`INSERT INTO portfolio_reconciliation_runs (
      id, user_id, source, source_record_id, idempotency_slot, state, projection_version,
      attempt_count, retry_budget, wakeup_id, scheduled_at, created_at, updated_at
    ) VALUES (?, ?, 'wakeup', ?, 'primary', 'scheduled', 1, 0, 3, ?, ?, ?, ?)`)
      .run("invalid-wakeup-source", fixture.owner.id, "missing-wakeup", "missing-wakeup", scheduledAt, scheduledAt, scheduledAt));
    assert.throws(() => fixture.db.prepare(`INSERT INTO portfolio_reconciliation_runs (
      id, user_id, source, source_record_id, idempotency_slot, state, projection_version,
      attempt_count, retry_budget, wakeup_id, scheduled_at, created_at, updated_at
    ) VALUES (?, ?, 'wakeup', ?, 'primary', 'scheduled', 1, 0, 3, ?, ?, ?, ?)`)
      .run("duplicate-wakeup-slot", fixture.owner.id, wakeup.id, wakeup.id, scheduledAt, scheduledAt, scheduledAt));
  });

  it("allows exactly one ledger claim across competing repositories and keeps legacy Wakeup claim tokens nonauthoritative", () => {
    // Arrange
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "claim-contention" });
    const wakeup = scheduleWakeup(fixture);
    const contender = new PortfolioSchedulerRepository(fixture.db, fixture.owner.id);

    // Act
    const firstClaims = fixture.scheduler.claimDue(now, 20);
    const secondClaims = contender.claimDue(now, 20);
    const stored = fixture.db.prepare("SELECT claim_token FROM portfolio_workflow_wakeups WHERE id = ?").get(wakeup.id) as { claim_token: string | null };

    // Assert
    assert.equal(firstClaims.length, 1);
    assert.equal(secondClaims.length, 0);
    assert.equal(firstClaims[0]?.claimLeaseExpiresAt.getTime(), now.getTime() + 60_000);
    assert.equal("claimToken" in (wakeup as unknown as Record<string, unknown>), false);
    assert.equal(stored.claim_token, null);
  });

  it("limits a repository due-claim call to 20 even when more entries are due", () => {
    // Arrange
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "batch-first" });
    const attempts = [fixture.attempt];
    for (let index = 1; index <= 20; index += 1) {
      attempts.push(createExecutablePortfolioAttempt(fixture.repository, {
        projectId: fixture.projectId,
        workItemId: fixture.workItem.id,
        packetVersion: 1,
        adapter: "claude",
        createdBy: fixture.owner.id,
        trackingEnabled: true,
        idempotencyKey: `batch-attempt:${index}`
      }));
    }
    for (const [index, attempt] of attempts.entries()) {
      fixture.scheduler.scheduleWakeup({
        projectId: fixture.projectId,
        workItemId: fixture.workItem.id,
        attemptId: attempt.id,
        reasonClass: "forecast_checkpoint",
        dueAt: now,
        coalescingKey: `batch:${index}`,
        idempotencyKey: `batch:wakeup:${index}`,
        now
      });
    }

    // Act
    const firstBatch = fixture.scheduler.claimDue(now, 999);
    const secondBatch = fixture.scheduler.claimDue(now, 999);

    // Assert
    assert.equal(firstBatch.length, 20);
    assert.equal(secondBatch.length, 1);
  });

  it("does not let a second scheduler or factory recover an unexpired claim", () => {
    // Arrange: recovery must be fenced by the active claim's durable 60-second lease.
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "live-lease-recovery" });
    const wakeup = scheduleWakeup(fixture);
    const [claimed] = fixture.scheduler.claimDue(now, 20);
    assert.ok(claimed);
    const secondScheduler = new PortfolioSchedulerRepository(fixture.db, fixture.owner.id);
    const factory = createPortfolioSchedulerRepositoryFactory(fixture.db);
    const before = {
      runs: readCount(fixture.db, "portfolio_reconciliation_runs"),
      facts: readCount(fixture.db, "portfolio_facts")
    };

    // Act: both cross-repository recovery entry points observe the live lease at the claim time.
    const recoveredBySecondScheduler = secondScheduler.recoverExpired(now);
    const recoveredByFactory = factory.recoverExpired(now);

    // Assert: no unknown terminal record, successor run, Wakeup mutation, or recovery effect is created before expiry.
    assert.deepEqual(recoveredBySecondScheduler, []);
    assert.deepEqual(recoveredByFactory, []);
    assert.equal(fixture.scheduler.getRun(claimed.runId)?.state, "claimed");
    assert.equal(fixture.scheduler.getRun(claimed.runId)?.claimLeaseExpiresAt?.getTime(), claimed.claimLeaseExpiresAt.getTime());
    assert.equal(fixture.repository.getWorkflowWakeup(wakeup.id)?.state, "claimed");
    assert.deepEqual({
      runs: readCount(fixture.db, "portfolio_reconciliation_runs"),
      facts: readCount(fixture.db, "portfolio_facts")
    }, before);
  });

  it("records unknown before recovery, never reuses the expired claim, and grants the replacement a fresh 60-second lease", () => {
    // Arrange
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "lease-recovery" });
    scheduleWakeup(fixture);
    const [claimed] = fixture.scheduler.claimDue(now, 20);
    assert.ok(claimed);
    const recoveredAt = new Date(now.getTime() + 60_001);

    // Act
    const recovered = fixture.scheduler.recoverExpired(recoveredAt);
    const successors = fixture.scheduler.claimDue(recoveredAt, 20);
    const unknown = fixture.db.prepare("SELECT state FROM portfolio_reconciliation_runs WHERE user_id = ? AND state = 'unknown'").all(fixture.owner.id) as Array<{ state: string }>;

    // Assert
    assert.ok(unknown.length >= 1);
    assert.ok(recovered.every((claim) => claim.claimToken === ""));
    assert.ok(successors.every((claim) => claim.claimToken !== claimed.claimToken));
    assert.ok(successors.every((claim) => claim.claimLeaseExpiresAt.getTime() === recoveredAt.getTime() + 60_000));
  });

  it("uses the fixed three-retry backoff, exhausts after four claims, and does not automatically restart", () => {
    // Arrange
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "retry-budget" });
    activatePortfolioObservationProfile(fixture, { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 99 }, now);
    const wakeup = scheduleWakeup(fixture);
    const expectedDelays = [60_000, 300_000, 1_800_000];
    let claimTime = now;

    // Act
    for (const delay of expectedDelays) {
      const [claim] = fixture.scheduler.claimDue(claimTime, 20);
      assert.ok(claim);
      fixture.scheduler.finalizeClaim({
        claim,
        drafts: [observationDraft(fixture.projectId, "git_state_v1", "PORTFOLIO_OBSERVATION_GIT_FAILED")],
        now: claimTime
      });
      const row = fixture.db.prepare("SELECT state, due_at FROM portfolio_workflow_wakeups WHERE id = ?").get(wakeup.id) as { state: string; due_at: number };
      assert.equal(row.state, "retry_scheduled");
      assert.equal(row.due_at, claimTime.getTime() + delay);
      claimTime = new Date(row.due_at);
    }
    const [fourthClaim] = fixture.scheduler.claimDue(claimTime, 20);
    assert.ok(fourthClaim);
    fixture.scheduler.finalizeClaim({
      claim: fourthClaim,
      drafts: [observationDraft(fixture.projectId, "git_state_v1", "PORTFOLIO_OBSERVATION_GIT_FAILED")],
      now: claimTime
    });

    // Assert
    const exhausted = fixture.db.prepare("SELECT state, attempt_count, last_error_code FROM portfolio_workflow_wakeups WHERE id = ?").get(wakeup.id) as { state: string; attempt_count: number; last_error_code: string | null };
    assert.equal(exhausted.state, "exhausted");
    assert.equal(exhausted.attempt_count, 4);
    assert.equal(exhausted.last_error_code, "PORTFOLIO_OBSERVATION_GIT_FAILED");
    assert.deepEqual(fixture.scheduler.claimDue(new Date(claimTime.getTime() + 86_400_000), 20), []);
  });
});

describe("PortfolioReconciliationService atomic persistence seam", () => {
  it("persists real ObservationService drafts at the fixed clock time without lifecycle mutation", async () => {
    // Arrange
    const fixture = createReconciliationFixture();
    const beforeState = fixture.repository.getWorkItem(fixture.workItem.id)?.state;

    // Act
    const result = await fixture.reconciliation.reconcile(fixture.claim);

    // Assert
    assert.equal(result.status, "completed");
    assert.equal(result.evidence.length, 2);
    assert.equal(fixture.gitExecutor.calls.length, 1);
    assert.ok(result.evidence.every((evidence) => evidence.createdAt.getTime() === now.getTime()));
    assert.equal(fixture.scheduler.getRun(fixture.claim.runId)?.completedAt?.getTime(), now.getTime());
    assert.equal(fixture.repository.getWorkItem(fixture.workItem.id)?.state, beforeState);
    assert.equal(readCount(fixture.db, "portfolio_risk_signals"), 0);
    assert.equal(readCount(fixture.db, "portfolio_commands"), 0);
  });

  it("turns canonical device/inode replacement into durable failure Evidence and Risk without executing Git", async () => {
    // Arrange
    const fixture = createReconciliationFixture();
    fixture.rootValidator.identity = { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 100 };
    const lifecycleBefore = fixture.repository.getWorkItem(fixture.workItem.id)?.state;

    // Act
    const result = await fixture.reconciliation.reconcile(fixture.claim);

    // Assert
    assert.equal(result.status, "retry_scheduled");
    assert.equal(fixture.gitExecutor.calls.length, 0);
    assert.equal(result.evidence.filter((evidence) => evidence.freshness === "failed").length, 2);
    assert.deepEqual(result.evidence.map((evidence) => evidence.sourceCategory).sort(), ["git_state_v1", "platform_lifecycle_v1"]);
    assert.equal(readCount(fixture.db, "portfolio_risk_signals"), 2);
    assert.equal(fixture.scheduler.getRun(fixture.claim.runId)?.errorCode, "PORTFOLIO_OBSERVATION_PROJECT_ROOT_REPLACED");
    assert.equal(fixture.repository.getWorkItem(fixture.workItem.id)?.state, lifecycleBefore);
  });

  it("rejects a lost claim before writing Evidence, Risk, fact, or source projection", async () => {
    // Arrange
    const fixture = createReconciliationFixture();
    const before = {
      evidence: readCount(fixture.db, "portfolio_evidence"),
      risks: readCount(fixture.db, "portfolio_risk_signals"),
      facts: readCount(fixture.db, "portfolio_facts"),
      run: fixture.scheduler.getRun(fixture.claim.runId)?.state,
      wakeup: fixture.repository.getWorkflowWakeup(fixture.claim.sourceRecordId)?.state
    };
    const lostClaim: PortfolioReconciliationClaim = { ...fixture.claim, claimToken: "not-the-ledger-token" };

    // Act / Assert
    await assert.rejects(() => fixture.reconciliation.reconcile(lostClaim), (error) => hasErrorCode(error, "PORTFOLIO_RECONCILIATION_CLAIM_LOST"));
    assert.deepEqual({
      evidence: readCount(fixture.db, "portfolio_evidence"),
      risks: readCount(fixture.db, "portfolio_risk_signals"),
      facts: readCount(fixture.db, "portfolio_facts"),
      run: fixture.scheduler.getRun(fixture.claim.runId)?.state,
      wakeup: fixture.repository.getWorkflowWakeup(fixture.claim.sourceRecordId)?.state
    }, before);
  });

  it("rolls back all Evidence, Risk, fact, run, and Wakeup changes when atomic finalization faults", async () => {
    // Arrange
    const fixture = createReconciliationFixture();
    fixture.gitExecutor.response = { stdout: "", stderr: "forced Git failure", exitCode: 1 };
    const before = {
      evidence: readCount(fixture.db, "portfolio_evidence"),
      risks: readCount(fixture.db, "portfolio_risk_signals"),
      facts: readCount(fixture.db, "portfolio_facts")
    };
    fixture.db.exec(`CREATE TRIGGER fail_phase5_risk
      BEFORE INSERT ON portfolio_risk_signals
      BEGIN
        SELECT RAISE(ABORT, 'forced Phase5 risk persistence failure');
      END;`);

    // Act / Assert
    await assert.rejects(() => fixture.reconciliation.reconcile(fixture.claim), /forced Phase5 risk persistence failure/);
    assert.deepEqual({
      evidence: readCount(fixture.db, "portfolio_evidence"),
      risks: readCount(fixture.db, "portfolio_risk_signals"),
      facts: readCount(fixture.db, "portfolio_facts")
    }, before);
    assert.equal(fixture.scheduler.getRun(fixture.claim.runId)?.state, "claimed");
    assert.equal(fixture.repository.getWorkflowWakeup(fixture.claim.sourceRecordId)?.state, "claimed");
  });
});

describe("Portfolio Dossier display and current-fact gates", () => {
  it("projects an explicit unknown display status when a V1 source has no Evidence", () => {
    // Arrange
    const fixture = createPortfolioPhase4Fixture();
    const repository = new PortfolioRepository(fixture.db, fixture.owner.id, { now: () => new Date(now) });

    // Act
    const display = repository.getDossierDisplay(fixture.projectId);

    // Assert
    assert.deepEqual(display?.sources.find((source) => source.source === "platform_lifecycle_v1"), {
      source: "platform_lifecycle_v1",
      status: "unknown",
      evidence: null
    });
  });

  it("table-drives latest V1 failure statuses that shadow an older fresh fact", () => {
    // Arrange / Act / Assert: source history is authoritative by V1 source, not by the caller-picked Evidence ID.
    const statuses = ["stale", "unknown", "timeout", "failed"] as const;
    const sources = ["platform_lifecycle_v1", "git_state_v1"] as const;
    for (const source of sources) for (const freshness of statuses) {
      const fixture = createPortfolioPhase4Fixture({ fixtureKey: `latest-${source}-${freshness}` });
      const repository = new PortfolioRepository(fixture.db, fixture.owner.id, { now: () => new Date(now) });
      const olderFresh = createObservationEvidence(repository, {
        projectId: fixture.projectId,
        source,
        freshness: "fresh",
        observedAt: new Date(now.getTime() - 1),
        key: `${source}:older-fresh:${freshness}`
      });
      const latestBad = createObservationEvidence(repository, {
        projectId: fixture.projectId,
        source,
        freshness,
        observedAt: new Date(now.getTime()),
        key: `${source}:latest-${freshness}`
      });

      const display = repository.getDossierDisplay(fixture.projectId);
      const current = repository.getCurrentDossier(fixture.projectId);

      assert.deepEqual(display?.sources.find((displaySource) => displaySource.source === source), {
        source,
        status: freshness,
        evidence: latestBad
      });
      assert.equal(current?.currentEvidence.some((evidence) => evidence.id === olderFresh.id), false, `${source} ${freshness} must shadow the old fresh fact`);
      assert.equal(current?.currentEvidence.some((evidence) => evidence.id === latestBad.id), false, `${source} ${freshness} is not current evidence`);
    }
  });

  it("keeps the latest display status but rejects a persisted fresh V1 fact outside its source-owned time window", () => {
    // Arrange
    const fixture = createPortfolioPhase4Fixture();
    const clock = { now: () => new Date(now) };
    const repository = new PortfolioRepository(fixture.db, fixture.owner.id, clock);
    const staleGit = createObservationEvidence(repository, {
      projectId: fixture.projectId,
      source: "git_state_v1",
      freshness: "fresh",
      observedAt: new Date(now.getTime() - 15 * 60_000 - 1),
      key: "git:stale-by-clock"
    });
    const dossier = repository.getDossierDisplay(fixture.projectId);
    assert.ok(dossier);

    // Act / Assert
    assert.equal(dossier.sources.find((source) => source.source === "git_state_v1")?.status, "fresh");
    assert.equal(repository.getCurrentDossier(fixture.projectId)?.currentEvidence.some((evidence) => evidence.id === staleGit.id), false);
    assert.throws(() => repository.updateDossier({
      projectId: fixture.projectId,
      expectedProjectionVersion: dossier.projectionVersion,
      observedState: { source: "stale V1 evidence" },
      evidenceIds: [staleGit.id],
      idempotencyKey: "dossier:reject-stale-v1"
    }), /PORTFOLIO_ENROLLMENT_EVIDENCE_INVALID/);
  });
});

describe("Portfolio Heartbeat scheduling", () => {
  it("keeps Heartbeat disabled by default and validates the enabled cadence range", () => {
    // Arrange
    const fixture = createAttempt({ trackingEnabled: true, idempotencyKey: "heartbeat" });

    // Act
    const defaultSetting = fixture.scheduler.setHeartbeat({ enabled: false, idempotencyKey: "heartbeat", now });
    fixture.scheduler.scheduleDueHeartbeat(now);

    // Assert
    assert.equal(defaultSetting.enabled, false);
    const heartbeatRuns = fixture.db.prepare("SELECT COUNT(*) AS count FROM portfolio_reconciliation_runs WHERE user_id = ? AND source = 'heartbeat'")
      .get(fixture.owner.id) as { count: number };
    assert.equal(heartbeatRuns.count, 0);
    assert.throws(() => fixture.scheduler.setHeartbeat({ enabled: true, cadenceMinutes: 4, now }), (error) => hasErrorCode(error, "PORTFOLIO_HEARTBEAT_CADENCE_INVALID"));
    assert.throws(() => fixture.scheduler.setHeartbeat({ enabled: true, cadenceMinutes: 1_441, now }), (error) => hasErrorCode(error, "PORTFOLIO_HEARTBEAT_CADENCE_INVALID"));
    assert.throws(() => fixture.scheduler.setHeartbeat({ enabled: true, cadenceMinutes: 5.5, now }), (error) => hasErrorCode(error, "PORTFOLIO_HEARTBEAT_CADENCE_INVALID"));
  });
});
